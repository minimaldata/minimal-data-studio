"""Session lifecycle and concurrent cancellation, without network or credentials."""
import threading
import unittest
from remote_connectors import SnowflakeSessions, ConnectorError

class FakeConnector:
    def __init__(self, config):
        self.config=config; self.conn=self; self.closed=False
        self.cancelled=threading.Event(); self.unusable=False
        self.entered=threading.Event(); self.release=threading.Event()
    def is_closed(self):return self.closed
    def close(self):self.closed=True
    def catalog(self, schema=None):return schema or 'schemas'
    def query(self, sql):
        if sql=='block':
            self.entered.set(); assert self.release.wait(3)
        if sql=='syntax':raise ConnectorError('Bad SQL')
        if sql=='expired':
            self.unusable=True; raise ConnectorError('Expired')
        return sql
    def cancel(self, timeout=15):self.cancelled.set();self.release.set()

class SessionChecks(unittest.TestCase):
    def setUp(self):
        self.created=[]
        def factory(config):
            conn=FakeConnector(config);self.created.append(conn);return conn
        self.pool=SnowflakeSessions(factory)
        self.config={'id':'a','provider':'snowflake'}
    def tearDown(self):self.pool.close()
    def lease(self):return self.pool.lease(self.config)
    def test_browse_and_queries_share_login(self):
        self.assertEqual(self.lease().catalog(),'schemas')
        self.assertEqual(self.lease().catalog('PUBLIC'),'PUBLIC')
        for _ in range(3):
            lease=self.lease(); self.assertEqual(lease.query('SELECT 1'),'SELECT 1');lease.close()
        self.assertEqual(len(self.created),1)
        self.assertFalse(self.created[0].closed)
    def test_errors_and_expiry(self):
        with self.assertRaises(ConnectorError):self.lease().query('syntax')
        self.lease().query('ok');self.assertEqual(len(self.created),1)
        with self.assertRaises(ConnectorError):self.lease().query('expired')
        self.assertTrue(self.created[0].closed)
        self.lease().query('ok');self.assertEqual(len(self.created),2)
    def test_settings_and_shutdown(self):
        self.lease().catalog();old=self.created[0]
        stale=self.lease();self.pool.invalidate('a');self.assertTrue(old.closed)
        with self.assertRaises(ConnectorError):stale.query('ok')
        self.lease().catalog();self.pool.close();self.assertTrue(self.created[-1].closed)
        with self.assertRaises(ConnectorError):self.lease()
    def test_closed_connection_and_project_isolation(self):
        self.lease().catalog();self.created[0].close();self.lease().catalog()
        self.assertEqual(len(self.created),2)
        other=SnowflakeSessions(FakeConnector)
        try:
            other.lease(self.config).catalog();self.pool.close()
            self.assertEqual(other.lease(self.config).query('ok'),'ok')
        finally:other.close()
    def test_queued_cancel_and_late_cancel_are_isolated(self):
        first=self.lease();first.catalog();conn=self.created[0]
        thread=threading.Thread(target=lambda:first.query('block'));thread.start()
        self.assertTrue(conn.entered.wait(1))
        queued=self.lease();errors=[]
        def wait():
            try:queued.query('ok')
            except ConnectorError as error:errors.append(str(error))
        second=threading.Thread(target=wait);second.start();queued.cancel();second.join(2)
        self.assertFalse(second.is_alive());self.assertTrue(errors)
        self.assertFalse(conn.cancelled.is_set())
        conn.release.set();thread.join(2)
        first.cancel();self.assertFalse(conn.cancelled.is_set())
        self.assertEqual(self.lease().query('ok'),'ok');self.assertEqual(len(self.created),1)
    def test_active_cancel_retires_connection(self):
        lease=self.lease();lease.catalog();conn=self.created[0]
        thread=threading.Thread(target=lambda:lease.query('block'));thread.start()
        self.assertTrue(conn.entered.wait(1));lease.cancel();thread.join(2)
        self.assertTrue(conn.closed)
        self.lease().query('ok');self.assertEqual(len(self.created),2)
    def test_serializes_browse_and_query(self):
        lease=self.lease();lease.catalog();conn=self.created[0]
        thread=threading.Thread(target=lambda:lease.query('block'));thread.start()
        self.assertTrue(conn.entered.wait(1));done=threading.Event()
        second=threading.Thread(target=lambda:(self.lease().catalog(),done.set()));second.start()
        self.assertFalse(done.wait(.15));conn.release.set()
        thread.join(2);second.join(2);self.assertTrue(done.is_set());self.assertEqual(len(self.created),1)
