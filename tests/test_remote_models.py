"""No live Google calls: validate publication and recovery against a fake warehouse."""
import copy
from types import SimpleNamespace
from unittest.mock import patch
import unittest
import test_remote_sources as remote_tests
from test_remote_sources import FakeClient, FakeJob
from remote_models import RemoteModels

class ModelClient(FakeClient):
    def __init__(self):
        super().__init__(); self.objects={};self.jobs={};self.fail=False
    def get_table(self,ref,**kw):
        from google.api_core.exceptions import NotFound
        if ref not in self.objects:raise NotFound('Missing')
        return copy.deepcopy(self.objects[ref])
    def query(self,sql,job_config=None,job_id=None,**kw):
        self.queries.append(sql)
        kind='CREATE_VIEW' if sql.startswith('CREATE') and 'VIEW `' in sql else 'CREATE_TABLE_AS_SELECT' if sql.startswith('CREATE') else 'SELECT'
        if sql.startswith('DELETE') or '; DELETE' in sql:kind='SCRIPT'
        job=FakeJob(self.table);job.statement_type=kind;job.error_result=None;job.state='DONE'
        if job_config.dry_run or not sql.startswith('CREATE'):return job
        if self.fail:raise TimeoutError()
        ref=sql.split('`')[1];identity=sql.split('"studio_model", "')[1].split('"')[0]
        self.objects[ref]=SimpleNamespace(labels={'studio_model':identity},etag=job_id,table_type='VIEW' if kind=='CREATE_VIEW' else 'TABLE')
        self.jobs[job_id]=job
        return job
    def get_job(self,key,**kw):
        from google.api_core.exceptions import NotFound
        if key not in self.jobs:raise NotFound('Missing')
        return self.jobs[key]

