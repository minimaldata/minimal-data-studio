"""Connector tests use a fake BigQuery transport, never a user's Google credentials."""
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch
from types import SimpleNamespace
import pyarrow as pa
from project_files import ProjectFiles
from workspace_db import Workspace
from remote_sources import RemoteSources

class FakeRows:
    def __init__(self,table,total=None):self.table=table;self.total_rows=table.num_rows if total is None else total
    def to_arrow(self,**kwargs):return self.table
class FakeJob:
    statement_type='SELECT';total_bytes_processed=123;job_id='fake-job'
    def __init__(self,table):self.table=table;self.cancelled=False
    def result(self,**kwargs):return FakeRows(self.table.slice(0,kwargs.get('max_results',len(self.table))),len(self.table))
    def cancel(self,**kwargs):self.cancelled=True
class FakeClient:
    def __init__(self):self.table=pa.table({'id':range(1200),'label':['x']*1200});self.queries=[];self.job=FakeJob(self.table);self.destination=None
    def query(self,sql,job_config=None,**kwargs):
        self.queries.append(sql)
        if sql.startswith('CREATE TABLE'):
            if self.destination:raise ValueError('Already Exists: destination')
            self.destination=sql
        return self.job
    def get_job(self,*a,**kw):return self.job
    def get_dataset(self,*a,**kw):return SimpleNamespace(location='US')
    def load_table_from_file(self,*a,**kw):return FakeJob(pa.table({'id':[1]}))
    def get_table(self,ref,**kw):
        from google.api_core.exceptions import NotFound
        if '._studio_upload_' not in ref and not self.destination: raise NotFound('Missing')
        return SimpleNamespace(expires=None)
    def update_table(self,*a,**kw):pass
    def delete_table(self,*a,**kw):pass
    def close(self):pass

