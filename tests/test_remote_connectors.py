"""No network, ambient profiles or real credentials: injected DB-API transports."""
import datetime
import decimal
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
import pyarrow as pa
from remote_connectors import ReadOnlyConnector, ConnectorError, arrow_result, select_only, validate_config, safe_error
from remote_sources import RemoteSources
from project_files import ProjectFiles
from workspace_db import Workspace

PG={'provider':'postgres','name':'Local service','service':'studio_test','timeoutSeconds':60}
SF={'provider':'snowflake','name':'SSO','account':'org-account','user':'reader','role':'READER','warehouse':'COMPUTE_WH','database':'ANALYTICS','timeoutSeconds':60}

def desc(name,code=20,precision=None,scale=None):return (name,code,None,None,precision,scale,None)
class Cursor:
    def __init__(self,rows,description=None):
        self.rows=list(rows);self.description=description or [desc('id')];self.calls=[];self.closed=False;self.sfqid='fake-job'
    def execute(self,*args,**kwargs):self.calls.append((args,kwargs));return self
    def fetchmany(self,n):rows=self.rows[:n];self.rows=self.rows[n:];return rows
    def close(self):self.closed=True
    def __enter__(self):return self
    def __exit__(self,*args):self.close()
class Connection:
    def __init__(self,rows=(),description=None):self.cur=Cursor(rows,description);self.cursor_kwargs=[];self.rolled_back=False;self.closed=False;self.cancelled=False
    def cursor(self,**kwargs):self.cursor_kwargs.append(kwargs);return self.cur
    def rollback(self):self.rolled_back=True
    def close(self):self.closed=True
    def cancel_safe(self,**kwargs):self.cancelled=True

