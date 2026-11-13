import json
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch
from google_profiles import GoogleProfiles


def info(token='alice'):
    return {'type':'authorized_user','client_id':'test-client','client_secret':'not-a-real-secret','refresh_token':token}

class ProfilesChecks(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)/'profiles';self.calls=[];self.account='alice'
        def runner(command,**kw):
            self.calls.append((command,kw))
            path=Path(kw['env']['CLOUDSDK_CONFIG'])/'application_default_credentials.json'
            path.write_text(json.dumps(info(self.account)))
        self.profiles=GoogleProfiles(self.root,identity=lambda c:c.refresh_token+'@example.com',runner=runner)
    def tearDown(self):self.tmp.cleanup()
    def login(self,name='Work',**kw):
        with patch('google_profiles.shutil.which',return_value='/fake/gcloud'):
            token=self.profiles.start({'name':name,**kw},'editor')['id']
            for _ in range(300):
                result=self.profiles.status(token,'editor')
                if result['state']!='running':return result
                time.sleep(.01)
        self.fail('Sign in never completed')
    def test_separate_accounts_and_no_global_adc_changes(self):
        original=dict(os.environ)
        a=self.login()['profile'];self.account='bob';b=self.login('Client B')['profile']
        self.assertNotEqual(a['id'],b['id'])
        self.assertEqual(a['account'],'alice@example.com');self.assertEqual(b['account'],'bob@example.com')
        ca=self.profiles.credentials(a['id'],'billing-one');cb=self.profiles.credentials(b['id'],'billing-two')
        self.assertEqual(ca.refresh_token,'alice');self.assertEqual(cb.refresh_token,'bob')
        self.assertEqual(ca.quota_project_id,'billing-one');self.assertEqual(cb.quota_project_id,'billing-two')
        self.assertEqual(dict(os.environ),original)
        self.assertEqual(self.root.stat().st_mode&0o777,0o700)
        self.assertEqual((self.root/a['id']/'application_default_credentials.json').stat().st_mode&0o777,0o600)
        self.assertFalse(any(p.name.startswith('.pending') for p in self.root.iterdir()))
        response=json.dumps(self.profiles.view())
        self.assertNotIn('refresh_token',response);self.assertNotIn('not-a-real-secret',response)
        for command,kw in self.calls:
            self.assertIn('--disable-quota-project',command)
            self.assertTrue(kw['env']['CLOUDSDK_CONFIG'].startswith(str(self.root)))
    def test_reconnect_cannot_change_identity_and_failure_preserves_token(self):
        a=self.login()['profile'];self.account='bob'
        result=self.login(profile=a['id'])
        self.assertEqual(result['state'],'error');self.assertIn('different Google account',result['error'])
        self.assertEqual(self.profiles.credentials(a['id'],'billing').refresh_token,'alice')
        self.profiles.identity=lambda c: (_ for _ in ()).throw(Exception('secret-token-do-not-show'))
        result=self.login()
        self.assertNotIn('secret-token',result['error'])
        self.assertEqual(len(self.profiles.view()['profiles']),1)
    def test_copy_default_adc_is_explicit_and_does_not_change_it(self):
        adc=Path(self.tmp.name)/'default.json';adc.write_text(json.dumps(info()))
        before=adc.read_bytes()
        with patch.dict(os.environ,{'GOOGLE_APPLICATION_CREDENTIALS':str(adc)}):result=self.login(mode='import')
        self.assertEqual(result['state'],'done');self.assertEqual(adc.read_bytes(),before);self.assertFalse(self.calls)
    def test_missing_profile_and_traversal_never_fall_back(self):
        for key in ('../secret','a'*32):
            with self.assertRaises(ValueError):self.profiles.credentials(key,'project')
        with self.assertRaises(ValueError):self.profiles.status('unknown','other')
    def test_owner_and_concurrent_login(self):
        import threading
        entered=threading.Event();release=threading.Event()
        original=self.profiles.identity
        def identity(c):entered.set();release.wait(5);return original(c)
        self.profiles.identity=identity
        with patch('google_profiles.shutil.which',return_value='/fake/gcloud'):
            token=self.profiles.start({'name':'Work'},'one')['id'];self.assertTrue(entered.wait(3))
            try:
                with self.assertRaisesRegex(ValueError,'another editor'):self.profiles.status(token,'two')
                with self.assertRaisesRegex(ValueError,'already in progress'):self.profiles.start({'name':'Other'},'two')
            finally:release.set()
            for _ in range(300):
                if self.profiles.status(token,'one')['state']!='running':break
                time.sleep(.01)
