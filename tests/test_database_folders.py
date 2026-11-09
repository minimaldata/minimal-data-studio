import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from workspace_db import Workspace

class DatabaseFolderTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        self.ws=Workspace(self.root,self.root,seed_samples=False)
        self.s=self.ws.session(self.ws.new_session()['session'])
        self.ws.query(self.s,'CREATE TABLE trees AS SELECT 1 AS id')
    def tearDown(self):
        self.ws.close();self.tmp.cleanup()
    def folders(self,action='list',**kw):
        return self.ws.database_folders(self.s,dict(action=action,**kw))
    def test_nested_move_rename_remove_and_restart(self):
        self.folders('create',path='Fieldwork/Trees')
        self.folders('move',name='TREES',folder='Fieldwork/Trees')
        self.assertIn('Database / Fieldwork / Trees',self.ws.duplicate_name_message(self.s,'trees'))
        self.folders('rename',path='Fieldwork',target='Lessons/Fieldwork')
        self.assertEqual(self.folders()['locations']['trees'],'Lessons/Fieldwork/Trees')
        self.ws.close();self.ws=Workspace(self.root,self.root,seed_samples=False);self.s=self.ws.session(self.ws.new_session()['session'])
        self.assertEqual(self.folders()['locations']['trees'],'Lessons/Fieldwork/Trees')
        self.folders('delete',path='Lessons/Fieldwork')
        self.assertEqual(self.folders()['locations']['trees'],'Lessons')
        self.assertEqual(self.s['conn'].execute('SELECT * FROM trees').fetchall(),[(1,)])
    def test_duplicates_import_and_sql_include_location(self):
        self.folders('create',path='Examples')
        self.folders('move',name='trees',folder='Examples')
        with self.assertRaisesRegex(ValueError,'Database / Examples'):
            self.ws.query(self.s,'CREATE VIEW trees AS SELECT 2')
        file=self.root/'trees.csv';file.write_text('id\n2\n')
        plan=self.ws.plan_import(self.s,file)
        self.assertTrue(plan['exists']);self.assertIn('Database / Examples',plan['duplicateMessage'])
        with self.assertRaisesRegex(ValueError,'Database / Examples'):
            self.ws.execute_import_plan(self.s,plan['plan'])
        self.assertEqual(self.s['conn'].execute('SELECT * FROM trees').fetchall(),[(1,)])
    def test_collisions_invalid_paths_and_drop_cleanup(self):
        self.folders('create',path='A/Child');self.folders('create',path='B')
        with self.assertRaises(ValueError):self.folders('rename',path='A',target='B')
        with self.assertRaises(ValueError):self.folders('rename',path='A',target='A/Child/New')
        with self.assertRaises(ValueError):self.folders('create',path='../escape')
        self.folders('move',name='trees',folder='A/Child')
        self.ws.query(self.s,'DROP TABLE trees');self.ws.query(self.s,'CREATE TABLE trees AS SELECT 3')
        self.assertNotIn('trees',self.folders()['locations'])

if __name__=='__main__':unittest.main()
