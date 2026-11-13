"""Project connection metadata and bounded, explicit remote transfers.
Credentials resolve through ADC, Snowflake SSO or local libpq profiles.
"""
import io
import json
import re
import threading
import time
import uuid
from pathlib import Path
import pyarrow as pa
import pyarrow.parquet as pq
from workspace_db import ident
from remote_models import RemoteModels
from google_profiles import GoogleProfiles
from remote_transfers import RemoteTransfers
from remote_connectors import ReadOnlyConnector, SnowflakeSessions, provider, capabilities, validate_config, safe_error, LABELS

MAX_ROWS = 100_000
MAX_BYTES = 64 * 1024 * 1024
PREVIEW_ROWS = 1000

def libraries():
    try:
        from google.cloud import bigquery
        from google.auth import default
        return bigquery, default
    except ImportError:
        raise ValueError('BigQuery support is not installed in this server. Install requirements.txt in the Studio development environment or use an updated preview.') from None

class RemoteSources:
    def __init__(self, project, workspace, files, client_factory=None, connector_factory=None, credentials=None, google_profiles=None):
        self.path = Path(project)/'.studio/connections.json'
        self.workspace, self.files = workspace, files
        self.lock = threading.RLock()
        self.jobs = {}
        self.client_factory = client_factory
        self.connection_states={}
        self.credentials=credentials
        self.google_profiles=google_profiles or GoogleProfiles()
        self.connector_factory = connector_factory or (lambda config:ReadOnlyConnector(config,credential_resolver=self.resolve_credentials,progress=lambda phase:self.connection_progress(config["id"],phase)))
        self.snowflake_sessions = SnowflakeSessions(self.connector_factory)
        self.state = json.loads(self.path.read_text()) if self.path.exists() else {'revision':0, 'connections':[]}
        self.models = RemoteModels(project, self)
        self.transfers = RemoteTransfers(self)

    def connection_progress(self, key, phase):
        with self.lock:self.connection_states[key]={'phase':phase}

    def connection_status(self, key):
        self.connection(key)
        with self.lock:return dict(self.connection_states.get(key,{'phase':'idle'}))

    def connector(self, config):
        return self.snowflake_sessions.lease(config) if provider(config)=='snowflake' else self.connector_factory(config)

    def close(self):
        self.transfers.close()
        self.snowflake_sessions.close()

    def credential_list(self):
        if not self.credentials or not self.credentials.available:
            return {'credentials':[],'available':False,'error':'Open this project from the updated Mac preview to use Keychain passwords.'}
        response=self.credentials.request({'operation':'list'})
        return {'available':True,'credentials':[{'id':c['id'],'name':c['name']} for c in response.get('credentials',[])]}

    def manage_credentials(self):
        if not self.credentials:raise ValueError('Open this project from the updated Mac preview to manage Keychain passwords.')
        return self.credentials.request({'operation':'manage'})

    def resolve_credentials(self, config):
        if not self.credentials:raise ValueError('Open this project from the updated Mac preview to use Keychain passwords.')
        # The launcher independently matches these metadata against the saved connection.
        response=self.credentials.request({'operation':'resolve-connection','connection':config})
        return response.get('values',{})

    @property
    def active(self):
        with self.lock: return self.transfers.active or any(j['state']=='running' for j in self.jobs.values())

    def view(self):
        result=json.loads(json.dumps(self.state))
        for c in result['connections']:
            c['provider']=provider(c);c['capabilities']=capabilities(c)
            if provider(c)=='bigquery':
                if c.get('authProfile'):
                    try: c['authIdentity']=self.google_profiles.metadata(c['authProfile'])
                    except ValueError: c['authIdentity']={'name':'Unavailable profile','account':'Reconnect on this Mac'}
                else: c['authIdentity']={'name':'System ADC (shared)','account':'Account not verified — choose a profile'}
        return result

    def save(self, request):
        with self.lock:
            if request.get('revision') != self.state['revision']:
                raise ValueError('Connections changed. Reopen connection settings and try again.')
            item = request.get('connection', {})
            clean=validate_config(item)
            name=clean['name']
            if clean.get('authProfile'): self.google_profiles.metadata(clean['authProfile'])
            key = item.get('id') or uuid.uuid4().hex
            if item.get('id') and not any(c['id']==key for c in self.state['connections']):
                raise ValueError('Connection no longer exists.')
            if any(c['id']!=key and c['name'].casefold()==name.casefold() for c in self.state['connections']):
                raise ValueError('That connection name is already used. Choose a distinct label.')
            if item.get('id') and provider(self.connection(key))!=clean['provider']:
                raise ValueError('Create a new connection to change database providers.')
            clean['id']=key
            state = {'revision':self.state['revision']+1,'connections':[c for c in self.state['connections'] if c['id']!=key]+[clean]}
            temp=self.path.with_suffix('.tmp');temp.write_text(json.dumps(state,indent=2));temp.replace(self.path)
            self.state=state
            self.snowflake_sessions.invalidate(key)
            self.connection_states.pop(key,None)
            return self.view()

    def connection(self, key):
        with self.lock:
            for item in self.state['connections']:
                if item['id']==key: return dict(item)
        raise ValueError('This remote connection is unavailable. Choose a connection explicitly; SQL was not run locally.')

    def client(self, config):
        if self.client_factory: return self.client_factory(config)
        bq, default = libraries()
        if config.get('authProfile'):
            credentials=self.google_profiles.credentials(config['authProfile'],config['project'])
            return bq.Client(project=config['project'],credentials=credentials,location=config['location'])
        try:
            credentials, _ = default(scopes=['https://www.googleapis.com/auth/cloud-platform'])
            return bq.Client(project=config['project'],credentials=credentials,location=config['location'])
        except Exception:
            raise ValueError('Google authentication is unavailable. Run gcloud auth application-default login in Terminal, then test the connection again. Credentials stay on this Mac.') from None

    def catalog(self, key, dataset=None):
        config=self.connection(key)
        if provider(config)!='bigquery':
            connector=self.connector(config)
            try:return connector.catalog(dataset)
            except Exception as error:raise ValueError(safe_error(error,provider(config))) from None
            finally:connector.close()
        client=self.client(config)
        try:
            if dataset:
                if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*',dataset): raise ValueError('Invalid dataset name.')
                ref=config['project']+'.'+dataset
                info=client.get_dataset(ref,timeout=30)
                if info.location.lower()!=config['location'].lower():
                    raise ValueError('This dataset is in '+info.location+'. Change the connection location to query it.')
                return {'tables':[{'name':t.table_id,'kind':t.table_type,'qualified':ref+'.'+t.table_id} for t in client.list_tables(ref,max_results=500,timeout=30)]}
            return {'datasets':[d.dataset_id for d in client.list_datasets(max_results=500,timeout=30)]}
        finally: client.close()

    def start(self, request, session):
        config=self.connection(request.get('connection'))
        kind=request.get('action')
        if provider(config)!='bigquery' and kind!='query':
            raise ValueError('This connection is read-only. Publishing and uploads are available only for BigQuery.')
        if kind not in ('query','upload','model_publish'): raise ValueError('Unknown remote operation.')
        if kind=='upload' and request.get('confirmed') is not True:
            raise ValueError('Confirm the destination before uploading data.')
        with self.lock:
            for key,j in list(self.jobs.items()):
                if j['state']!='running' and time.time()-j['at']>1800: del self.jobs[key]
            if sum(j['state']=='running' for j in self.jobs.values())>=2:
                raise ValueError('Wait for a remote operation to finish before starting another.')
            while len(self.jobs)>=12:
                oldest=next((key for key,j in self.jobs.items() if j['state']!='running'),None)
                if oldest is None: raise ValueError('Wait for a remote operation to finish.')
                del self.jobs[oldest]
            token=uuid.uuid4().hex
            job={'id':token,'state':'running','at':time.time(),'connection':config['id'],'provider':provider(config),'cancelled':False,'session':session,'query':request.get('sql',''),'config':dict(config)}
            self.jobs[token]=job
        threading.Thread(target=self._run,args=(job,config,dict(request)),daemon=True).start()
        return {'id':token}

    def _run(self, state, config, request):
        client=None
        try:
            if provider(config)!='bigquery':
                client=self.connector(config)
                state['remoteJob']=client
                if state['cancelled']:client.cancel();raise ValueError('Cancelled before execution.')
                state.update(client.query(request.get('sql','')))
                state['state']='done'
                return
            client=self.client(config);bq,_=libraries()
            if request['action']=='model_publish':
                state.update(self.models.publish(request, client, config))
            elif request['action']=='query':
                sql=request.get('sql','')
                sql=self.models.compile({'id':request.get('model'), 'connection':config['id'], 'sql':sql})['compiledSql']
                state['query']=sql
                if not isinstance(sql,str) or not sql.strip() or len(sql)>1_000_000: raise ValueError('Enter a SQL query.')
                # BigQuery validates dialect and statement kind; no DuckDB parser or regex permission claims.
                check=client.query(sql,job_config=bq.QueryJobConfig(dry_run=True,use_query_cache=False),location=config['location'],timeout=30)
                if check.statement_type!='SELECT': raise ValueError('This preview supports a single BigQuery SELECT query. Use Upload to BigQuery for explicit transfers; remote SQL writes are not enabled yet.')
                if (check.total_bytes_processed or 0)>config['maximumBytesBilled']:
                    raise ValueError('Query exceeds this connection’s byte limit. Filter the query or change the limit in connection settings.')
                if state['cancelled']: raise ValueError('Cancelled before execution.')
                job=client.query(sql,job_config=bq.QueryJobConfig(maximum_bytes_billed=config['maximumBytesBilled']),location=config['location'],timeout=30)
                state['remoteJob']=job
                if state['cancelled']:job.cancel();raise ValueError('Cancellation requested.')
                rows=job.result(timeout=300,max_results=PREVIEW_ROWS)
                table=rows.to_arrow(create_bqstorage_client=False)
                if table.nbytes>MAX_BYTES: raise ValueError('Preview exceeds 64 MB. Select fewer columns or rows.')
                state.update(arrow=table,totalRows=rows.total_rows or 0,bytesProcessed=job.total_bytes_processed or 0,jobId=job.job_id,project=config['project'],location=config['location'],fetchedAt=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()))
            else:
                dataset=request.get('dataset','');name=request.get('name','')
                if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*',dataset) or not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*',name):
                    raise ValueError('Use letters, numbers and underscores for dataset and table names.')
                ref=config['project']+'.'+dataset+'.'+name
                info=client.get_dataset(config['project']+'.'+dataset,timeout=30)
                if info.location.lower()!=config['location'].lower(): raise ValueError('Destination dataset location does not match the connection.')
                from google.api_core.exceptions import NotFound
                try: client.get_table(ref,timeout=30)
                except NotFound: pass
                else: raise ValueError('A table or view already exists at '+ref+'. Choose a new name; nothing was uploaded.')
                table=self.local_data(request,state['session'])
                # Load into a new private staging table, then CREATE TABLE AS SELECT fails atomically on any existing destination.
                stage=config['project']+'.'+dataset+'._studio_upload_'+uuid.uuid4().hex
                stream=io.BytesIO();pq.write_table(table,stream);stream.seek(0)
                try:
                    job=client.load_table_from_file(stream,stage,job_config=bq.LoadJobConfig(source_format=bq.SourceFormat.PARQUET,write_disposition='WRITE_EMPTY'),location=config['location'],timeout=30)
                    state['remoteJob']=job
                    if state['cancelled']:job.cancel();raise ValueError('Cancellation requested. Staging cleanup may be delayed.')
                    job.result(timeout=300)
                    if state['cancelled']: raise ValueError('Cancelled before creating the destination table.')
                    job=client.query('CREATE TABLE `'+ref+'` AS SELECT * FROM `'+stage+'`',job_config=bq.QueryJobConfig(maximum_bytes_billed=config['maximumBytesBilled']),location=config['location'],timeout=30)
                    state['remoteJob']=job;job.result(timeout=300)
                    state.update(destination=ref,totalRows=table.num_rows)
                finally:
                    # Expiration is a fallback if cancellation races a load or cleanup is denied.
                    try:
                        import datetime
                        staging=client.get_table(stage,timeout=30);staging.expires=datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(days=1)
                        client.update_table(staging,['expires'],timeout=30)
                        client.delete_table(stage,not_found_ok=True,timeout=30)
                    except Exception: state['warning']='A temporary _studio_upload_ table may remain in the destination dataset. Remove it after the remote job finishes.'
            state['state']='done'
        except Exception as error:
            # Never include credential objects, HTTP headers, or SDK request representations.
            from concurrent.futures import TimeoutError
            state.update(state='error',error=('Remote operation timed out. Check BigQuery job history before retrying; it may still be running.' if provider(config)=='bigquery' and isinstance(error,TimeoutError) else (safe_error(error,provider(config)) if provider(config)!='bigquery' else str(error)[:1500])))
        finally:
            if client:client.close()

    def job(self, token, session):
        with self.lock:
            job=self.jobs.get(token)
            if not job or job['session']!=session: raise ValueError('Remote result expired or belongs to another editor session. Run the query again.')
            return job

    def status(self,token,session):
        job=self.job(token,session)
        return {k:v for k,v in job.items() if k in ('id','state','error','totalRows','bytesProcessed','jobId','project','location','fetchedAt','destination','warning','provider','truncated','availableRows','resultRowCount')}

    def cancel(self,token,session):
        job=self.job(token,session);job['cancelled']=True
        if job.get('remoteJob'):job['remoteJob'].cancel(timeout=15)
        return {'requested':True}

    def result(self,token,session,limit=PREVIEW_ROWS):
        job=self.job(token,session)
        if job['state']!='done' or 'arrow' not in job: raise ValueError('No completed query result.')
        if type(limit) is not int or not PREVIEW_ROWS <= limit <= MAX_ROWS:
            raise ValueError('Choose a result limit between 1,000 and 100,000 rows.')
        table=job['arrow']
        if limit>PREVIEW_ROWS:
            if job.get('provider','bigquery')!='bigquery':
                table=job.get('displayArrow',job.get('snapshotArrow'))
                if table is None:raise ValueError('No more rows retained. Filter the query and run again.')
                table=table.slice(0,limit)
            else:
                client=self.client(job.get('config') or self.connection(job['connection']))
                try:
                    remote=client.get_job(job['jobId'],project=job['project'],location=job['location'],timeout=30)
                    table=remote.result(timeout=60,max_results=limit).to_arrow(create_bqstorage_client=False)
                finally:client.close()
            if table.nbytes>MAX_BYTES:raise ValueError('These rows exceed the 64 MB transfer limit. Select fewer columns or filter the query.')
        sink=pa.BufferOutputStream()
        with pa.ipc.new_stream(sink,table.schema) as writer:writer.write_table(table)
        return sink.getvalue().to_pybytes()

    def local_data(self,request,session):
        with self.workspace.lock:
            c=self.workspace.session(session)['conn']
            if request.get('file'):
                path=self.files.resolve(request['file'])
                if path.suffix.lower() not in ('.csv','.tsv'):raise ValueError('Upload supports CSV and TSV files. Export other formats as CSV first.')
                if path.stat().st_size>MAX_BYTES:raise ValueError('This preview supports uploads up to 64 MB.')
                table=c.execute('SELECT * FROM read_csv_auto(?) LIMIT ?', [str(path),MAX_ROWS+1]).fetch_arrow_table()
            else:
                name=request.get('table','')
                if not isinstance(name,str) or not name: raise ValueError('Select a local table.')
                table=c.execute('SELECT * FROM main.'+ident(name)+' LIMIT '+str(MAX_ROWS+1)).fetch_arrow_table()
            if table.num_rows>MAX_ROWS or table.nbytes>MAX_BYTES:raise ValueError('This preview supports transfers up to 100,000 rows and 64 MB. Filter or aggregate first.')
            return table

    def full_result(self, token, session):
        job=self.job(token,session)
        if job['state']!='done' or 'arrow' not in job:
            raise ValueError('Run the remote query first.')
        if job.get('truncated') or job['totalRows']>MAX_ROWS:
            raise ValueError('This result is incomplete or too large for transfer. Full-result actions are limited to 100,000 rows / 64 MB. Filter or aggregate the query and run again; no partial export or table was created.')
        if job.get('provider','bigquery')!='bigquery':
            if job.get('truncated') or job.get('snapshotArrow') is None:
                raise ValueError('This result is incomplete. Filter the remote query and rerun before saving a snapshot.')
            table=job['snapshotArrow']
        elif job.get('snapshotArrow') is not None:
            table=job['snapshotArrow']
        else:
            client=self.client(job.get('config') or self.connection(job['connection']))
            try:
                # Fetch the original completed job, never rerun its SQL or transfer only its display preview.
                remote=client.get_job(job['jobId'],project=job['project'],location=job['location'],timeout=30)
                table=remote.result(timeout=60,max_results=MAX_ROWS+1).to_arrow(create_bqstorage_client=False)
            finally:client.close()
        if table.num_rows!=job['totalRows'] or table.nbytes>MAX_BYTES:raise ValueError('Result is incomplete or exceeds 64 MB. No local table was created.')
        job['snapshotArrow']=table
        return table

    def export_csv(self, token, session):
        import pyarrow.csv as csv
        table=self.full_result(token,session)
        sink=pa.BufferOutputStream()
        csv.write_csv(table,sink)
        return sink.getvalue().to_pybytes()

    def notebook_result(self, request, session):
        name=request.get('name','')
        if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*',name):
            raise ValueError('Invalid notebook cell name.')
        table=self.full_result(request.get('id'),session)
        with self.workspace.lock:
            c=self.workspace.session(session)['conn'];binding='_remote_'+uuid.uuid4().hex
            c.register(binding,table)
            try:
                c.execute('CREATE OR REPLACE TEMP TABLE '+ident(name)+' AS SELECT * FROM '+ident(binding))
            finally:c.unregister(binding)
        return {'name':name,'rows':table.num_rows}

    def snapshot(self,request,session):
        job=self.job(request.get('id'),session)
        if job['state']!='done' or 'arrow' not in job:raise ValueError('Run the remote query first.')
        if job['totalRows']>MAX_ROWS:raise ValueError('Local snapshots are limited to 100,000 rows in this preview. Filter or aggregate the remote query first.')
        name=request.get('name','')
        if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*',name):raise ValueError('Enter a local table name using letters, numbers and underscores.')
        with self.workspace.lock:
            duplicate=self.workspace.duplicate_name_message(self.workspace.session(session),name)
            if duplicate: raise ValueError(duplicate)
        table=self.full_result(request.get('id'),session)
        with self.workspace.lock:
            s=self.workspace.session(session);c=s['conn'];binding='_remote_'+uuid.uuid4().hex
            c.register(binding,table)
            try:
                c.execute('CREATE TABLE '+ident(name)+' AS SELECT * FROM '+ident(binding))
                self.workspace.record_definition(s,name,origin=LABELS[job.get('provider','bigquery')]+' snapshot · '+job['project']+' · '+job['fetchedAt']+' · job '+job['jobId']+'\n'+job['query'])
            finally:c.unregister(binding)
        return {'name':name,'rows':table.num_rows}
