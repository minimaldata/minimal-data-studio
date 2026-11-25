import tempfile
import unittest
from pathlib import Path
from interactive_documents import InteractiveDocuments, DocumentConflict

class InteractiveDocumentTests(unittest.TestCase):
    def test_roundtrip_conflict_and_backup(self):
        with tempfile.TemporaryDirectory() as root:
            store=InteractiveDocuments(root)
            self.assertEqual(store.read()['revision'],0)
            doc=dict(id='one',name='Scenario',html='<h1>Hi</h1>',css='',javascript='',inputs={'baseline':[1]},state={'a':10,'result':[11]})
            result=store.save(dict(revision=0,documents=[doc]))
            self.assertEqual(InteractiveDocuments(root).read(),result)
            with self.assertRaises(DocumentConflict):store.save(dict(revision=0,documents=[]))
            store.save(dict(revision=1,documents=[doc]))
            self.assertTrue((Path(root)/'.studio/interactive-backups/000000000001.json').exists())
            self.assertEqual(store.read()['documents'][0]['state'],doc['state'])

    def test_invalid_payload_preserves_previous(self):
        with tempfile.TemporaryDirectory() as root:
            store=InteractiveDocuments(root)
            with self.assertRaises(ValueError):store.save(dict(revision=0,documents=[{}]))
            self.assertEqual(store.read()['revision'],0)

class AppFolderTests(unittest.TestCase):
    def test_source_and_state_stay_separate(self):
        from interactive_documents import app_folder
        import json
        with tempfile.TemporaryDirectory() as root:
            folder=Path(root)/'interactive/demo'
            folder.mkdir(parents=True)
            (folder/'app.json').write_text(json.dumps(dict(format=1,entry='index.html',scripts=['model.js'])))
            (folder/'index.html').write_text('<h1>Example</h1>')
            (folder/'model.js').write_text('studio.saveState({a:2});')
            loaded=app_folder(root,'interactive/demo')
            self.assertEqual(loaded['javascript'],'studio.saveState({a:2});')
            doc=dict(id='folder-app',name='Example',folder='interactive/demo',inputs={},state={'a':42})
            store=InteractiveDocuments(root)
            store.save(dict(revision=0,documents=[doc]))
            (folder/'model.js').write_text('/* Agent update */')
            store.save(dict(revision=1,documents=[doc]))
            self.assertEqual((folder/'model.js').read_text(),'/* Agent update */')
            self.assertEqual(store.read()['documents'][0]['state'],{'a':42})
            self.assertNotIn('javascript',store.read()['documents'][0])

    def test_rejects_escape_and_symlinks(self):
        from interactive_documents import app_folder
        with tempfile.TemporaryDirectory() as root:
            for path in ('../outside','/tmp','.studio','interactive/../secret'):
                with self.assertRaises(ValueError):app_folder(root,path)
            folder=Path(root)/'demo';folder.mkdir()
            (folder/'secret.js').symlink_to('/etc/hosts')
            with self.assertRaises(ValueError):app_folder(root,'demo')

    def test_sql_source_save_and_conflict(self):
        import json
        from interactive_documents import save_app_sql
        with tempfile.TemporaryDirectory() as root:
            folder=Path(root)/'interactive'/'app';folder.mkdir(parents=True)
            (folder/'app.json').write_text(json.dumps({'format':1,'inputs':{'data':{'sql':'query.sql'}}}))
            (folder/'index.html').write_text('App')
            source=folder/'query.sql';source.write_text('SELECT 1')
            request=dict(folder='interactive/app',source='query.sql',expected='SELECT 1',content='SELECT 2')
            save_app_sql(root,request)
            self.assertEqual(source.read_text(),'SELECT 2')
            self.assertTrue(list((Path(root)/'.studio/sql-source-backups').glob('*.sql')))
            with self.assertRaises(DocumentConflict):save_app_sql(root,request)
            self.assertEqual(source.read_text(),'SELECT 2')
            request['source']='../outside.sql'
            with self.assertRaises(ValueError):save_app_sql(root,request)
            source.unlink();source.symlink_to(folder/'index.html')
            request['source']='query.sql'
            with self.assertRaises(ValueError):save_app_sql(root,request)

