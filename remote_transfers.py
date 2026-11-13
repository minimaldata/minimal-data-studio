"""Explicit, disk-backed full transfers. Notebook inputs keep their existing limits."""
import os
from pathlib import Path
import re
import shutil
import tempfile
import threading
import time
import uuid
import pyarrow as pa
import pyarrow.csv as csv
import pyarrow.parquet as pq
from workspace_db import ident

DEFAULT_BUDGET=1_000_000_000
MAX_BUDGET=100_000_000_000

class TransferError(ValueError):
    transfer_safe=True

class RemoteTransfers:
    def __init__(self, remote):
        self.remote=remote;self.lock=threading.RLock();self.jobs={}

    @property
    def active(self):
        with self.lock:return any(j['state']=='running' for j in self.jobs.values())

    def plan(self, token, session):
        source=self.remote.job(token,session)
        if source['state']!='done' or 'arrow' not in source:raise TransferError('Run a query successfully first.')
        cached=source.get('snapshotArrow') is not None and not source.get('truncated')
        provider=source.get('provider','bigquery')
        rerun=provider=='postgres' and not cached
        total=source.get('resultRowCount') if source.get('truncated') else source.get('totalRows')
        sample=source['arrow'];estimate=round(sample.nbytes/sample.num_rows*total) if total is not None and sample.num_rows else None
        return {'rows':total,'estimatedBytes':estimate,'rerun':rerun,'defaultBudget':DEFAULT_BUDGET,
                'source':provider,'retrieval':'Reruns this Postgres SELECT. Data may have changed since the preview; query timeout still applies.' if rerun else 'Reads the original result; SQL is not rerun. If the result has expired, run the query again yourself.'}

    def start(self, request, session):
        if request.get('confirmed') is not True:raise TransferError('Review and confirm this full transfer first.')
        source=self.remote.job(request.get('id'),session);plan=self.plan(source['id'],session)
        if plan['rerun'] and request.get('allowRerun') is not True:raise TransferError('Confirm that this Postgres query will run again.')
        kind=request.get('kind');name=request.get('name','');budget=request.get('maxBytes')
        if kind not in ('csv','table','both'):raise TransferError('Choose CSV, Local DuckDB, or both.')
        csv_name=request.get('csvName',name if kind=='csv' else '')
        table_name=request.get('tableName',name if kind=='table' else '')
        if type(budget) is not int or not 1_000_000<=budget<=MAX_BUDGET:raise TransferError('Choose a transfer budget from 1 MB to 100 GB.')
        if kind in ('table','both'):
            if not isinstance(table_name,str) or not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*',table_name):raise TransferError('Use letters, numbers and underscores for the table name.')
            with self.remote.workspace.lock:
                message=self.remote.workspace.duplicate_name_message(self.remote.workspace.session(session),table_name)
                if message:raise TransferError(message)
        if kind in ('csv','both'):
            if not isinstance(csv_name,str) or not csv_name.lower().endswith('.csv') or len(csv_name)>180 or csv_name in ('.csv','..csv') or any(c in csv_name for c in '/\\\0') or any(ord(c)<32 for c in csv_name):
                raise TransferError('Enter a filename ending in .csv, without folder separators.')
            if (self.remote.files.resolve('exports')/csv_name).exists():raise TransferError('That CSV already exists. Choose another filename.')
        with self.lock:
            if self.active:raise TransferError('Wait for or cancel the current full transfer first.')
            self.jobs={k:v for k,v in self.jobs.items() if time.time()-v['at']<1800}
            while len(self.jobs)>=10:self.jobs.pop(next(iter(self.jobs)))
            token=uuid.uuid4().hex
            job={'id':token,'owner':session,'state':'running','phase':'Downloading','rows':0,'bytes':0,'maxBytes':budget,'totalRows':plan['rows'],'cancelled':False,'kind':kind,'name':name,'csvName':csv_name,'tableName':table_name,'at':time.time()}
            self.jobs[token]=job
        threading.Thread(target=self._run,args=(job,source),daemon=True).start()
        return self.status(token,session)

    def job(self, token, session):
        job=self.jobs.get(token)
        if not job or job['owner']!=session:raise TransferError('Transfer expired or belongs to another editor.')
        return job

    def status(self, token, session):
        with self.lock:
            job=self.job(token,session)
            return {k:v for k,v in job.items() if k in ('id','state','phase','rows','bytes','maxBytes','totalRows','kind','name','destination','error')}

    def cancel(self, token, session):
        with self.lock:
            job=self.job(token,session)
            if job['state']!='running':return {'requested':False}
            job['cancelled']=True
            connector=job.get('connector');local=job.get('local')
            if local:local.interrupt()
        if connector:connector.cancel()
        return {'requested':True}

    def close(self):
        for job in list(self.jobs.values()):
            if job['state']=='running':self.cancel(job['id'],job['owner'])

    def _run(self, job, source):
        client=None;stream=None;stage=None;parts=[];empty_table=None;started=time.monotonic()
        def check():
            if job['cancelled']:raise TransferError('Transfer cancelled. No output was published.')
            if time.monotonic()-started>3600:raise TransferError('Transfer stopped after one hour. No output was published.')
        try:
            stage=Path(tempfile.mkdtemp(prefix='remote-transfer-',dir=self.remote.workspace.folder))
            output=stage/'result.csv'
            if job['kind'] in ('csv','both'):stream=output.open('wb')
            def consume(table,empty=False):
                nonlocal empty_table
                check()
                if isinstance(table,pa.RecordBatch):table=pa.Table.from_batches([table])
                if not table.num_rows:
                    if empty_table is None:empty_table=table
                    return
                if job['bytes']+table.nbytes>job['maxBytes']:raise TransferError('Transfer exceeded your size budget. Increase it explicitly and try again. No partial output was published.')
                if shutil.disk_usage(stage).free<max(128_000_000,table.nbytes*3):raise TransferError('Not enough disk space to finish safely. No output was published.')
                if stream:
                    csv.write_csv(table,stream,write_options=csv.WriteOptions(include_header=job['rows']==0))
                    if stream.tell()>job['maxBytes']:raise TransferError('CSV exceeded your size budget. No partial file was published.')
                if job['kind'] in ('table','both'):
                    part=stage/('%08d.parquet'%len(parts));pq.write_table(table,part);parts.append(part)
                with self.lock:job['rows']+=table.num_rows;job['bytes']+=table.nbytes
            cached=source.get('snapshotArrow')
            config=source.get('config') or self.remote.connection(source['connection'])
            if cached is not None and not source.get('truncated'):
                for batch in cached.to_batches(max_chunksize=1000):consume(batch)
                empty_table=cached.slice(0,0)
            elif source.get('provider','bigquery')=='bigquery':
                client=self.remote.client(config)
                remote_job=client.get_job(source['jobId'],project=source['project'],location=source['location'],timeout=30)
                rows=remote_job.result(timeout=300,page_size=1000)
                for batch in rows.to_arrow_iterable(bqstorage_client=None,max_queue_size=1,max_stream_count=1,timeout=60):consume(batch)
                if not job['rows']:empty_table=source['arrow'].slice(0,0)
            else:
                client=self.remote.connector(config)
                with self.lock:job['connector']=client
                check();client.stream_result(source['query'],source['jobId'],consume)
            check()
            # Original retained results have an exact count; a confirmed Postgres rerun may differ.
            if source.get('provider')!='postgres' and job['totalRows'] is not None and job['rows']!=job['totalRows']:
                raise TransferError('The full result was not received. No partial output was published.')
            if not job['rows']:
                if empty_table is None:raise TransferError('Result schema was unavailable. No output was published.')
                if stream:csv.write_csv(empty_table,stream)
                if job['kind'] in ('table','both'):
                    part=stage/'empty.parquet';pq.write_table(empty_table,part);parts.append(part)
            destination=None
            if stream:
                stream.flush();os.fsync(stream.fileno());stream.close();stream=None
                if output.stat().st_size>job['maxBytes']:raise TransferError('CSV exceeded your size budget. No output was published.')
                destination=self.remote.files.resolve('exports')/job['csvName']
            if job['kind']=='csv':
                with self.lock:
                    check();os.link(output,destination);job.update(state='done',phase='Complete',destination='exports/'+job['csvName'])
            else:
                with self.remote.workspace.lock:
                    c=self.remote.workspace.connection.cursor();linked=False
                    with self.lock:job['local']=c;job['phase']='Creating local table'
                    try:
                        check();c.execute('BEGIN')
                        paths=[str(p) for p in parts]
                        c.execute('CREATE TABLE '+ident(job['tableName'])+' AS SELECT * FROM read_parquet(?, union_by_name=true)',[paths])
                        self.remote.workspace.record_definition({'conn':c},job['tableName'],origin='Full '+source.get('provider','bigquery')+' result · job '+source['jobId']+'\n'+source['query'])
                        with self.lock:
                            check()
                            if destination is not None:os.link(output,destination);linked=True
                            c.execute('COMMIT')
                            label=job['tableName']+(' and exports/'+job['csvName'] if destination is not None else '')
                            job.update(state='done',phase='Complete',destination=label);job.pop('local',None)
                    except Exception:
                        try:c.execute('ROLLBACK')
                        except Exception:pass
                        if linked:destination.unlink()
                        raise
                    finally:
                        with self.lock:job.pop('local',None)
                        c.close()
        except Exception as error:
            with self.lock:
                job.update(state='cancelled' if job['cancelled'] else 'error',phase='Stopped',error=('Transfer cancelled. No output was published.' if job['cancelled'] else str(error)[:1200] if isinstance(error,ValueError) else 'Transfer failed. Check connectivity, permissions, available disk space, or whether the original result expired. No partial output was published.'))
        finally:
            with self.lock:job.pop('connector',None)
            if stream:stream.close()
            if client:client.close()
            if stage:shutil.rmtree(stage,ignore_errors=True)
