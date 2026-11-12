"""Project Python tasks: bounded logs, process-group cancellation, explicit credential bindings."""
import codecs
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import threading
import time
import uuid
from task_schedule import TaskSchedules

class NativeCredentials:
    """Private inherited pipes to the launcher. Values never travel over HTTP."""
    def __init__(self):
        self.lock = threading.Lock()
        self.available = os.environ.get('MDS_TASK_BRIDGE') == '1'
    def request(self, body):
        if not self.available:
            raise ValueError('Open this project from the updated Mac preview to use Keychain credentials.')
        import select
        with self.lock:
            request_id = uuid.uuid4().hex
            print('MDS_TASK_CREDENTIALS:' + json.dumps(dict(body, requestID=request_id)), flush=True)
            if not select.select([sys.stdin], [], [], 120)[0]:
                raise ValueError('Credential approval timed out. Try Run again in the Mac app.')
            # Drain replies from timed-out requests before accepting the current one.
            deadline = time.monotonic() + 5
            while True:
                response = json.loads(sys.stdin.readline())
                if response.get('requestID') == request_id: break
                if time.monotonic() > deadline or not select.select([sys.stdin], [], [], 1)[0]:
                    raise ValueError('Credential response expired. Try Run again.')
            if response.get('error'): raise ValueError(response['error'])
            return response

class Redactor:
    def __init__(self, values):
        self.values = sorted(set(v for v in values if v), key=len, reverse=True)
        self.buffer = ''
        self.keep = max(map(len, self.values), default=1) - 1
    def feed(self, text, final=False):
        self.buffer += text
        cut = len(self.buffer) if final else max(0, len(self.buffer)-self.keep)
        for value in self.values:
            start = self.buffer.find(value)
            while start != -1:
                if start < cut < start+len(value): cut = start
                start = self.buffer.find(value, start+1)
        out, self.buffer = self.buffer[:cut], self.buffer[cut:]
        for value in self.values: out = out.replace(value, '[REDACTED]')
        return out