class RecoveryChecks(unittest.TestCase):
    def test_checkpoint_is_separate_and_invalid_payload_preserves_it(self):
        from interactive_documents import InteractiveRecovery
        with tempfile.TemporaryDirectory() as root:
            recovery=InteractiveRecovery(root)
            value={'revision':0,'documents':[],'sqlDrafts':[['app/q.sql',{'text':'SELECT 2','base':'SELECT 1'}]]}
            recovery.save(value)
            self.assertEqual(InteractiveRecovery(root).read(),value)
            self.assertEqual(InteractiveDocuments(root).read()['revision'],0)
            with self.assertRaises(ValueError):recovery.save({'revision':'bad'})
            self.assertEqual(recovery.read(),value)
            recovery.save(None)
            self.assertIsNone(recovery.read())

class HardeningChecks(unittest.TestCase):
    def test_versions_and_missing_app_preserve_saved_work(self):
        import json
        from interactive_documents import app_folder
        with tempfile.TemporaryDirectory() as root:
            folder=Path(root)/'app';folder.mkdir()
            manifest={'format':1,'apiVersion':1,'stateVersion':2}
            (folder/'app.json').write_text(json.dumps(manifest));(folder/'index.html').write_text('App')
            self.assertEqual(app_folder(root,'app')['stateVersion'],2)
            manifest['apiVersion']=99;(folder/'app.json').write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError,'unsupported Studio API'):app_folder(root,'app')
            store=InteractiveDocuments(root)
            missing=dict(id='missing',name='Unavailable app',folder='gone/app',stateVersion=1,inputs={},state={'important':42})
            store.save(dict(revision=0,documents=[missing]))
            self.assertEqual(store.read()['documents'][0]['state'],{'important':42})

    def test_recovery_rejects_malformed_source_entries(self):
        from interactive_documents import InteractiveRecovery
        with tempfile.TemporaryDirectory() as root:
            store=InteractiveRecovery(root)
            for drafts in ([['../secret',{'text':'','base':''}]],[[1,{}]],[['app/file.sql',{'text':[], 'base':''}]]):
                with self.assertRaises(ValueError):store.save({'revision':0,'documents':[],'sqlDrafts':drafts})
            self.assertIsNone(store.read())

    def test_failed_replace_keeps_previous_document(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as root:
            store=InteractiveDocuments(root);store.save({'revision':0,'documents':[]})
            with patch('interactive_documents.os.replace',side_effect=OSError('Disk full')):
                with self.assertRaises(OSError):store.save({'revision':1,'documents':[]})
            self.assertEqual(store.read()['revision'],1)

    def test_project_copy_keeps_app_source_and_state(self):
        import shutil,json
        from interactive_documents import app_folder,InteractiveRecovery
        with tempfile.TemporaryDirectory() as parent:
            root=Path(parent)/'original';folder=root/'interactive'/'demo';folder.mkdir(parents=True)
            (folder/'app.json').write_text(json.dumps({'format':1,'stateVersion':1}));(folder/'index.html').write_text('<h1>Portable</h1>')
            doc=dict(id='demo',name='Portable',folder='interactive/demo',inputs={'data':[{'n':42}]},state={'selection':'A'})
            InteractiveDocuments(root).save({'revision':0,'documents':[doc]})
            InteractiveRecovery(root).save({'revision':1,'documents':[doc],'sqlDrafts':[]})
            copy=Path(parent)/'copied';shutil.copytree(root,copy)
            self.assertEqual(app_folder(copy,'interactive/demo')['html'],'<h1>Portable</h1>')
            self.assertEqual(InteractiveDocuments(copy).read()['documents'],[doc])
            self.assertEqual(InteractiveRecovery(copy).read()['documents'],[doc])