class ModelChecks(unittest.TestCase):
    setUp = remote_tests.RemoteChecks.setUp
    tearDown = remote_tests.RemoteChecks.tearDown
    wait = remote_tests.RemoteChecks.wait
    def new_model(self,kind='view'):
        self.client=ModelClient();self.remote.client_factory=lambda c:self.client
        return self.remote.models.save(dict(name='Costs',connection=self.id,dataset='sandbox',table='costs',kind=kind,sql='SELECT\n    42 AS cost;\n'))
    def plan(self,m):return self.remote.models.prepare({'id':m['id'],'revision':m['revision']})
    def publish(self,m):
        plan=self.plan(m)
        job=self.remote.start(dict(action='model_publish',connection=self.id,token=plan['token'],confirmed=True),self.session)
        self.assertEqual(self.wait(job['id'])['state'],'done')
        return next(item for item in self.remote.models.view()['models'] if item['id']==m['id'])
    def test_model_draft_publish_update_restore_and_reload(self):
        m=self.new_model();self.assertEqual(self.client.queries,[])
        m=self.publish(m);self.assertEqual(len(m['versions']),1)
        initial=m['published']['sql']
        m=self.remote.models.save({**m['draft'],'id':m['id'],'revision':m['revision'],'sql':'SELECT\n  43 AS cost;\n'})
        self.assertEqual(m['published']['sql'],initial)
        m=self.publish(m);self.assertEqual(len(m['versions']),2)
        m=self.remote.models.save({**m['draft'],'id':m['id'],'revision':m['revision'],'sql':initial})
        self.assertNotEqual(m['published']['sql'],m['draft']['sql'])
        reloaded=RemoteModels(self.root,self.remote).view()['models'][0]
        self.assertEqual(reloaded,m)
    def test_source_collision_and_external_changes_blocked(self):
        m=self.new_model();ref=m['draft']['destination'];self.client.objects[ref]=SimpleNamespace(labels={},etag='external',table_type='VIEW')
        with self.assertRaisesRegex(ValueError,'source table'):self.plan(m)
        del self.client.objects[ref];m=self.publish(m)
        plan=self.plan(m);self.client.objects[ref].etag='changed'
        with self.assertRaisesRegex(ValueError,'outside Studio'):
            self.remote.models.publish({'token':plan['token'],'confirmed':True},self.client,self.remote.connection(self.id))
        self.assertEqual(len(m['versions']),1)
    def test_stale_revision_duplicate_destination_and_materialization(self):
        m=self.new_model('table');m=self.publish(m)
        with self.assertRaisesRegex(ValueError,'changed'):self.remote.models.save({**m['draft'],'id':m['id'],'revision':1,'sql':'SELECT 99'})
        with self.assertRaisesRegex(ValueError,'reserved'):self.remote.models.save(m['draft'])
        with self.assertRaisesRegex(ValueError,'materialization'):self.remote.models.save({**m['draft'],'id':m['id'],'revision':m['revision'],'kind':'view'})
    def test_failed_and_ambiguous_jobs_recovery(self):
        m=self.new_model();plan=self.plan(m);self.client.fail=True
        with self.assertRaisesRegex(ValueError,'could not be confirmed'):
            self.remote.models.publish({'token':plan['token'],'confirmed':True},self.client,self.remote.connection(self.id))
        reloaded=RemoteModels(self.root,self.remote);m=reloaded.view()['models'][0];jobid=m['pending']['jobId']
        with self.assertRaisesRegex(ValueError,'pending'):reloaded.save({**m['draft'],'id':m['id'],'revision':m['revision']})
        job=SimpleNamespace(state='DONE',error_result={'message':'Permission denied'});self.client.jobs[jobid]=job
        with self.assertRaisesRegex(ValueError,'Permission denied'):reloaded.reconcile({'id':m['id']})
        self.assertNotIn('pending',reloaded.view()['models'][0]);self.assertEqual(reloaded.view()['models'][0]['versions'],[])
    def test_successful_job_recovery_after_restart(self):
        m=self.new_model();plan=self.plan(m)
        with patch.object(self.remote.models,'_finish',side_effect=RuntimeError('crash after query')):
            with self.assertRaises(RuntimeError):self.remote.models.publish({'token':plan['token'],'confirmed':True},self.client,self.remote.connection(self.id))
        restored=RemoteModels(self.root,self.remote).reconcile({'id':m['id']})
        self.assertEqual(len(restored['versions']),1);self.assertNotIn('pending',restored)
    def test_models_reject_scripts_and_changed_review(self):
        m=self.new_model();plan=self.plan(m)
        m=self.remote.models.save({**m['draft'],'id':m['id'],'revision':m['revision'],'sql':'SELECT 1; DELETE FROM x'})
        with self.assertRaisesRegex(ValueError,'single SELECT'):self.plan(m)
        with self.assertRaisesRegex(ValueError,'changed'):self.remote.models.publish({'token':plan['token'],'confirmed':True},self.client,self.remote.connection(self.id))

    def test_confirmation_expiry_and_submission_permission_failure(self):
        from google.api_core.exceptions import Forbidden
        m=self.new_model();plan=self.plan(m)
        self.remote.models.plans[plan['token']]['expires']=0
        with self.assertRaisesRegex(ValueError,'expired'):
            self.remote.models.publish({'token':plan['token'],'confirmed':True},self.client,self.remote.connection(self.id))
        plan=self.plan(m)
        with patch.object(self.client,'query',side_effect=Forbidden('No create permission')):
            with self.assertRaisesRegex(ValueError,'rejected'):
                self.remote.models.publish({'token':plan['token'],'confirmed':True},self.client,self.remote.connection(self.id))
        self.assertNotIn('pending',self.remote.models.view()['models'][0])
        self.assertEqual(self.remote.models.view()['models'][0]['versions'],[])

    def test_idempotent_save_after_lost_response(self):
        m=self.new_model()
        changed=self.remote.models.save({**m['draft'],'id':m['id'],'revision':m['revision'],'sql':'SELECT 2'})
        retry=self.remote.models.save({**changed['draft'],'id':m['id'],'revision':m['revision']})
        self.assertEqual(retry,changed)

    def test_references_compile_preview_publish_and_reject_changed_upstream(self):
        upstream=self.publish(self.new_model())
        sql='SELECT *\nFROM {{ costs }};\n'
        downstream=self.remote.models.save(dict(name='Derived costs',connection=self.id,dataset='sandbox',table='derived',kind='view',sql=sql))
        compiled=self.remote.models.compile({'id':downstream['id']})
        self.assertEqual(compiled['dependencies'][0]['id'],upstream['id'])
        self.assertIn('`test-project.sandbox.costs`',compiled['compiledSql'])
        job=self.remote.start({'action':'query','connection':self.id,'sql':sql,'model':downstream['id']},self.session)
        self.assertEqual(self.wait(job['id'])['state'],'done')
        self.assertEqual(self.remote.job(job['id'],self.session)['query'],compiled['compiledSql'])
        downstream=self.publish(downstream)
        self.assertEqual(downstream['published']['sql'],sql)
        self.assertEqual(downstream['published']['compiledSql'],compiled['compiledSql'])
        self.assertEqual(downstream['published']['references']['costs'],upstream['id'])
        plan=self.plan(downstream)
        upstream=self.remote.models.save({**upstream['draft'],'id':upstream['id'],'revision':upstream['revision'],'sql':'SELECT 99 AS cost'})
        self.publish(upstream)
        with self.assertRaisesRegex(ValueError,'upstream model changed'):
            self.remote.models.publish({'token':plan['token'],'confirmed':True},self.client,self.remote.connection(self.id))

    def test_reference_key_is_immutable_and_migrated_for_existing_models(self):
        m=self.new_model()
        renamed=self.remote.models.save({**m['draft'],'id':m['id'],'revision':m['revision'],'name':'New display name','table':'new_target'})
        self.assertEqual(renamed['reference'],'costs')
        reloaded=RemoteModels(self.root,self.remote)
        self.assertEqual(reloaded.view()['models'][0]['reference'],'costs')
        legacy=self.remote.models.view()
        del legacy['models'][0]['reference']
        import json
        self.remote.models.path.write_text(json.dumps(legacy))
        migrated=RemoteModels(self.root,self.remote)
        self.assertEqual(migrated.view()['models'][0]['reference'],'new_target')
