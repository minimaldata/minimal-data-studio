import tempfile
import unittest
import uuid
from pathlib import Path
from workspace_db import Workspace
from draft_data import handle, parse

class DraftChecks(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.root=Path(self.tmp.name)
        self.ws=Workspace(self.root,self.root,seed_samples=False)
        self.session=self.ws.session(self.ws.new_session()['session'])
        self.d={'id':str(uuid.uuid4()),'revision':0,'name':'Test','raw':'id,date,place\n00123,2026-12-31,"Boston, MA"','types':{'date':{'kind':'date','format':'YYYY-MM-DD'}},'blanksMissing':True,'source':{'note':'Test'},'history':[]}
    def tearDown(self):
        self.ws.close();self.tmp.cleanup()
    def call(self,action,**args):
        return handle(self.ws,self.session,action,{'draft':self.d,**args})
    def test_csv_quotes_and_errors(self):
        self.assertEqual(parse(self.d['raw'])[1][0],['00123','2026-12-31','Boston, MA'])
        self.assertEqual(parse('x\n""')[1],[['']])
        self.assertEqual(parse('x,y\n"line 1\nline 2","a""b"')[1],[['line 1\nline 2','a"b']])
        for raw in ['x,y\n1','x,x\n1,2','x\n"unfinished']:
            with self.assertRaises(ValueError):parse(raw)
    def test_check_create_and_csv(self):
        check=self.call('check');self.assertEqual(check['issueCount'],0)
        self.call('create',name='edited')
        row=self.session['conn'].execute('SELECT * FROM edited').fetchone()
        self.assertEqual(row[0],'00123');self.assertEqual(str(row[1]),'2026-12-31')
        with self.assertRaisesRegex(ValueError,'already exists'):self.call('create',name='EDITED')
        self.call('csv',name='copy.csv')
        self.assertEqual((self.root/'exports/copy.csv').read_text(),self.d['raw'])
        with self.assertRaises(ValueError):self.call('csv',name='copy.csv')
        with self.assertRaises(ValueError):self.call('csv',name='../bad.csv')
    def test_invalid_values_not_coerced(self):
        self.d['raw']='a,b,c,d\n12.5,2026-02-30,maybe,"1,234"'
        self.d['types']={n:{'kind':t} for n,t in zip('abcd',['integer','date','boolean','number'])}
        result=self.call('check');self.assertEqual(result['issueCount'],4)
        self.assertIn('12.5',result['issues'][0]['value'])
        self.assertIn('DuckDB would interpret',result['issues'][0]['technical'])
        with self.assertRaisesRegex(ValueError,'Resolve 4'):self.call('create',name='invalid')
        self.assertFalse(self.session['conn'].execute("SELECT 1 FROM information_schema.tables WHERE table_name='invalid'").fetchall())
        self.call('csv',name='untyped.csv')  # Type issues do not block valid CSV.
    def test_persistence_and_conflict(self):
        self.d['revision']=self.call('save')['revision']
        self.assertEqual(self.call('list')['drafts'][0]['raw'],self.d['raw'])
        self.call('save')
        with self.assertRaisesRegex(ValueError,'another window'):self.call('save')
        self.ws.close();self.ws=Workspace(self.root,self.root,seed_samples=False)
        self.session=self.ws.session(self.ws.new_session()['session'])
        self.assertEqual(self.call('list')['drafts'][0]['name'],'Test')
    def test_empty_missing_option(self):
        self.d['raw']='n\n""';self.d['types']={'n':{'kind':'integer'}}
        self.assertEqual(self.call('check')['issueCount'],0)
        self.d['blanksMissing']=False
        self.assertEqual(self.call('check')['issueCount'],1)

    def test_date_ignores_legacy_format_and_requires_iso(self):
        self.d['raw']='date\n31/12/2026'
        self.d['types']={'date':{'kind':'date','format':'DD/MM/YYYY'}}
        self.assertEqual(self.call('check')['issueCount'],1)
        with self.assertRaises(ValueError):self.call('create',name='legacy_date')
        for value in ['2026-12-31T00:00:00','2026-12-31 00:00:00','2026-2-01']:
            self.d['raw']='date\n'+value
            self.assertEqual(self.call('check')['issueCount'],1,value)
        self.d['raw']='date\n2026-12-31'
        self.assertEqual(self.call('check')['issueCount'],0)

    def test_datetime_strict_validation_and_storage(self):
        self.d['types']={'when':{'kind':'datetime'}}
        for value in ['2026-12-31','2026-12-31t14:30:00','2026-02-30T12:00:00','2026-12-31 14:30','2026-02-30 12:00:00','2026-12-31 24:00:00','2026-12-31 14:30:00Z']:
            self.d['raw']='when\n'+value
            self.assertEqual(self.call('check')['issueCount'],1,value)
        self.d['raw']='when\n2026-12-31 14:30:00\n2026-12-31T14:30:00'
        self.assertEqual(self.call('check')['issueCount'],0)
        self.call('create',name='timestamp_draft')
        self.assertEqual(self.session['conn'].execute('SELECT count(*), count(DISTINCT "when") FROM timestamp_draft').fetchone(),(2,1))
        self.assertIn('T14:30:00',self.d['raw'])
        self.assertEqual(str(self.session['conn'].execute('SELECT * FROM timestamp_draft').fetchone()[0]),'2026-12-31 14:30:00')
        self.assertEqual(self.session['conn'].execute('DESCRIBE timestamp_draft').fetchone()[1],'TIMESTAMP')

    def test_delete_draft_preserves_outputs_and_blocks_stale_save(self):
        self.d['revision']=self.call('save')['revision']
        self.call('create',name='kept_table')
        self.call('csv',name='kept.csv')
        with self.assertRaisesRegex(ValueError,'another window'):
            self.call('delete',id=self.d['id'],revision=0)
        self.call('delete',id=self.d['id'],revision=self.d['revision'])
        self.assertEqual(self.call('list')['drafts'],[])
        self.assertEqual(self.session['conn'].execute('SELECT count(*) FROM kept_table').fetchone()[0],1)
        self.assertTrue((self.root/'exports/kept.csv').is_file())
        with self.assertRaises(ValueError):self.call('save')
        self.ws.close();self.ws=Workspace(self.root,self.root,seed_samples=False)
        self.session=self.ws.session(self.ws.new_session()['session'])
        self.assertEqual(self.call('list')['drafts'],[])
