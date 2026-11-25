import json
import tempfile
import unittest
from pathlib import Path
from workspace_db import Workspace
from interactive_inputs import catalog, refresh

class InputChecks(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        self.ws=Workspace(self.root,self.root,seed_samples=False,migrate_legacy=False)
        self.ws.connection.execute("CREATE TABLE revenue AS SELECT DATE '2028-12-31' AS month_end, 1234.56::DECIMAL(20,2) AS mrr_usd")
        self.ws.connection.execute('CREATE VIEW metrics AS SELECT * FROM revenue')
        self.queries=[dict(id='q1',name='Summary',sql='SELECT sum(mrr_usd) AS total FROM revenue')]
        self.save_queries()
    def save_queries(self): (self.root/'saved_queries.json').write_text(json.dumps({'queries':self.queries}))
    def tearDown(self):self.ws.close();self.tmp.cleanup()
    def test_catalog_and_complete_snapshot_provenance(self):
        self.assertEqual({s['kind'] for s in catalog(self.ws,self.root)['sources']},{'table','view','query'})
        bindings=[dict(name='history',kind='view',source='metrics'),dict(name='total',kind='query',source='q1')]
        first=refresh(self.ws,self.root,bindings)
        self.assertEqual(first['inputs']['history'],[{'month_end':'2028-12-31','mrr_usd':'1234.56'}])
        self.assertEqual(first['metadata']['history']['rows'],1)
        second=refresh(self.ws,self.root,bindings)
        self.assertEqual(first['metadata']['history']['contentHash'],second['metadata']['history']['contentHash'])
        self.ws.connection.execute('UPDATE revenue SET mrr_usd=2000')
        self.assertNotEqual(first['metadata']['history']['contentHash'],refresh(self.ws,self.root,bindings)['metadata']['history']['contentHash'])
    def test_oversized_missing_and_mutating_queries_fail(self):
        self.ws.connection.execute('CREATE TABLE large AS SELECT * FROM range(10001)')
        with self.assertRaisesRegex(ValueError,'10,000'):refresh(self.ws,self.root,[dict(name='big',kind='table',source='large')])
        with self.assertRaisesRegex(ValueError,'unavailable'):refresh(self.ws,self.root,[dict(name='missing',kind='view',source='gone')])
        self.queries[0]['sql']='DELETE FROM revenue';self.save_queries()
        with self.assertRaisesRegex(ValueError,'read-only'):refresh(self.ws,self.root,[dict(name='x',kind='query',source='q1')])
        self.assertEqual(self.ws.connection.execute('SELECT count(*) FROM revenue').fetchone()[0],1)
        self.queries[0]['sql']='SELECT 1; SELECT 2';self.save_queries()
        with self.assertRaises(ValueError):refresh(self.ws,self.root,[dict(name='x',kind='query',source='q1')])
    def test_missing_remote_duplicate_and_size_limits(self):
        self.queries[0]['connection']='remote';self.save_queries()
        self.assertNotIn('query',{s['kind'] for s in catalog(self.ws,self.root)['sources']})
        with self.assertRaises(ValueError):refresh(self.ws,self.root,[dict(name='x',kind='query',source='q1')])
        self.queries[0].pop('connection');self.queries[0]['sql']="SELECT repeat('x',1000001) AS big";self.save_queries()
        with self.assertRaisesRegex(ValueError,'1 MB'):refresh(self.ws,self.root,[dict(name='x',kind='query',source='q1')])
        with self.assertRaisesRegex(ValueError,'unique'):refresh(self.ws,self.root,[dict(name='x',kind='view',source='metrics')]*2)

    def test_declared_input_contracts(self):
        folder=self.root/'interactive'/'example';folder.mkdir(parents=True)
        (folder/'index.html').write_text('<h1>Example</h1>')
        contract={'history':{'label':'Historical recurring revenue','required':True,'columns':{'month_end':'date','mrr_usd':'number'}}}
        (folder/'app.json').write_text(json.dumps({'format':1,'inputs':contract}))
        bindings=[dict(name='history',kind='view',source='metrics')]
        self.assertEqual(refresh(self.ws,self.root,bindings,'interactive/example')['metadata']['history']['rows'],1)
        with self.assertRaisesRegex(ValueError,'Choose a source for Historical'):
            refresh(self.ws,self.root,[],'interactive/example')
        self.ws.connection.execute('CREATE OR REPLACE VIEW metrics AS SELECT month_end FROM revenue')
        with self.assertRaisesRegex(ValueError,'missing column mrr_usd'):
            refresh(self.ws,self.root,bindings,'interactive/example')
        self.ws.connection.execute("CREATE OR REPLACE VIEW metrics AS SELECT month_end, CAST(mrr_usd AS VARCHAR) AS mrr_usd FROM revenue WHERE false")
        with self.assertRaisesRegex(ValueError,'must be number'):
            refresh(self.ws,self.root,bindings,'interactive/example')
        contract['history']['columns']['mrr_usd']='anything'
        (folder/'app.json').write_text(json.dumps({'format':1,'inputs':contract}))
        with self.assertRaisesRegex(ValueError,'Input columns'):
            refresh(self.ws,self.root,bindings,'interactive/example')

    def test_app_sql_registers_and_is_read_only(self):
        folder=self.root/'interactive'/'sqlapp';folder.mkdir(parents=True)
        (folder/'index.html').write_text('<h1>Example</h1>')
        manifest={'format':1,'inputs':{'history':{'sql':'history.sql','required':True,'columns':{'mrr_usd':'number'}}}}
        (folder/'app.json').write_text(json.dumps(manifest))
        sql=folder/'history.sql';sql.write_text('SELECT * FROM revenue')
        result=refresh(self.ws,self.root,[], 'interactive/sqlapp')
        preview=refresh(self.ws,self.root,[],'interactive/sqlapp',{'name':'history','content':'SELECT mrr_usd * 100000 AS mrr_usd FROM revenue'})
        self.assertEqual(preview['inputs']['history'][0]['mrr_usd'],'123456000.00')
        self.assertEqual(sql.read_text(),'SELECT * FROM revenue')
        with self.assertRaisesRegex(ValueError,'read-only'):
            refresh(self.ws,self.root,[],'interactive/sqlapp',{'name':'history','content':'DELETE FROM revenue'})
        self.assertEqual(result['metadata']['history']['kind'],'app-sql')
        self.assertEqual(result['inputs']['history'][0]['mrr_usd'],'1234.56')
        # Manifest source supersedes an existing manual binding without rewriting it.
        legacy=[dict(name='history',kind='view',source='missing')]
        self.assertEqual(refresh(self.ws,self.root,legacy,'interactive/sqlapp')['inputs'], result['inputs'])
        for bad in ['DELETE FROM revenue', 'SELECT 1; SELECT 2', 'CREATE TABLE injected AS SELECT 1']:
            sql.write_text(bad)
            with self.assertRaisesRegex(ValueError,'read-only'):
                refresh(self.ws,self.root,[], 'interactive/sqlapp')
        self.assertEqual(self.ws.connection.execute('SELECT count(*) FROM revenue').fetchone()[0],1)
        manifest['inputs']['history']['sql']='../outside.sql'
        (folder/'app.json').write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError,'missing or unsupported SQL'):
            refresh(self.ws,self.root,[], 'interactive/sqlapp')

    def test_result_tables_create_only_and_rollback(self):
        from interactive_inputs import create_result_table
        request={'name':'forecast','columns':[{'name':'month','type':'date'},{'name':'mrr','type':'number'}], 'rows':[{'month':'2029-01-31','mrr':1234.5}]}
        self.ws.connection.execute("INSERT INTO _studio.database_folders VALUES ('Scenarios')")
        request['folder']='Scenarios'
        self.assertEqual(create_result_table(self.ws,request),{'name':'forecast','rows':1})
        self.assertEqual(self.ws.connection.execute("SELECT folder FROM _studio.database_locations WHERE name='forecast'").fetchone()[0],'Scenarios')
        self.assertEqual(self.ws.connection.execute('SELECT mrr FROM forecast').fetchone()[0],1234.5)
        for name in ['forecast','FORECAST','metrics']:
            request['name']=name
            with self.assertRaisesRegex(ValueError,'already exists'):create_result_table(self.ws,request)
        request['name']='invalid_dates';request['rows'][0]['month']='not-a-date'
        with self.assertRaises(Exception):create_result_table(self.ws,request)
        self.assertNotIn('invalid_dates',self.ws.catalog_objects(self.ws.connection))
        request['name']='_studio.secret'
        with self.assertRaises(ValueError):create_result_table(self.ws,request)

