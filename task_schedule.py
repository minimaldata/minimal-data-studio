"""In-process schedules. No catch-up bursts, OS jobs or credential approval prompts."""
from datetime import datetime, timedelta
import hashlib
import json
import time
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


def validate_schedule(value):
    kind=value.get('kind')
    if kind=='interval':
        minutes=value.get('minutes')
        if type(minutes) is not int or not 1<=minutes<=10080: raise ValueError('Choose an interval from 1 to 10,080 minutes.')
        return {'kind':kind,'minutes':minutes}
    if kind not in ('daily','weekly'): raise ValueError('Choose interval, daily or weekly.')
    zone=value.get('timezone','')
    try: ZoneInfo(zone)
    except (ZoneInfoNotFoundError,ValueError,TypeError): raise ValueError('Enter a valid time zone, such as America/New_York.')
    clock=value.get('time','')
    try:
        hour,minute=map(int,clock.split(':'))
        if len(clock)!=5 or not 0<=hour<24 or not 0<=minute<60: raise ValueError()
    except (ValueError,AttributeError): raise ValueError('Choose a time in HH:MM format.')
    day=value.get('weekday',0)
    if type(day) is not int or not 0<=day<=6: raise ValueError('Choose a weekday.')
    return {'kind':kind,'timezone':zone,'time':clock,'weekday':day}


def next_due(config, after):
    if config['kind']=='interval': return after+config['minutes']*60
    zone=ZoneInfo(config['timezone']);local=datetime.fromtimestamp(after,zone)
    hour,minute=map(int,config['time'].split(':'))
    for offset in range(9):
        day=local.date()+timedelta(days=offset)
        if config['kind']=='weekly' and day.weekday()!=config['weekday']: continue
        candidate=datetime(day.year,day.month,day.day,hour,minute,tzinfo=zone)
        stamp=candidate.timestamp()
        # Skip nonexistent spring-forward times; run only once at fall-back times.
        restored=datetime.fromtimestamp(stamp,zone)
        if (restored.hour,restored.minute)!=(hour,minute): continue
        if stamp>after: return stamp
    raise ValueError('Could not determine the next scheduled time.')


class TaskSchedules:
    def __init__(self,runner):
        self.runner=runner;self.path=runner.project/'.studio/task-schedules.json'
        self.state=runner._read(self.path,{'revision':0,'items':{}})
        self.last_tick=None
    def persist(self):
        self.state['revision']+=1;self.runner._write(self.path,self.state)
    def fingerprint(self,task,code=None,runtime=None):
        data={'script':task['script'],'hash':hashlib.sha256(code if code is not None else self.runner.script(task['script']).read_bytes()).hexdigest(),
              'runtime':runtime or self.runner.runtimes.selection('python'),'credentials':task.get('credentials',[]),'required':task.get('requiredCredentials',[])}
        return hashlib.sha256(json.dumps(data,sort_keys=True).encode()).hexdigest()
    def configure(self,request,now=None):
        now=time.time() if now is None else now
        with self.runner.lock:
            if request.get('revision')!=self.state['revision']: raise ValueError('Schedule changed. Review its latest status and try again.')
            task=next((t for t in self.runner.state['tasks'] if t['id']==request.get('id')),None)
            if not task: raise ValueError('Save the task before scheduling it.')
            old=self.state['items'].get(task['id'],{})
            action=request.get('action')
            if action=='pause':
                if not old: raise ValueError('No schedule to pause.')
                old.update(enabled=False,nextRun=None,notice='Schedule paused. Running tasks are not stopped.')
            elif action in ('enable','resume'):
                config=validate_schedule(request.get('schedule',{}) if action=='enable' else old.get('config',{}))
                fingerprint=self.fingerprint(task)
                proof=self.state.get('manualSuccess',{}).get(task['id'],{})
                approved=proof.get('fingerprint')==fingerprint and proof.get('ended',0)>=old.get('requireManualAfter',0)
                if not approved and not any(r.get('fingerprint')==fingerprint and r['taskId']==task['id'] and r['status']=='succeeded' and r.get('trigger','manual')=='manual' and r.get('ended',0)>=old.get('requireManualAfter',0) for r in self.runner.runs):
                    raise ValueError('Run this saved script successfully once before enabling or resuming its schedule.')
                if task['id'] in self.runner.active: raise ValueError('Wait for this task to finish before enabling its schedule.')
                self.state['items'][task['id']]={'config':config,'enabled':True,'fingerprint':fingerprint,'nextRun':next_due(config,now),'notice':'','missed':old.get('missed',0)}
            else: raise ValueError('Unknown schedule action.')
            self.persist();return self.runner.view()
    def manual_success(self,run):
        with self.runner.lock:
            self.state.setdefault('manualSuccess',{})[run['taskId']]={'fingerprint':run['fingerprint'],'ended':run['ended']}
            self.persist()
    def pause_failure(self,task_id):
        with self.runner.lock:
            item=self.state['items'].get(task_id)
            if item and item['enabled']:
                item.update(enabled=False,nextRun=None,requireManualAfter=time.time(),notice='Scheduled run failed. Review its logs, run successfully manually, then resume.');self.persist()
    def tick(self,now=None):
        now=time.time() if now is None else now
        with self.runner.lock:
            if self.runner.closed:return
            gap=self.last_tick is None or now-self.last_tick>30
            self.last_tick=now
            for task in self.runner.state['tasks']:
                item=self.state['items'].get(task['id'])
                if not item or not item['enabled']:continue
                try:
                    if self.fingerprint(task)!=item['fingerprint']:
                        item.update(enabled=False,nextRun=None,requireManualAfter=now,notice='Saved script, runtime or credentials changed. Run successfully manually, then resume.');self.persist();continue
                    due=item['nextRun']
                    if due>now:continue
                    item['nextRun']=next_due(item['config'],now)
                    if gap or now-due>60:
                        item.update(notice='Missed a scheduled run while the project was closed or the Mac was asleep. Use Run now if needed.',missed=item.get('missed',0)+1,lastMissed=due)
                    elif task['id'] in self.runner.active:
                        item.update(notice='Skipped a scheduled run because this task was already running.',missed=item.get('missed',0)+1,lastMissed=due)
                    else:
                        item['notice']='';self.persist()
                        self.runner.start(task['id'],trigger='schedule',expected_fingerprint=item['fingerprint'])
                        continue
                    self.persist()
                except Exception:
                    item.update(enabled=False,nextRun=None,notice='Schedule paused: could not start this task. Check its script and credentials, run manually, then resume.');self.persist()
