import unittest
from workspace_access import WorkspaceAccess

class WorkspaceAccessChecks(unittest.TestCase):
    def setUp(self):
        self.now=0;self.access=WorkspaceAccess(clock=lambda:self.now,ttl=30)
        self.a='browser-a';self.b='browser-b'
    def test_cooperative_transfer_and_stale_writer_rejection(self):
        a=self.access
        self.assertTrue(a.handle(self.a,'hello')['writer'])
        self.assertFalse(a.handle(self.b,'hello')['writer'])
        self.assertFalse(a.writable(None))
        self.assertTrue(a.handle(self.b,'request')['waiting'])
        self.assertTrue(a.handle(self.a)['requested'])
        self.assertTrue(a.writable(self.a))
        a.handle(self.a,'yield')
        self.assertFalse(a.writable(self.a));self.assertTrue(a.writable(self.b))
        token=a.handle(self.b,'ticket')['ticket']
        self.assertTrue(a.handle('browser-c','hello',token)['writer'])
        self.assertFalse(a.handle('browser-d','hello',token)['writer'])
    def test_cancel_close_expiry_and_resume_do_not_steal_editing(self):
        a=self.access;a.handle(self.a,'hello');a.handle(self.b,'hello');a.handle(self.b,'request');a.handle(self.b,'cancel')
        self.assertFalse(a.handle(self.a)['requested'])
        self.now=31
        self.assertFalse(a.writable(self.a))
        self.assertTrue(a.handle(self.b,'request')['writer'])
        self.assertFalse(a.handle(self.a)['writer'])
        a.handle(self.b,'release');self.assertTrue(a.handle(self.a,'request')['writer'])
    def test_simultaneous_requests_keep_single_pending_writer(self):
        a=self.access;a.handle(self.a,'hello');a.handle(self.b,'request')
        with self.assertRaises(ValueError):a.handle('browser-c','request')
        self.assertTrue(a.handle(self.b)['waiting'])