class ParameterChecks(unittest.TestCase):
    def test_typed_bound_values_and_injection(self):
        from interactive_parameters import parameter_values
        with tempfile.TemporaryDirectory() as root:
            folder=Path(root)/'app';folder.mkdir()
            specs={'customer':{'type':'string','default':'A'},'start':{'type':'date','default':'2025-01-01'},'amount':{'type':'number','default':1}}
            (folder/'app.json').write_text(json.dumps({'format':1,'parameters':specs,'inputs':{'data':{'sql':'data.sql'}}}))
            (folder/'index.html').write_text('Example')
            (folder/'data.sql').write_text('SELECT $customer AS customer, CAST($start AS DATE) AS day, $amount AS amount')
            ws=Workspace(root,root,seed_samples=False,migrate_legacy=False)
            try:
                malicious="A'; DROP TABLE anything; --"
                result=refresh(ws,root,[],'app',parameters={'customer':malicious,'amount':42})
                self.assertEqual(result['inputs']['data'][0],{'customer':malicious,'day':'2025-01-01','amount':42})
                self.assertEqual(result['metadata']['data']['parameters']['customer'],malicious)
                for values in ({'unknown':1},{'amount':True},{'start':'2025-02-30'},{'customer':None}):
                    with self.assertRaises(ValueError):refresh(ws,root,[],'app',parameters=values)
                (folder/'data.sql').write_text('SELECT $undeclared')
                with self.assertRaisesRegex(ValueError,'undeclared'):refresh(ws,root,[],'app')
            finally:ws.close()

