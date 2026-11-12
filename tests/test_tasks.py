import json
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest
from task_runner import TaskRunner, Redactor

class Files:
    def __init__(self,root): self.root=Path(root).resolve()
    def resolve(self,relative):
        path=(self.root/relative).resolve()
        if self.root not in path.parents or any(p.startswith('.') for p in Path(relative).parts): raise ValueError('Outside project')
        return path
class Runtime:
    def selection(self,lang): return sys.executable
    def environment(self,lang): return dict(os.environ,UNSELECTED_SECRET='do-not-inherit')
class Keys:
    available=True
    def __init__(self): self.requests=[]
    def request(self,body):
        self.requests.append(body)
        if body['operation']=='list': return {'credentials':[{'id':'key1','name':'API_KEY'}]}
        return {'values':{'API_KEY':'dummy-secret-only'}}

class TaskChecks(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.root=Path(self.tmp.name);(self.root/'.studio').mkdir()
        self.keys=Keys();self.runner=TaskRunner(self.root,Runtime(),Files(self.root),self.keys,scheduling=False)
    def tearDown(self): self.runner.close();self.tmp.cleanup()
    def save(self,code,credentials=None):
        (self.root/'script.py').write_text(code)
        state=self.runner.save({'revision':self.runner.state['revision'],'task':{'name':'Example','script':'script.py','credentials':credentials or []}})
        return state['tasks'][-1]['id']
    def wait(self):
        deadline=time.monotonic()+8
        while self.runner.active and time.monotonic()<deadline: time.sleep(.02)
        self.assertFalse(self.runner.active)
        return self.runner.view()['runs'][0]
    def test_run_working_directory_and_clean_environment(self):
        task=self.save("import os\nfrom pathlib import Path\nassert 'UNSELECTED_SECRET' not in os.environ\nPath('output.txt').write_text('ok')\nprint('finished')")
        self.runner.start(task);run=self.wait()
        self.assertEqual(run['status'],'succeeded');self.assertEqual((self.root/'output.txt').read_text(),'ok');self.assertIn('finished',run['log']);self.assertEqual(self.keys.requests,[])
        self.assertEqual(len(run['scriptHash']),64)
    def test_credential_redaction_in_success_failure_and_persistence(self):
        task=self.save("import os,sys\nv=os.environ['API_KEY']\nsys.stdout.write(v[:5]);sys.stdout.flush();sys.stdout.write(v[5:]);sys.stdout.flush()\nraise RuntimeError(v)",[{'id':'key1','env':'API_KEY'}])
        self.runner.start(task);run=self.wait()
        self.assertEqual(run['status'],'failed');self.assertNotIn('dummy-secret-only',run['log']);self.assertIn('[REDACTED]',run['log'])
        self.assertNotIn('dummy-secret-only',(self.root/'.studio/task-runs.json').read_text())
        restored=TaskRunner(self.root,Runtime(),Files(self.root),self.keys,scheduling=False)
        self.assertEqual(restored.view()['runs'][0]['status'],'failed');restored.close()
    def test_redactor_every_chunk_boundary(self):
        text='before TOKEN-123 after TOKEN-123 end'
        for size in range(1,20):
            redactor=Redactor(['TOKEN-123']);out=''
            for start in range(0,len(text),size):out+=redactor.feed(text[start:start+size])
            out+=redactor.feed('',final=True)
            self.assertEqual(out,'before [REDACTED] after [REDACTED] end')
    def test_stop_and_overlap(self):
        task=self.save("import time,subprocess,sys\nsubprocess.Popen([sys.executable,'-c','import time;time.sleep(60)'])\nprint('started',flush=True)\ntime.sleep(60)")
        self.runner.start(task)
        with self.assertRaises(ValueError):self.runner.start(task)
        deadline=time.monotonic()+5
        while 'started' not in self.runner.view()['runs'][0]['log'] and time.monotonic()<deadline:time.sleep(.02)
        self.runner.stop(task);self.assertEqual(self.wait()['status'],'stopped')
    def test_validation_and_conflict(self):
        self.save('print(1)')
        with self.assertRaises(ValueError):self.runner.save({'revision':0,'task':{}})
        for script in ('../outside.py','.studio/script.py','missing.py'):
            with self.assertRaises(ValueError):self.runner.save({'revision':1,'task':{'name':'Bad','script':script}})
        with self.assertRaises(ValueError):self.save('print(1)',[{'id':'key','env':'PATH'}])
    def test_missing_approval_runs_no_code(self):
        self.keys.request=lambda body: {'credentials':[{'id':'key','name':'API_KEY'}]} if body['operation']=='list' else {'values':{}}
        task=self.save("from pathlib import Path\nPath('bad').touch()",[{'id':'key','env':'API_KEY'}])
        self.runner.start(task);self.assertEqual(self.wait()['status'],'failed');self.assertFalse((self.root/'bad').exists())
    def test_log_bound(self):
        task=self.save("print('x'*200000)")
        self.runner.start(task);run=self.wait();self.assertLessEqual(len(run['log']),100000);self.assertTrue(run['truncated'])

    def test_file_editor_create_save_and_conflicts(self):
        payload={'revision':0,'task':{'name':'New','script':'scripts/new.py','credentials':[]},'code':'print(1)\n','scriptHash':None}
        state=self.runner.save(payload);path=self.root/'scripts/new.py'
        self.assertEqual(path.read_text(),'print(1)\n')
        loaded=self.runner.read_script('scripts/new.py')
        payload.update(revision=state['revision'],task=state['tasks'][0],code='print(2)\n',scriptHash=loaded['hash'])
        self.runner.save(payload);self.assertEqual(path.read_text(),'print(2)\n')
        payload['revision']=self.runner.state['revision']
        with self.assertRaisesRegex(ValueError,'changed outside'):self.runner.save(payload)
        self.assertEqual(path.read_text(),'print(2)\n')
        payload['task']={'name':'Duplicate','script':'scripts/new.py'};payload['scriptHash']=None
        with self.assertRaisesRegex(ValueError,'changed outside'):self.runner.save(payload)

    def test_required_credentials_block_before_execution(self):
        task=self.save("print('must not run')")
        item=self.runner.state['tasks'][0]
        self.runner.save({'revision':self.runner.state['revision'],'task':dict(item,requiredCredentials=['CFBD_API_KEY'])})
        with self.assertRaisesRegex(ValueError,'Required credential missing'): self.runner.start(task)
        self.assertEqual(self.runner.view()['runs'],[])

    def test_disconnected_selected_credential_blocks_start(self):
        task=self.save("print('must not run')",[{'id':'gone','env':'API_KEY'}])
        with self.assertRaisesRegex(ValueError,'no longer connected'): self.runner.start(task)
        self.assertFalse(self.runner.active)