class ConnectorChecks(unittest.TestCase):
    def test_select_guard_before_any_connection(self):
        for kind in ('postgres','snowflake'):
            for sql in ['SELECT 1',"WITH a AS (SELECT 'delete' AS x) SELECT * FROM a",'SELECT 1 UNION ALL SELECT 2']:
                self.assertEqual(select_only(sql,kind),sql)
            for sql in ['DELETE FROM x','CREATE TABLE x AS SELECT 1','SELECT 1; SELECT 2','SELECT * INTO x FROM y','SELECT * FROM x FOR UPDATE','WITH a AS (DELETE FROM x RETURNING *) SELECT * FROM a','COPY x TO STDOUT','CALL dangerous()']:
                with self.subTest(kind=kind,sql=sql),self.assertRaisesRegex(ConnectorError,'read-only'):select_only(sql,kind)
        with self.assertRaises(ConnectorError):select_only("SELECT SYSTEM$CANCEL_QUERY('id')",'snowflake')
        called=[]
        with self.assertRaises(ConnectorError):ReadOnlyConnector(PG,lambda _:called.append(1)).query('DROP TABLE x')
        self.assertFalse(called)
    def test_metadata_rejects_secrets_and_connection_strings(self):
        self.assertEqual(validate_config(PG),PG)
        self.assertEqual(validate_config(SF),dict(SF,authentication='sso'))
        for bad in [dict(PG,password='secret'),dict(PG,service='postgresql://user:secret@host/db'),dict(SF,token='secret'),dict(PG,timeoutSeconds=0),dict(PG,timeoutSeconds=True),dict(SF,account='https://example.com')]:
            with self.assertRaises(ConnectorError):validate_config(bad)
        self.assertNotIn('secret',safe_error(ValueError('password=secret'),'postgres'))
    def test_snowflake_auth_diagnostics_expose_codes_not_secret_messages(self):
        error=RuntimeError('password=secret token=private')
        error.errno=390100;error.sqlstate='28000'
        message=safe_error(error,'snowflake')
        self.assertIn('390100',message);self.assertIn('28000',message);self.assertIn('login username',message)
        self.assertNotIn('secret',message);self.assertNotIn('private',message)
        error.errno='password=secret';error.sqlstate='token=private'
        message=safe_error(error,'snowflake')
        self.assertNotIn('secret',message);self.assertNotIn('private',message)

    def test_types_empty_null_decimal_and_complex(self):
        schema=[desc('id',20),desc('money',1700,30,5),desc('date',1082),desc('json',3802)]
        rows=[(2**63-1,decimal.Decimal('12345678901234567890.12345'),datetime.date(2025,1,2),{'ok':True})]
        table=arrow_result(rows,schema,'postgres')
        self.assertEqual(table['money'][0].as_py(),rows[0][1]);self.assertEqual(table.schema.field('date').type,pa.date32())
        self.assertEqual(arrow_result([],schema,'postgres').schema.field('money').type,pa.decimal128(30,5))
        self.assertEqual(arrow_result([(None,)], [desc('id',20)],'postgres').schema.field('id').type,pa.int64())
        sf=arrow_result([(123,True)], [desc('amount',0,38,0),desc('valid',13)],'snowflake')
        self.assertEqual(sf['amount'][0].as_py(),decimal.Decimal(123));self.assertTrue(sf['valid'][0].as_py())
    def test_full_postgres_stream_uses_server_cursor_and_bounded_batches(self):
        conn=Connection([(i,) for i in range(120001)])
        adapter=ReadOnlyConnector(PG,lambda _:conn);sizes=[]
        adapter.stream_result('SELECT id FROM x','old-query',lambda table,empty=False:sizes.append(table.num_rows))
        self.assertEqual(sum(sizes),120001);self.assertLessEqual(max(sizes),1000)
        self.assertTrue(conn.cur.closed);self.assertTrue(conn.rolled_back);self.assertTrue(conn.cursor_kwargs[0]['name'])

    def test_full_snowflake_stream_reuses_original_result(self):
        from unittest.mock import MagicMock
        cur=MagicMock();cur.description=[desc('id',0,38,0)];cur.fetchmany.side_effect=[[(1,),(2,)],[]]
        conn=MagicMock();conn.cursor.return_value=cur
        adapter=ReadOnlyConnector(SF,lambda _:conn);sizes=[]
        adapter.stream_result('SELECT id FROM x','original-snowflake-job',lambda table,empty=False:sizes.append(table.num_rows))
        cur.get_results_from_sfqid.assert_called_once_with('original-snowflake-job');cur.execute.assert_not_called();cur.execute_async.assert_not_called()
        self.assertEqual(sum(sizes),2);self.assertTrue(cur.close.called)

    def test_query_stream_preview_snapshot_limits_and_cleanup(self):
        conn=Connection([(i,) for i in range(1200)])
        adapter=ReadOnlyConnector(PG,lambda _:conn)
        result=adapter.query('SELECT id FROM x')
        self.assertEqual(result['arrow'].num_rows,1000);self.assertEqual(result['snapshotArrow'].num_rows,1200)
        self.assertTrue(conn.cur.closed);self.assertTrue(conn.rolled_back);self.assertTrue(conn.cursor_kwargs[0]['name'])
        adapter.cancel();self.assertTrue(conn.cancelled);adapter.close();self.assertTrue(conn.closed)
        conn=Connection([(i,) for i in range(1200)])
        with patch('remote_connectors.MAX_ROWS',1000):result=ReadOnlyConnector(PG,lambda _:conn).query('SELECT id FROM x')
        self.assertTrue(result['truncated']);self.assertIsNone(result['snapshotArrow'])
        conn=Connection([('long string',)], [desc('value',25)])
        with patch('remote_connectors.MAX_BYTES',4),self.assertRaisesRegex(ConnectorError,'64 MB'):ReadOnlyConnector(PG,lambda _:conn).query('SELECT value FROM x')
    def test_oversized_batch_returns_fitting_rows_not_an_error(self):
        for budget,expected in ((24,3),(4008,501)):
            conn=Connection([(i,) for i in range(1200)])
            with patch('remote_connectors.MAX_BYTES',budget):
                result=ReadOnlyConnector(PG,lambda _:conn).query('SELECT id FROM x')
            self.assertEqual(result['arrow'].num_rows,expected)
            self.assertEqual(result['availableRows'],expected)
            self.assertLessEqual(result['displayArrow'].nbytes,budget)
            self.assertTrue(result['truncated']);self.assertIsNone(result['snapshotArrow'])
            self.assertIn('Preview limit reached',result['warning'])
            self.assertTrue(conn.cur.closed)
        conn=Connection([(i,) for i in range(1200)])
        with patch('remote_connectors.MAX_ROWS',750):
            result=ReadOnlyConnector(PG,lambda _:conn).query('SELECT id FROM x')
        self.assertEqual(result['availableRows'],750)

    def test_final_inference_growth_keeps_a_limited_preview(self):
        # An all-null batch is provisionally text; the combined numeric result
        # uses eight bytes per value, including the earlier nulls.
        conn=Connection([(None,)]*500+[(float(i),) for i in range(500)], [desc('value',999)])
        with patch('remote_connectors.MAX_BYTES',6200):
            result=ReadOnlyConnector(PG,lambda _:conn).query('SELECT value FROM x')
        self.assertTrue(result['truncated']);self.assertIsNone(result['snapshotArrow'])
        self.assertGreater(result['availableRows'],500)
        self.assertLess(result['availableRows'],1000)
        self.assertLessEqual(result['displayArrow'].nbytes,6200)
        self.assertEqual(result['displayArrow'].schema.field('value').type,pa.float64())

    def test_catalog_parameter_binding_and_quoted_identifiers(self):
        conn=Connection([('table"name','VIEW')])
        result=ReadOnlyConnector(PG,lambda _:conn).catalog('schema"name')
        self.assertIn('FROM "schema""name"."table""name"',result['tables'][0]['sql'])
        self.assertEqual(conn.cur.calls[0][0][1],('schema"name',));self.assertNotIn('schema"name',conn.cur.calls[0][0][0])
        conn=Connection([('ITEMS','BASE TABLE')])
        result=ReadOnlyConnector(SF,lambda _:conn).catalog('PUBLIC')
        self.assertIn('"ANALYTICS"."PUBLIC"."ITEMS"',result['tables'][0]['sql'])
    def test_native_driver_settings_and_snowflake_async_result(self):
        from unittest.mock import MagicMock
        pg=MagicMock()
        with patch('psycopg.connect',return_value=pg) as connect:
            adapter=ReadOnlyConnector(PG);adapter.connect()
            self.assertTrue(pg.read_only)
            self.assertEqual(connect.call_args.kwargs['sslmode'],'verify-full')
            self.assertIn('default_transaction_read_only=on',connect.call_args.kwargs['options'])
            self.assertNotIn('password',connect.call_args.kwargs)
        sf=MagicMock();cur=sf.cursor.return_value;cur.sfqid='running-job'
        cur.description=[desc('id',0,38,0)];cur.fetchmany.side_effect=[[(1,)],[]]
        sf.is_still_running.side_effect=[True,False]
        with patch('snowflake.connector.connect',return_value=sf) as connect,patch('remote_connectors.time.sleep'):
            adapter=ReadOnlyConnector(SF);result=adapter.query('SELECT 1 AS id')
            self.assertEqual(connect.call_args.kwargs['authenticator'],'externalbrowser')
            self.assertFalse(connect.call_args.kwargs['client_store_temporary_credential'])
            cur.__enter__.return_value.execute.assert_called_with('USE SECONDARY ROLES NONE')
            cur.execute_async.assert_called_once_with('SELECT 1 AS id')
            cur.get_results_from_sfqid.assert_called_once_with('running-job')
            self.assertEqual(result['jobId'],'running-job')
        # Cancellation uses the running Snowflake query ID, rather than closing a cursor only.
        adapter.cursor=cur;adapter.cancel()
        cur.__enter__.return_value.execute.assert_called_with('SELECT SYSTEM$CANCEL_QUERY(%s)',('running-job',),timeout=15)

    def test_keychain_password_mfa_is_ephemeral_and_failures_are_redacted(self):
        from unittest.mock import MagicMock
        config=dict(SF,id='connection1',authentication='password_mfa',credentialId='credential-1',mfaMethod='passcode')
        self.assertEqual(validate_config(config)['credentialId'],'credential-1')
        with self.assertRaises(ConnectorError):validate_config(dict(config,password='never-save'))
        values={'password':'dummy-private-password','passcode':'654321'}
        sf=MagicMock();calls=[]
        def connect(**kwargs):calls.append(dict(kwargs));return sf
        with patch('snowflake.connector.connect',side_effect=connect):
            adapter=ReadOnlyConnector(config,credential_resolver=lambda _:values);adapter.connect();adapter.close()
        self.assertEqual(calls[0]['authenticator'],'username_password_mfa')
        self.assertEqual(calls[0]['password'],'dummy-private-password');self.assertEqual(calls[0]['passcode'],'654321')
        self.assertFalse(calls[0]['client_store_temporary_credential']);self.assertEqual(values,{})
        self.assertNotIn('password',adapter.config);self.assertNotIn('passcode',adapter.config)
        with patch('snowflake.connector.connect',side_effect=RuntimeError('dummy-private-password 654321')):
            with self.assertRaises(ConnectorError) as error:
                ReadOnlyConnector(config,credential_resolver=lambda _:dict(password='dummy-private-password',passcode='654321')).connect()
            self.assertNotIn('dummy-private-password',str(error.exception));self.assertNotIn('654321',str(error.exception))
        with patch('snowflake.connector.connect') as connect:
            with self.assertRaisesRegex(ConnectorError,'Mac preview'):ReadOnlyConnector(config).connect()
            connect.assert_not_called()
        with patch('snowflake.connector.connect') as connect:
            with self.assertRaisesRegex(ConnectorError,'not provided'):
                ReadOnlyConnector(config,credential_resolver=lambda _:dict(password='dummy')).connect()
            connect.assert_not_called()

    def test_mfa_approval_caching_is_automatic(self):
        from unittest.mock import MagicMock
        for method in ('push','passcode'):
            config=validate_config(dict(SF,authentication='password_mfa',credentialId='credential-1',mfaMethod=method))
            with patch('snowflake.connector.connect',return_value=MagicMock()) as connect:
                ReadOnlyConnector(config,credential_resolver=lambda _:dict(password='dummy',passcode='123456')).connect()
            kwargs=connect.call_args.kwargs
            self.assertTrue(kwargs['client_request_mfa_token'])
            self.assertEqual(kwargs['authenticator'],'username_password_mfa')
            self.assertFalse(kwargs['client_store_temporary_credential'])
            self.assertNotIn('password',config)

    def test_authentication_progress_does_not_claim_push_delivery(self):
        from unittest.mock import MagicMock
        phases=[]
        config=dict(SF,authentication='password_mfa',credentialId='credential-1',mfaMethod='push')
        with patch('snowflake.connector.connect',return_value=MagicMock()):
            adapter=ReadOnlyConnector(config,credential_resolver=lambda _:dict(password='dummy'),progress=phases.append)
            adapter.connect();adapter.connect()
        self.assertEqual(phases,['credentials','mfa_push','connected','connected'])
        self.assertNotIn('dummy',' '.join(phases))

    def test_cancel_before_authentication_never_executes(self):
        conn=Connection([(1,)])
        adapter=ReadOnlyConnector(PG,lambda _:conn);adapter.cancel()
        with self.assertRaisesRegex(ConnectorError,'Cancelled'):adapter.query('SELECT 1')
        self.assertEqual(conn.cur.calls,[])