class QueryDeadlineChecks(unittest.TestCase):
    def test_long_query_interrupts_and_connection_remains_usable(self):
        from interactive_query import input_cursor
        with tempfile.TemporaryDirectory() as root:
            ws=Workspace(root,root,seed_samples=False,migrate_legacy=False)
            try:
                with self.assertRaisesRegex(ValueError,'exceeded'):
                    with input_cursor(ws,timeout=.03) as c:
                        c.execute('BEGIN TRANSACTION READ ONLY')
                        c.execute('SELECT sum(sin(i)) FROM range(1000000000) t(i)')
                with input_cursor(ws,timeout=2) as c:
                    self.assertEqual(c.execute('SELECT 42').fetchone(),(42,))
            finally:ws.close()

class BundledParameterExampleChecks(unittest.TestCase):
    def test_starter_runs_without_existing_tables(self):
        import shutil
        with tempfile.TemporaryDirectory() as root:
            shutil.copytree(Path(__file__).resolve().parents[1]/'examples/interactive/parameterized-review',Path(root)/'app')
            ws=Workspace(root,root,seed_samples=False,migrate_legacy=False)
            try:
                self.assertEqual(len(refresh(ws,root,[],'app')['inputs']['payments']),3)
                result=refresh(ws,root,[],'app',parameters={'from_date':'2026-02-01','minimum_amount':1500})
                self.assertEqual(len(result['inputs']['payments']),2)
                self.assertEqual(result['metadata']['payments']['parameters']['minimum_amount'],1500)
            finally:ws.close()
