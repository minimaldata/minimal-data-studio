import sys,tempfile,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from workspace_db import Workspace

class NotebookTableTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        self.ws=Workspace(self.root,self.root,seed_samples=False);self.s=self.ws.session(self.ws.new_session()['session'])
        self.s['conn'].execute('CREATE TEMP TABLE output AS SELECT i, CASE WHEN i=0 THEN NULL ELSE i END AS nullable FROM range(21001) t(i)')
    def tearDown(self):self.ws.close();self.tmp.cleanup()
    def create(self,**kw):
        return self.ws.create_notebook_table(self.s,dict(name='snapshot',source='output',folder='',notebook='Lesson',language='python',**kw))
    def test_all_rows_folder_origin_and_restart(self):
        self.ws.database_folders(self.s,{'action':'create','path':'Lessons/Results'})
        result=self.ws.create_notebook_table(self.s,dict(name='snapshot',source='output',folder='Lessons/Results',notebook='Lesson',language='r'))
        self.assertEqual(result['rows'],21001)
        self.assertEqual(self.s['conn'].execute('SELECT nullable FROM snapshot WHERE i=0').fetchone(),(None,))
        self.assertIsNone(self.ws.definition_info(self.s,'snapshot')['current']['query'])
        self.assertIn('Lesson',self.ws.definition_info(self.s,'snapshot')['current']['origin'])
        self.s['conn'].execute('DELETE FROM temp.main.output')
        self.ws.close();self.ws=Workspace(self.root,self.root,seed_samples=False);self.s=self.ws.session(self.ws.new_session()['session'])
        self.assertEqual(self.s['conn'].execute('SELECT count(*) FROM snapshot').fetchone()[0],21001)
        self.assertEqual(self.ws.database_folders(self.s,{})['locations']['snapshot'],'Lessons/Results')
    def test_duplicate_missing_folder_and_missing_source_leave_data_intact(self):
        self.create()
        with self.assertRaisesRegex(ValueError,'already exists'):self.create()
        for change in ({'source':'missing'},{'folder':'missing'},{'name':'not valid'}):
            request=dict(name='new_table',source='output',folder='');request.update(change)
            with self.assertRaises(ValueError):self.ws.create_notebook_table(self.s,request)
        self.assertEqual(self.s['conn'].execute('SELECT count(*) FROM snapshot').fetchone()[0],21001)
        self.assertNotIn('new_table',self.ws.catalog_objects(self.s['conn']))
    def test_other_sessions_cannot_capture_private_output(self):
        other=self.ws.session(self.ws.new_session()['session'])
        with self.assertRaises(ValueError):self.ws.create_notebook_table(other,{'name':'nope','source':'output'})

if __name__=='__main__':unittest.main()