class TaskRunner:
    def __init__(self, project, runtimes, files, credentials=None, scheduling=True):
        self.project, self.runtimes, self.files = Path(project), runtimes, files
        self.credentials = credentials or NativeCredentials()
        self.path = self.project/'.studio/tasks.json'
        self.history = self.project/'.studio/task-runs.json'
        self.lock = threading.RLock(); self.active = {}; self.closed = False
        self.state = self._read(self.path, {'revision':0, 'tasks':[]})
        self.runs = self._read(self.history, [])
        for run in self.runs:
            if run['status'] in ('starting','running','stopping'):
                run.update(status='interrupted', ended=time.time())
        self._write(self.history, self.runs)
        self.schedules=TaskSchedules(self);self.schedule_stop=threading.Event()
        if scheduling:
            def schedule_loop():
                while not self.schedule_stop.is_set():
                    self.schedules.tick()
                    self.schedule_stop.wait(2)
            self.schedule_thread=threading.Thread(target=schedule_loop,daemon=True);self.schedule_thread.start()
    def _read(self, path, fallback):
        if not path.exists(): return fallback
        try: return json.loads(path.read_text())
        except (ValueError, OSError): raise ValueError('Could not read '+path.name+'. Restore a valid file before running tasks.')
    def _write(self, path, value):
        temporary = path.with_suffix('.tmp')
        temporary.write_text(json.dumps(value, indent=2)); os.replace(temporary,path)
    def script(self, relative):
        path = self.files.resolve(relative)
        if path.suffix.lower() != '.py' or not path.is_file(): raise ValueError('Choose an existing Python (.py) file inside this project.')
        if path.stat().st_size > 2_000_000: raise ValueError('Task scripts must be smaller than 2 MB.')
        return path
    def read_script(self, relative):
        with self.lock:
            data=self.script(relative).read_bytes()
            return {"code":data.decode("utf-8-sig"), "hash":hashlib.sha256(data).hexdigest()}
    def view(self):
        with self.lock:
            return json.loads(json.dumps(dict(self.state, runs=self.runs, credentialSupport=self.credentials.available,schedules=self.schedules.state)))
    def validate_bindings(self,bindings):
        if not isinstance(bindings,list) or len(bindings)>20: raise ValueError('Choose at most 20 credentials.')
        names=set(); ids=set(); clean=[]
        for binding in bindings:
            env, key = binding.get('env',''), binding.get('id','')
            if not re.fullmatch(r'[A-Z][A-Z0-9_]{0,99}',env) or env.startswith(('PYTHON','MDS_','DYLD_','LD_')) or env in ('PATH','HOME','SHELL','USER','TMPDIR'):
                raise ValueError('Use a unique uppercase environment name such as ORDERS_API_TOKEN; runtime settings cannot be replaced.')
            if env in names or key in ids or not isinstance(key,str) or not key: raise ValueError('Each credential and environment name can appear only once.')
            names.add(env);ids.add(key);clean.append({'id':key,'env':env})
        return clean
    def required_credentials(self, values):
        if not isinstance(values,list) or len(values)>20 or any(not isinstance(v,str) or not re.fullmatch(r'[A-Z][A-Z0-9_]{0,99}',v) for v in values):
            raise ValueError('Required credentials must be uppercase environment names, such as CFBD_API_KEY (at most 20).')
        return list(dict.fromkeys(values))
    def save(self, request):
        with self.lock:
            if request.get('revision') != self.state['revision']: raise ValueError('Tasks changed in another window. Refresh the task list before saving.')
            incoming = request.get('task', {})
            task_id = incoming.get('id') or uuid.uuid4().hex
            existing = next((t for t in self.state['tasks'] if t['id']==task_id),None)
            if incoming.get('id') and not existing: raise ValueError('Task no longer exists.')
            if task_id in self.active: raise ValueError('Stop this task before editing its setup.')
            name, script = incoming.get('name','').strip(), incoming.get('script','')
            if not name or len(name)>100: raise ValueError('Enter a task name, up to 100 characters.')
            path=self.files.resolve(script)
            if path.suffix.lower()!='.py': raise ValueError('Script filename must end in .py.')
            if 'code' not in request: self.script(script)
            else:
                code=request['code']
                if not isinstance(code,str) or len(code.encode())>2_000_000: raise ValueError('Script must be UTF-8 text smaller than 2 MB.')
                current=hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None
                if current!=request.get('scriptHash'): raise ValueError('This Python file changed outside this editor. Your code has been kept; reopen the task to load the latest file before saving.')
                if any(t['id'] in self.active and t['script']==script for t in self.state['tasks']): raise ValueError('Stop tasks using this script before saving.')
            clean = self.validate_bindings(incoming.get('credentials',[]))
            task={'id':task_id,'name':name,'script':script,'credentials':clean,'requiredCredentials':self.required_credentials(incoming.get('requiredCredentials',[]))}
            tasks=[task if t['id']==task_id else t for t in self.state['tasks']]
            if not existing: tasks.append(task)
            if len(tasks)>200: raise ValueError('This project already has 200 tasks.')
            if 'code' in request:
                path.parent.mkdir(parents=True,exist_ok=True)
                # Exclusive creation protects existing files when creating a new script.
                if not path.exists():
                    with path.open('x',encoding='utf-8') as output: output.write(code)
                else:
                    temporary=path.with_name(path.name+'.'+uuid.uuid4().hex+'.tmp')
                    try:
                        temporary.write_text(code,encoding='utf-8')
                        if hashlib.sha256(path.read_bytes()).hexdigest()!=current: raise ValueError('Python file changed while saving. Your code has been kept.')
                        os.replace(temporary,path)
                    finally: temporary.unlink(missing_ok=True)
            state={'revision':self.state['revision']+1,'tasks':tasks};self._write(self.path,state);self.state=state
            return self.view()
    def start(self, task_id, trigger="manual", expected_fingerprint=None):
        with self.lock:
            if self.closed: raise ValueError('This project is stopping.')
            if task_id in self.active: raise ValueError('This task is already running.')
            task=next((t for t in self.state['tasks'] if t['id']==task_id),None)
            if not task: raise ValueError('Task not found.')
            task=json.loads(json.dumps(task))
            required=self.required_credentials(task.get('requiredCredentials',[]))
            missing=set(required)-{b['env'] for b in task.get('credentials',[])}
            if missing: raise ValueError('Required credential missing: '+', '.join(sorted(missing))+'. Select a connected key in Task settings or use Manage credentials.')
            if task.get('credentials'):
                available={c['id'] for c in self.credentials.request({'operation':'list'}).get('credentials',[])}
                if any(b['id'] not in available for b in task['credentials']): raise ValueError('A selected credential is no longer connected. Use Manage credentials, then Check credentials again.')
            task['credentials']=self.validate_bindings(task.get('credentials',[])); path=self.script(task['script']); code=path.read_bytes()
            runtime=self.runtimes.selection('python')
            fingerprint=self.schedules.fingerprint(task,code,runtime)
            if expected_fingerprint and fingerprint!=expected_fingerprint: raise ValueError('Task changed before scheduled execution.')
            run={'trigger':trigger,'fingerprint':fingerprint,'id':uuid.uuid4().hex,'taskId':task_id,'name':task['name'],'script':task['script'],'scriptHash':hashlib.sha256(code).hexdigest(),'runtime':runtime,'started':time.time(),'status':'starting','log':''}
            control={'cancel':threading.Event(),'process':None,'run':run}
            self.active[task_id]=control;self.runs.insert(0,run)
            # Retain recent completed runs without discarding a currently active run.
            self.runs=[r for i,r in enumerate(self.runs) if i<30 or r['status'] in ('starting','running','stopping')]
            self._write(self.history,self.runs)
            thread=threading.Thread(target=self._execute,args=(task,run,control,path,code),daemon=True)
            control['thread']=thread;thread.start()
            return self.view()
    def _execute(self, task, run, control, path, code):
        secrets={}; process=None
        try:
            if task['credentials']:
                secrets=self.credentials.request({'operation':'resolve','task':task,'hash':run['scriptHash'],'runtime':run['runtime'],'allowPrompt':run.get('trigger')!='schedule'}).get('values',{})
                if set(secrets) != {b['env'] for b in task['credentials']}: raise ValueError('Not all selected credentials were approved.')
            if control['cancel'].is_set(): return
            # Do not inherit arbitrary shell/API secrets from the server environment.
            source=self.runtimes.environment('python')
            env={k:v for k,v in source.items() if k in ('PATH','HOME','USER','LOGNAME','LANG','LC_ALL','TMPDIR','SYSTEMROOT','MPLCONFIGDIR')}
            env.update(secrets);env['PYTHONUNBUFFERED']='1';env['PYTHONDONTWRITEBYTECODE']='1'
            bootstrap="import sys,json; p=json.load(sys.stdin); sys.argv=[p['path']]; sys.path.insert(0,p['directory']); exec(compile(p['code'],p['path'],'exec'),{'__name__':'__main__','__file__':p['path']})"
            with self.lock:
                if control['cancel'].is_set(): return
                process=subprocess.Popen([run['runtime'],'-u','-c',bootstrap],cwd=self.project,env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True)
                control['process']=process;run['status']='running'
            payload=json.dumps({'path':str(path),'directory':str(path.parent),'code':code.decode('utf-8-sig')}).encode()
            process.stdin.write(payload);process.stdin.close()
            redactor=Redactor(secrets.values());decoder=codecs.getincrementaldecoder('utf-8')('replace')
            while True:
                chunk=os.read(process.stdout.fileno(),4096)
                if not chunk: break
                self._append(run,redactor.feed(decoder.decode(chunk)))
            self._append(run,redactor.feed(decoder.decode(b'',final=True),final=True))
            run['exitCode']=process.wait()
            run['status']='succeeded' if process.returncode==0 else 'failed'
        except Exception as error:
            run['status']='failed'
            # Exceptions may include output or paths but must never disclose a known key.
            text=str(error)
            for value in secrets.values(): text=text.replace(value,'[REDACTED]')
            self._append(run,text+'\n')
        finally:
            if process:
                self._signal(process,signal.SIGKILL) # clean any lingering child processes too
                process.wait()
                process.stdout.close()
            with self.lock:
                if control['cancel'].is_set(): run['status']='stopped'
                run['ended']=time.time();self.active.pop(task['id'],None);self._write(self.history,self.runs)
                if run.get('trigger')=='manual' and run['status']=='succeeded':self.schedules.manual_success(run)
                if run.get('trigger')=='schedule' and run['status']=='failed':self.schedules.pause_failure(task['id'])
    def _append(self,run,text):
        with self.lock:
            run['log']=(run['log']+text)[-100000:]
            if len(run['log'])==100000: run['truncated']=True
    def _signal(self,process,sig):
        try: os.killpg(process.pid,sig)
        except ProcessLookupError: pass
    def stop(self,task_id):
        with self.lock:
            control=self.active.get(task_id)
            if control:
                control['cancel'].set();control['run']['status']='stopping'
                process=control['process']
                if process:
                    self._signal(process,signal.SIGTERM)
                    def kill():
                        if control['thread'].is_alive(): self._signal(process,signal.SIGKILL)
                    timer=threading.Timer(2,kill);timer.daemon=True;timer.start()
            return self.view()
    def close(self):
        self.schedule_stop.set()
        with self.lock: self.closed=True; ids=list(self.active)
        for task_id in ids: self.stop(task_id)
        with self.lock: controls=list(self.active.values())
        for control in controls: control['thread'].join(timeout=4)
