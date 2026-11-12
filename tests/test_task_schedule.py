import json
import time
import unittest
from datetime import datetime, timezone
from task_schedule import next_due, validate_schedule
import test_tasks as helpers
from task_runner import TaskRunner

class ScheduleChecks(unittest.TestCase):
    setUp=helpers.TaskChecks.setUp
    tearDown=helpers.TaskChecks.tearDown
    save=helpers.TaskChecks.save
    wait=helpers.TaskChecks.wait
    def enable(self,task,now=1000,config=None):
        return self.runner.schedules.configure({'id':task,'revision':self.runner.schedules.state['revision'],'action':'enable','schedule':config or {'kind':'interval','minutes':1}},now)
    def successful(self,code="print('ok')",credentials=None):
        task=self.save(code,credentials);self.runner.start(task);self.wait();return task
    def test_success_proof_survives_history_retention(self):
        task=self.successful();self.runner.runs=[];self.enable(task)
        self.assertTrue(self.runner.schedules.state['items'][task]['enabled'])
    def test_background_loop_runs_due_task(self):
        task=self.successful();self.runner.close()
        self.runner=TaskRunner(self.root,helpers.Runtime(),helpers.Files(self.root),self.keys)
        self.enable(task,now=time.time()-59)
        deadline=time.time()+6
        while time.time()<deadline and not any(r.get('trigger')=='schedule' and r['status']=='succeeded' for r in self.runner.view()['runs']):time.sleep(.05)
        self.assertTrue(any(r.get('trigger')=='schedule' and r['status']=='succeeded' for r in self.runner.view()['runs']))
    def test_requires_successful_manual_run(self):
        task=self.save('print(1)')
        with self.assertRaisesRegex(ValueError,'successfully once'):self.enable(task)
    def test_due_run_and_no_overlap(self):
        task=self.successful();self.enable(task)
        self.runner.schedules.tick(1000);self.runner.schedules.tick(1050);self.runner.schedules.tick(1060)
        run=self.wait();self.assertEqual(run['trigger'],'schedule')
        count=len(self.runner.runs);self.runner.schedules.tick(1061);self.assertEqual(len(self.runner.runs),count)
        self.runner.active[task]={'test':True}
        self.runner.schedules.tick(1100);self.runner.schedules.tick(1120)
        self.runner.active.pop(task)
        self.assertIn('already running',self.runner.schedules.state['items'][task]['notice'])
        self.assertEqual(len(self.runner.runs),count)
    def test_restart_and_sleep_record_missed_without_running(self):
        task=self.successful();self.enable(task)
        self.runner.schedules.tick(2000)
        item=self.runner.schedules.state['items'][task]
        self.assertEqual(len(self.runner.runs),1);self.assertEqual(item['nextRun'],2060);self.assertEqual(item['missed'],1)
        self.runner.schedules.tick(3000);self.assertEqual(item['missed'],2)
        restored=TaskRunner(self.root,helpers.Runtime(),helpers.Files(self.root),self.keys,scheduling=False)
        restored.schedules.tick(4000);self.assertEqual(restored.schedules.state['items'][task]['missed'],3);restored.close()
    def test_changed_script_pauses(self):
        task=self.successful();self.enable(task)
        (self.root/'script.py').write_text("print('changed')")
        self.runner.schedules.tick(1001);item=self.runner.schedules.state['items'][task]
        self.assertFalse(item['enabled']);self.assertIn('changed',item['notice'])
        with self.assertRaisesRegex(ValueError,'successfully once'):self.enable(task)
    def test_pause_resume_and_conflicts(self):
        task=self.successful();self.enable(task)
        schedule=self.runner.schedules
        with self.assertRaisesRegex(ValueError,'Schedule changed'):schedule.configure({'id':task,'revision':0,'action':'pause'})
        schedule.configure({'id':task,'revision':schedule.state['revision'],'action':'pause'},1001)
        schedule.tick(3000);self.assertEqual(len(self.runner.runs),1)
        schedule.configure({'id':task,'revision':schedule.state['revision'],'action':'resume'},3000)
        self.assertEqual(schedule.state['items'][task]['nextRun'],3060)
    def test_scheduled_credentials_never_prompt(self):
        task=self.successful("import os;print(os.environ['API_KEY'])",[{'id':'key1','env':'API_KEY'}]);self.enable(task)
        self.runner.schedules.tick(1000);self.runner.schedules.tick(1050);self.runner.schedules.tick(1060);run=self.wait()
        self.assertEqual(run['status'],'succeeded');self.assertFalse(self.keys.requests[-1]['allowPrompt']);self.assertNotIn('dummy-secret-only',run['log'])
    def test_scheduled_failure_pauses(self):
        task=self.successful("from pathlib import Path\np=Path('once');assert not p.exists();p.touch()")
        self.enable(task);self.runner.schedules.tick(1000);self.runner.schedules.tick(1050);self.runner.schedules.tick(1060)
        self.assertEqual(self.wait()['status'],'failed');self.assertFalse(self.runner.schedules.state['items'][task]['enabled'])
        with self.assertRaisesRegex(ValueError,'successfully once'):self.enable(task)

class CalendarChecks(unittest.TestCase):
    def test_weekly_zone_and_dst(self):
        c=validate_schedule({'kind':'weekly','weekday':0,'time':'08:00','timezone':'America/New_York'})
        now=datetime(2026,11,1,12,tzinfo=timezone.utc).timestamp()
        self.assertEqual(datetime.fromtimestamp(next_due(c,now),timezone.utc).isoformat(),'2026-11-02T13:00:00+00:00')
        c=validate_schedule({'kind':'daily','time':'02:30','timezone':'America/New_York'})
        now=datetime(2026,3,8,5,tzinfo=timezone.utc).timestamp()
        self.assertEqual(datetime.fromtimestamp(next_due(c,now),timezone.utc).isoformat(),'2026-03-09T06:30:00+00:00')
    def test_validation(self):
        for c in [{'kind':'interval','minutes':0},{'kind':'daily','time':'25:00','timezone':'UTC'},{'kind':'daily','time':'08:00','timezone':'bad/zone'}]:
            with self.assertRaises(ValueError):validate_schedule(c)