class RemoteChecks(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.files=ProjectFiles(self.root)
        self.ws=Workspace(self.root,self.root/'data',self.root,seed_samples=False)
        self.session=self.ws.new_session()['session'];self.client=FakeClient()
        self.remote=RemoteSources(self.root,self.ws,self.files,lambda config:self.client)
        self.remote.save({'revision':0,'connection':{'name':'Test warehouse','project':'test-project','location':'US'}})
        self.id=self.remote.view()['connections'][0]['id']
    def tearDown(self):self.ws.close();self.tmp.cleanup()
    def wait(self,id):
        for _ in range(200):
            result=self.remote.status(id,self.session)
            if result['state']!='running':return result
            time.sleep(.01)
        self.fail('Job did not finish')
    def query(self):return self.remote.start({'action':'query','connection':self.id,'sql':'SELECT * FROM source'},self.session)['id']
    def test_google_profile_routes_clients_without_default_fallback(self):
        from google_profiles import GoogleProfiles
        profiles=GoogleProfiles(self.root/'google-profiles')
        key='a'*32;directory=profiles.directory(key);directory.mkdir(parents=True)
        (directory/'profile.json').write_text(json.dumps({'name':'Work','account':'alice@example.com'}))
        (directory/'application_default_credentials.json').write_text(json.dumps({'type':'authorized_user','client_id':'fake','client_secret':'fake','refresh_token':'dummy-only'}))
        self.remote.google_profiles=profiles;self.remote.client_factory=None
        connection={**self.remote.connection(self.id),'authProfile':key}
        view=self.remote.save({'revision':1,'connection':connection})
        self.assertEqual(view['connections'][0]['authIdentity']['account'],'alice@example.com')
        self.assertNotIn('refresh_token',json.dumps(view))
        from unittest.mock import Mock
        bq=Mock();default=Mock(side_effect=AssertionError('must not use shared ADC'))
        with patch('remote_sources.libraries',return_value=(bq,default)):
            self.remote.client(connection)
            used=bq.Client.call_args.kwargs
            self.assertEqual(used['credentials'].refresh_token,'dummy-only')
            self.assertEqual(used['credentials'].quota_project_id,'test-project')
            with self.assertRaisesRegex(ValueError,'missing'):
                self.remote.client({**connection,'authProfile':'b'*32})
            default.assert_not_called()

    def test_result_keeps_original_connection_configuration(self):
        seen=[]
        self.remote.client_factory=lambda c:(seen.append(dict(c)) or self.client)
        token=self.query();self.wait(token)
        original=self.remote.connection(self.id)
        self.remote.save({'revision':1,'connection':{**original,'project':'other-project'}})
        self.remote.full_result(token,self.session)
        self.assertEqual(seen[-1]['project'],'test-project')

    def test_notebook_receives_complete_temporary_result(self):
        token=self.query();self.wait(token)
        result=self.remote.notebook_result({'id':token,'name':'remote_input'},self.session)
        self.assertEqual(result['rows'],1200)
        c=self.ws.session(self.session)['conn']
        self.assertEqual(c.execute('SELECT count(*) FROM remote_input').fetchone()[0],1200)
        self.assertTrue(c.execute("SELECT temporary FROM duckdb_tables() WHERE table_name='remote_input'").fetchone()[0])
        self.remote.jobs[token]['truncated']=True
        with self.assertRaisesRegex(ValueError,'incomplete'):
            self.remote.notebook_result({'id':token,'name':'blocked'},self.session)
        self.assertEqual(c.execute("SELECT count(*) FROM duckdb_tables() WHERE table_name='blocked'").fetchone()[0],0)
        with self.assertRaisesRegex(ValueError,'another editor'):
            self.remote.notebook_result({'id':token,'name':'blocked'},'other')

    def test_preview_more_export_and_snapshot_use_original_job(self):
        import csv
        import io
        token=self.query();self.assertEqual(self.wait(token)['state'],'done')
        calls=len(self.client.queries)
        preview=pa.ipc.open_stream(self.remote.result(token,self.session)).read_all()
        self.assertEqual(preview.num_rows,1000)
        expanded=pa.ipc.open_stream(self.remote.result(token,self.session,11000)).read_all()
        self.assertEqual(expanded.num_rows,1200)
        exported=list(csv.reader(io.StringIO(self.remote.export_csv(token,self.session).decode())))
        self.assertEqual(len(exported),1201)
        self.assertEqual(self.remote.snapshot({'id':token,'name':'full_export'},self.session)['rows'],1200)
        self.assertEqual(len(self.client.queries),calls)
        with self.assertRaisesRegex(ValueError,'another editor'):
            self.remote.export_csv(token,'other')
        for limit in (True,0,100001,'10000'):
            with self.assertRaises(ValueError):self.remote.result(token,self.session,limit)

    def test_full_result_limits_and_incomplete_results(self):
        token=self.query();self.wait(token);job=self.remote.jobs[token]
        job['totalRows']=100001
        with self.assertRaisesRegex(ValueError,'100,000'):self.remote.export_csv(token,self.session)
        job['totalRows']=1201
        with self.assertRaisesRegex(ValueError,'incomplete'):self.remote.export_csv(token,self.session)
        job['totalRows']=1200;job['provider']='snowflake';job['truncated']=True
        with self.assertRaisesRegex(ValueError,'100,000'):self.remote.export_csv(token,self.session)
        job['displayArrow']=self.client.table
        self.assertEqual(pa.ipc.open_stream(self.remote.result(token,self.session,11000)).read_all().num_rows,1200)

    def test_config_only_metadata_revision_and_no_fallback(self):
        self.assertNotIn('credentials',self.remote.path.read_text())
        with self.assertRaisesRegex(ValueError,'changed'):self.remote.save({'revision':0,'connection':{}})
        with self.assertRaisesRegex(ValueError,'credentials'):self.remote.save({'revision':1,'connection':{'private_key':'fake'}})
        with self.assertRaisesRegex(ValueError,'not run locally'):self.remote.connection('missing')
    def test_preview_and_full_snapshot_preserve_types_and_existing_table(self):
        id=self.query();self.assertEqual(self.wait(id)['state'],'done')
        self.assertEqual(pa.ipc.open_stream(self.remote.result(id,self.session)).read_all().num_rows,1000)
        result=self.remote.snapshot({'id':id,'name':'snapshot'},self.session);self.assertEqual(result['rows'],1200)
        self.assertEqual(self.ws.session(self.session)['conn'].execute('SELECT count(*) FROM snapshot').fetchone()[0],1200)
        self.assertEqual(len(self.client.queries),2) # dry run + original query; snapshot does not rerun
        with self.assertRaises(Exception):self.remote.snapshot({'id':id,'name':'snapshot'},self.session)
        with self.assertRaisesRegex(ValueError,'another editor'):self.remote.result(id,'other')
    def test_reject_remote_mutations_and_over_budget_queries(self):
        self.client.job.statement_type='DELETE';id=self.query();self.assertIn('SELECT',self.wait(id)['error']);self.assertEqual(len(self.client.queries),1)
        self.client.job.statement_type='SELECT';self.client.job.total_bytes_processed=10**12;id=self.query();self.assertIn('byte limit',self.wait(id)['error'])
    def test_explicit_upload_csv_paths_and_duplicate_names(self):
        path=self.root/'data'/'lookup.csv';path.write_text('id,label\n1,one\n')
        args={'action':'upload','connection':self.id,'file':'data/lookup.csv','dataset':'demo','name':'lookup'}
        with self.assertRaisesRegex(ValueError,'Confirm'):self.remote.start(args,self.session)
        args['confirmed']=True
        id=self.remote.start(args,self.session)['id'];self.assertEqual(self.wait(id)['destination'],'test-project.demo.lookup')
        id=self.remote.start(args,self.session)['id'];self.assertIn('already exists',self.wait(id)['error'])
        with self.assertRaises(ValueError):self.remote.local_data({'file':'../outside.csv'},self.session)
        self.assertEqual(path.read_text(),'id,label\n1,one\n')
    def test_snapshot_limits_never_create_partial_table(self):
        self.client.table=pa.table({'id':range(100001)});self.client.job=FakeJob(self.client.table)
        id=self.query();self.wait(id)
        with self.assertRaisesRegex(ValueError,'100,000'):self.remote.snapshot({'id':id,'name':'too_big'},self.session)
        self.assertFalse(self.ws.session(self.session)['conn'].execute("SELECT * FROM information_schema.tables WHERE table_name='too_big'").fetchall())