class SnapshotChecks(unittest.TestCase):
    def test_retained_result_no_reconnect_no_partial_and_read_only_capabilities(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);files=ProjectFiles(root);ws=Workspace(root,root/'data',root,seed_samples=False)
            try:
                session=ws.new_session()['session'];calls=[]
                def factory(config):
                    calls.append(config)
                    return ReadOnlyConnector(config,lambda _:Connection([(i,) for i in range(1200)]))
                remote=RemoteSources(root,ws,files,connector_factory=factory)
                state=remote.save({'revision':0,'connection':PG});key=state['connections'][0]['id']
                self.assertFalse(state['connections'][0]['capabilities']['publish'])
                for action in ('upload','model_publish'):
                    with self.assertRaisesRegex(ValueError,'read-only'):remote.start({'connection':key,'action':action},session)
                with self.assertRaisesRegex(ValueError,'only for BigQuery'):
                    remote.models.save({'connection':key,'name':'Bad','dataset':'x','table':'x','kind':'view','sql':'SELECT 1'})
                job=remote.start({'connection':key,'action':'query','sql':'SELECT id FROM source'},session)['id']
                for _ in range(300):
                    if remote.status(job,session)['state']!='running':break
                    time.sleep(.01)
                self.assertEqual(remote.status(job,session)['state'],'done')
                self.assertEqual(remote.snapshot({'id':job,'name':'snapshot'},session)['rows'],1200)
                self.assertEqual(len(calls),1)
                with self.assertRaises(ValueError):remote.snapshot({'id':job,'name':'snapshot'},session)
                remote.jobs[job]['truncated']=True
                with self.assertRaisesRegex(ValueError,'incomplete'):remote.snapshot({'id':job,'name':'partial'},session)
                self.assertFalse(ws.session(session)['conn'].execute("SELECT * FROM information_schema.tables WHERE table_name='partial'").fetchall())
            finally:ws.close()
