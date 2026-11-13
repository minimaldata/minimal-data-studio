import csv
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from types import SimpleNamespace
import pyarrow as pa
from project_files import ProjectFiles
from workspace_db import Workspace
from remote_transfers import RemoteTransfers

class TransfersChecks(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.files=ProjectFiles(self.root)
        self.ws=Workspace(self.root,self.root/'data',self.root,seed_samples=False)
        self.session=self.ws.new_session()['session'];self.calls=[];self.batches=120;self.width=0;self.gate=None
        self.source={'id':'original','state':'done','provider':'bigquery','arrow':pa.table({'id':range(1000)}),'totalRows':120000,'session':self.session,'connection':'c','config':{'project':'example-project'},'jobId':'warehouse-original','project':'example-project','location':'US','query':'SELECT id FROM source'}
        owner=self
        class Rows:
            def to_arrow_iterable(self,**kw):
                owner.calls.append(('stream',kw))
                for i in range(owner.batches):
                    if i==1 and owner.gate:owner.gate.wait(3)
                    yield pa.table({'id':range(i*1000,(i+1)*1000),**({'text':['x'*owner.width]*1000} if owner.width else {})}).to_batches()[0]
        class Client:
            def get_job(self,token,**kw):owner.calls.append(('get_job',token));return self
            def result(self,**kw):owner.calls.append(('result',kw));return Rows()
            def close(self):pass
        def job(token,session):
            if token!='original' or session!=self.session:raise ValueError('Wrong owner')
            return self.source
        self.remote=SimpleNamespace(workspace=self.ws,files=self.files,job=job,client=lambda config:Client())
        self.transfers=RemoteTransfers(self.remote)
    def tearDown(self):
        if self.gate:self.gate.set()
        self.transfers.close()
        for _ in range(300):
            if not self.transfers.active:break
            time.sleep(.01)
        self.ws.close();self.tmp.cleanup()
    def start(self,kind='csv',name='all.csv',**extra):
        return self.transfers.start({'id':'original','kind':kind,'name':name,'maxBytes':1000000000,'confirmed':True,**extra},self.session)['id']
    def wait(self,token):
        for _ in range(1000):
            result=self.transfers.status(token,self.session)
            if result['state']!='running':return result
            time.sleep(.01)
        self.fail('Transfer did not finish')
    def test_large_csv_uses_original_job_and_streams_past_old_row_limit(self):
        result=self.wait(self.start());self.assertEqual(result['state'],'done',result)
        with (self.root/'exports/all.csv').open() as stream: self.assertEqual(sum(1 for _ in csv.reader(stream)),120001)
        self.assertIn(('get_job','warehouse-original'),self.calls)
        self.assertEqual(result['rows'],120000)
        self.assertFalse(list((self.root/'.studio').glob('remote-transfer-*')))
    def test_table_is_complete_and_duplicates_preserved(self):
        result=self.wait(self.start('table','full_result'));self.assertEqual(result['state'],'done',result)
        self.assertEqual(self.ws.connection.execute('select count(*), max(id) from full_result').fetchone(),(120000,119999))
        with self.assertRaises(ValueError):self.start('table','full_result')
    def test_budget_failure_and_incomplete_result_never_publish(self):
        self.width=3000
        result=self.wait(self.start(maxBytes=1000000));self.assertEqual(result['state'],'error');self.assertIn('budget',result['error'])
        self.assertFalse((self.root/'exports/all.csv').exists())
        self.width=0;self.source['totalRows']=120001
        result=self.wait(self.start('table','incomplete'));self.assertEqual(result['state'],'error');self.assertIn('not received',result['error'])
        self.assertEqual(self.ws.connection.execute("select count(*) from duckdb_tables() where table_name='incomplete'").fetchone()[0],0)
    def test_cancel_and_owner(self):
        self.gate=threading.Event();token=self.start()
        for _ in range(300):
            if self.transfers.status(token,self.session)['rows']>=1000:break
            time.sleep(.01)
        with self.assertRaises(ValueError):self.transfers.cancel(token,'other')
        self.transfers.cancel(token,self.session);self.gate.set()
        self.assertEqual(self.wait(token)['state'],'cancelled');self.assertFalse((self.root/'exports/all.csv').exists())
    def test_postgres_requires_explicit_rerun_permission(self):
        self.source.update(provider='postgres',truncated=True)
        self.assertTrue(self.transfers.plan('original',self.session)['rerun'])
        with self.assertRaisesRegex(ValueError,'run again'):self.start()
        class Connector:
            def stream_result(inner,sql,jobid,consume):
                self.calls.append(('postgres',sql));consume(pa.table({'id':[1,2]}))
            def close(inner):pass
        self.remote.connector=lambda config:Connector()
        result=self.wait(self.start(allowRerun=True));self.assertEqual(result['state'],'done',result);self.assertEqual(result['rows'],2)
    def test_confirmation_names_and_existing_files(self):
        with self.assertRaises(ValueError):self.start(confirmed=False)
        with self.assertRaises(ValueError):self.start(name='../outside.csv')
        (self.root/'exports/all.csv').write_text('original')
        with self.assertRaises(ValueError):self.start()
        self.assertEqual((self.root/'exports/all.csv').read_text(),'original')

    def test_both_downloads_once_with_independent_names(self):
        result=self.wait(self.start('both',csvName='shared.csv',tableName='analysis'))
        self.assertEqual(result['state'],'done',result)
        self.assertEqual(sum(c[0]=='get_job' for c in self.calls),1)
        self.assertEqual(self.ws.connection.execute('select count(*) from analysis').fetchone()[0],120000)
        with (self.root/'exports/shared.csv').open() as f:self.assertEqual(sum(1 for _ in csv.reader(f)),120001)

    def test_both_failure_rolls_back_table_and_preserves_existing_csv(self):
        destination=self.root/'exports/shared.csv'
        def collision(source,target):
            destination.write_text('existing file')
            raise FileExistsError('collision')
        with patch('remote_transfers.os.link',side_effect=collision):
            result=self.wait(self.start('both',csvName='shared.csv',tableName='analysis'))
        self.assertEqual(result['state'],'error',result)
        self.assertEqual(destination.read_text(),'existing file')
        self.assertEqual(self.ws.connection.execute("select count(*) from duckdb_tables() where table_name='analysis'").fetchone()[0],0)

    def test_both_cancel_publishes_neither(self):
        self.gate=threading.Event();token=self.start('both',csvName='shared.csv',tableName='analysis')
        for _ in range(300):
            if self.transfers.status(token,self.session)['rows']>=1000:break
            time.sleep(.01)
        self.transfers.cancel(token,self.session);self.gate.set()
        self.assertEqual(self.wait(token)['state'],'cancelled')
        self.assertFalse((self.root/'exports/shared.csv').exists())
        self.assertEqual(self.ws.connection.execute("select count(*) from duckdb_tables() where table_name='analysis'").fetchone()[0],0)
