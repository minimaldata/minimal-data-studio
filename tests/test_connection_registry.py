import json
from pathlib import Path
import tempfile
import unittest
from connection_registry import ConnectionRegistry

class ConnectionRegistryChecks(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.registry=ConnectionRegistry(self.root/'central')
        self.a=self.root/'A/.studio/connections.json';self.b=self.root/'B/.studio/connections.json'
        self.config={'name':'Warehouse','provider':'bigquery','project':'sample-project','location':'US'}
    def tearDown(self):self.tmp.cleanup()
    def save(self,config=None,**extra):return self.registry.save({'revision':self.registry.view()['revision'],'connection':config or self.config,**extra})
    def attach(self,path,key,**extra):return self.registry.attach(path,{'revision':self.registry.project(path)['revision'],'connectionId':key,**extra})
    def test_shared_edit_and_project_detach(self):
        c=self.save();a=self.attach(self.a,c['id']);self.attach(self.b,c['id'])
        with self.assertRaisesRegex(ValueError,'Confirm'):self.save(dict(c,project='other-project'))
        self.save(dict(c,project='other-project'),confirmed=True)
        self.assertEqual(self.registry.project(self.b)['connections'][0]['project'],'other-project')
        self.assertEqual(len(self.registry.view()['connections'][0]['projects']),2)
        self.registry.detach(self.a,{'revision':a['revision'],'id':c['id']})
        self.assertEqual(len(self.registry.project(self.b)['connections']),1)
        text=self.b.read_text();self.assertNotIn('other-project',text);self.assertNotIn('maximumBytes',text)
    def test_migrate_keeps_ids_and_does_not_merge_connections(self):
        for p in [self.a,self.b]:
            p.parent.mkdir(parents=True);p.write_text(json.dumps({'revision':4,'connections':[dict(self.config,id='old-id')]}))
        a=self.registry.project(self.a);b=self.registry.project(self.b)
        self.assertEqual(a['connections'][0]['id'],'old-id');self.assertEqual(a['revision'],4)
        self.assertNotEqual(a['connections'][0]['sharedId'],b['connections'][0]['sharedId'])
        self.assertEqual(len(self.registry.view()['connections']),2)
        self.registry.project(self.a);self.assertEqual(len(self.registry.view()['connections']),2)
    def test_missing_deleted_and_explicit_rebind(self):
        c=self.save();a=self.attach(self.a,c['id'])
        foreign=ConnectionRegistry(self.root/'other-mac')
        self.assertTrue(foreign.project(self.a)['connections'][0]['missing']);self.assertEqual(foreign.view()['connections'],[])
        self.registry.delete({'revision':self.registry.view()['revision'],'id':c['id'],'confirmed':True})
        self.assertTrue(self.registry.project(self.a)['connections'][0]['missing'])
        new=self.save(dict(self.config,name='Replacement'))
        with self.assertRaisesRegex(ValueError,'Confirm'):self.attach(self.a,new['id'],replace=c['id'])
        result=self.attach(self.a,new['id'],replace=c['id'],confirmed=True)
        self.assertEqual(result['connections'][0]['id'],c['id']);self.assertEqual(result['connections'][0]['sharedId'],new['id'])
    def test_stale_writes_and_secret_rejection(self):
        self.save()
        with self.assertRaisesRegex(ValueError,'changed'):self.registry.save({'revision':0,'connection':self.config})
        with self.assertRaisesRegex(ValueError,'credentials'):self.save(dict(self.config,password='never-save'))
        self.assertNotIn('never-save',self.registry.path.read_text())
    def test_other_process_observes_updates(self):
        c=self.save();self.attach(self.a,c['id']);other=ConnectionRegistry(self.root/'central')
        self.save(dict(c,name='Renamed'),confirmed=True)
        self.assertEqual(other.project(self.a)['connections'][0]['name'],'Renamed')
