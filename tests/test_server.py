"""Isolated HTTP regression checks; never touches the working saved file."""
import concurrent.futures
import http.client
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest


class ServerChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.tmp.name) / 'app'
        cls.root.mkdir()
        cls.data = Path(cls.tmp.name) / 'datasets'
        cls.data.mkdir()
        (cls.data / 'small.csv').write_text('value\n42\n')
        source = Path(__file__).resolve().parents[1]
        shutil.copy(source / 'serve.py', cls.root)
        shutil.copy(source / 'workspace_db.py', cls.root)
        shutil.copy(source / 'project_files.py', cls.root)
        shutil.copy(source / 'excel_files.py', cls.root)
        shutil.copy(source / 'runtime_setup.py', cls.root)
        shutil.copy(source / 'project_launcher.py', cls.root)
        shutil.copy(source / 'draft_data.py', cls.root)
        shutil.copytree(source / 'examples', cls.root / 'examples')
        shutil.copytree(source / 'project-guides', cls.root / 'project-guides')
        with socket.socket() as s:
            s.bind(('127.0.0.1', 0))
            cls.port = s.getsockname()[1]
        cls.server_log = tempfile.TemporaryFile(mode='w+b')
        cls.server = subprocess.Popen([sys.executable, str(cls.root / 'serve.py'), '--port', str(cls.port), '--data-dir', str(cls.data)], stdout=cls.server_log, stderr=cls.server_log, env=dict(os.environ, MDS_PROJECT_REGISTRY=str(Path(cls.tmp.name)/'registry.json')))
        cls.addClassCleanup(cls.stop_server)
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline and cls.server.poll() is None:
            try:
                status, _, _ = cls.request('GET', '/saved_queries.json', timeout=.5)
                if status == 200:
                    break
            except OSError:
                pass  # Some macOS runners time out instead of immediately refusing a startup connection.
            time.sleep(.05)
        else:
            cls.server_log.seek(0)
            raise RuntimeError('Server did not start:\n' + cls.server_log.read().decode(errors='replace'))

    @classmethod
    def stop_server(cls):
        registry = Path(cls.tmp.name)/'registry.json'
        if registry.exists():
            for entry in json.loads(registry.read_text()).values():
                if not isinstance(entry, dict) or not entry.get('token'): continue
                try:
                    from urllib.parse import urlsplit
                    c = http.client.HTTPConnection('localhost',urlsplit(entry['url']).port,timeout=5)
                    c.request('POST','/manager/stop',headers={'X-Studio-Token':entry['token']})
                    c.getresponse().read(); c.close()
                except OSError: pass
        if cls.server.poll() is None:
            cls.server.terminate()
            cls.server.wait(timeout=5)
        if not cls.server_log.closed:
            cls.server_log.close()

    @classmethod
    def tearDownClass(cls):
        cls.stop_server()
        cls.tmp.cleanup()

    @classmethod
    def request(cls, method, path, body=None, headers=None, timeout=5):
        c = http.client.HTTPConnection('127.0.0.1', cls.port, timeout=timeout)
        c.request(method, path, body, headers or {})
        r = c.getresponse()
        result = r.status, dict(r.getheaders()), r.read()
        c.close()
        return result

    def headers(self, version, client='one'):
        return {'Origin': f'http://localhost:{self.port}', 'Content-Type': 'application/json', 'X-Base-Version': version, 'X-Client': client}

    def test_save_conflict_and_backup_retention(self):
        _, h, original = self.request('GET', '/saved_queries.json')
        body = json.dumps({'queries': [], 'notebooks': [], 'dashboards': []})
        self.assertEqual(self.request('POST', '/saved_queries.json', body, self.headers(h['X-Version']))[0], 204)
        self.assertEqual(self.request('POST', '/saved_queries.json', body, self.headers(h['X-Version'], 'other'))[0], 409)
        backups = list((self.root / 'project' / 'backups').glob('*.json'))
        self.assertTrue(any(p.read_bytes() == original for p in backups))
        for i in range(55):
            _, current, _ = self.request('GET', '/saved_queries.json')
            self.assertEqual(self.request('POST', '/saved_queries.json', json.dumps({'queries': [], 'revision': i}), self.headers(current['X-Version']))[0], 204)
        self.assertEqual(len(list((self.root / 'project' / 'backups').glob('*.json'))), 50)

    def test_concurrent_clients_cannot_overwrite(self):
        _, h, _ = self.request('GET', '/saved_queries.json')
        def save(i):
            return self.request('POST', '/saved_queries.json', json.dumps({'queries': [], 'client': i}), self.headers(h['X-Version'], str(i)))[0]
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            self.assertEqual(sorted(pool.map(save, [10, 20])), [204, 409])

    def test_stale_same_client_and_force_cannot_overwrite(self):
        _, h, _ = self.request('GET', '/saved_queries.json')
        original = json.dumps({'queries':[{'id':'original','name':'Newer','sql':'SELECT 2'}]})
        self.assertEqual(self.request('POST','/saved_queries.json',original,self.headers(h['X-Version']))[0],204)
        stale = self.headers(h['X-Version'])
        stale['X-Force']='1'
        body = json.dumps({'queries':[{'id':'original','name':'Older','sql':'SELECT 1'}]})
        self.assertEqual(self.request('POST','/saved_queries.json',body,stale)[0],409)
        status, headers, result = self.request('POST','/saved-work-copy',body,stale)
        self.assertEqual(status,200)
        copies=json.loads(result)
        self.assertEqual(copies['work']['queries'][0]['sql'],'SELECT 2')
        self.assertEqual(copies['work']['queries'][1]['sql'],'SELECT 1')
        self.assertNotEqual(copies['work']['queries'][0]['id'],copies['work']['queries'][1]['id'])
        self.assertIn('X-Version',headers)

    def test_presence_counts_distinct_tabs(self):
        first=self.request('POST','/workspace-presence','',self.headers('none','presence-first'))
        second=self.request('POST','/workspace-presence','',self.headers('none','presence-second'))
        self.assertEqual(first[0],200)
        self.assertGreaterEqual(json.loads(second[2])['tabs'],2)
        self.assertEqual(self.request('POST','/workspace-presence','',{})[0],403)

    def test_origin_host_and_kernel_guards(self):
        for route in ['/saved_queries.json', '/kernel/input', '/kernel/run', '/db/query', '/db/import', '/db/session', '/db/project/open-folder', '/db/project/switch', '/db/project/choose-folder']:
            for headers in [{}, {'Origin':'http://example.com'}, {'Origin':f'http://localhost:{self.port}', 'Host':'example.com'}]:
                self.assertEqual(self.request('POST', route, '{}', headers)[0], 403)
        self.assertEqual(self.request('POST', '/kernel/input?run=../escape&name=test', 'x', self.headers('none'))[0],400)
        self.assertEqual(self.request('GET', '/kernel/result?run=../escape')[0],400)

    def test_native_database_http(self):
        import pyarrow as pa
        headers = self.headers('none')
        status, _, body = self.request('POST', '/db/session', '{}', headers)
        self.assertEqual(status, 200)
        session = json.loads(body)['session']
        def query(sql):
            status, _, body = self.request('POST', '/db/query?session=' + session, json.dumps({'sql': sql}), headers)
            self.assertEqual(status, 200, body)
            return pa.ipc.open_stream(body).read_all().to_pylist()
        self.assertEqual(self.request('POST', '/db/import?session=' + session + '&name=Sample.csv', b'id,label\n1,alpha\n2,\n', headers)[0], 200)
        query('CREATE VIEW live AS SELECT * FROM sample')
        query("UPDATE sample SET label='changed' WHERE id=1")
        self.assertEqual(query('SELECT * FROM live'), [{'id':1,'label':'changed'}, {'id':2,'label':None}])
        self.assertEqual(self.request('POST', '/db/file?session=' + session + '&name=../escape', b'x', headers)[0], 400)
        self.assertEqual(self.request('GET', '/.studio/workspace.duckdb')[0], 404)
        self.assertEqual(self.request('POST', '/db/project/open-folder?session=unknown', '{}', headers)[0], 400)
        self.assertEqual(self.request('POST', '/db/query?session=unknown', json.dumps({'sql':'SELECT 1'}), headers)[0], 400)
        for name, kind in [('live','view'), ('sample','table')]:
            self.assertEqual(self.request('POST', '/db/drop?session=' + session, json.dumps({'name': name, 'kind':kind}), headers)[0], 200)
        self.assertEqual(query("SELECT table_name FROM information_schema.tables WHERE table_schema='main'"), [])
        self.assertEqual(self.request('POST', '/db/close?session=' + session, '{}', headers)[0], 200)

    def test_runtime_api_requires_local_origin_and_session(self):
        headers = self.headers('none')
        sid = json.loads(self.request('POST','/db/session','{}',headers)[2])['session']
        path = '/db/runtime/check?session=' + sid
        payload = json.dumps({'language':'python'})
        bad = dict(headers, Origin='https://outside.example')
        self.assertEqual(self.request('POST',path,payload,bad)[0],403)
        self.assertEqual(self.request('POST','/db/terminal/start?session=invalid','{}',headers)[0],400)
        status, _, body = self.request('POST',path,payload,headers,timeout=25)
        self.assertEqual(status,200)
        self.assertTrue(json.loads(body)['version'])
        self.assertEqual(self.request('POST','/db/runtime/select?session='+sid,json.dumps({'language':'python','mode':'custom','path':'/does-not-exist'}),headers)[0],400)
        self.request('POST','/db/close?session='+sid,'{}',headers)

    def test_project_files_and_working_directory(self):
        import pyarrow as pa
        headers = self.headers('none')
        session = json.loads(self.request('POST', '/db/session', '{}', headers)[2])
        sid = session['session']
        listing = json.loads(self.request('GET', '/db/project/files?session=' + sid + '&path=data')[2])
        self.assertTrue(any(f['name'] == 'small.csv' for f in listing['entries']))
        prefix = '?session=' + sid
        original = b'id,label\n1,hello\n'
        status, _, body = self.request('POST', '/db/project/bring' + prefix + '&name=project_check.csv', original, headers)
        self.assertEqual(status, 200)
        file = json.loads(body)
        self.assertEqual(file['relative'], 'data/project_check.csv')
        def query(sql):
            status, _, data = self.request('POST','/db/query'+prefix,json.dumps({'sql':sql}),headers)
            self.assertEqual(status,200,data)
            return pa.ipc.open_stream(data).read_all().to_pylist()
        self.assertEqual(query("SELECT table_name FROM information_schema.tables WHERE table_name='project_check'"), [])
        self.assertEqual(query("SELECT * FROM read_csv('data/project_check.csv')"), [{'id':1,'label':'hello'}])
        preview = json.loads(self.request('GET','/db/project/preview'+prefix+'&path=data/project_check.csv')[2])
        self.assertEqual(preview['rows'], [['1','hello']])
        self.assertEqual(preview['tables'], [])
        self.assertEqual(query("SELECT table_name FROM information_schema.tables WHERE table_name='project_check'"), [])
        self.assertEqual(self.request('GET','/db/project/preview'+prefix+'&path=../outside')[0],400)

        self.assertEqual(self.request('POST','/db/project/import'+prefix,json.dumps({'path':file['relative']}),headers)[0],200)
        query("UPDATE project_check SET label='changed'")
        self.assertEqual(Path(file['full']).read_bytes(),original)
        self.assertEqual(self.request('GET','/db/project/files'+prefix+'&path=../')[0],400)
        self.assertEqual(self.request('GET','/project/data/project_check.csv')[0],404)
        self.assertEqual(self.request('POST','/db/project/import'+prefix,json.dumps({'path':'/etc/passwd'}),headers)[0],400)
        query('DROP TABLE project_check')
        self.request('POST','/db/close'+prefix,'{}',headers)

    def test_draft_http_workflow(self):
        import uuid
        headers = self.headers('unused')
        session = json.loads(self.request('POST', '/db/session', '{}', headers)[2])['session']
        draft = {'id':str(uuid.uuid4()),'revision':0,'name':'HTTP draft','raw':'code,amount\n00123,12.5','types':{'amount':{'kind':'integer'}},'blanksMissing':True,'history':[]}
        def post(action, **extra):
            status, _, body = self.request('POST', '/db/drafts/'+action+'?session='+session,json.dumps({'draft':draft,**extra}),headers)
            return status,json.loads(body)
        status,saved = post('save')
        self.assertEqual(status,200)
        draft['revision']=saved['revision']
        self.assertEqual(post('check')[1]['issueCount'],1)
        self.assertEqual(post('create',name='draft_http')[0],400)
        draft['types']['amount']['kind']='number'
        self.assertEqual(post('create',name='draft_http')[0],200)
        self.assertEqual(post('create',name='DRAFT_HTTP')[0],400)
        self.assertEqual(post('csv',name='draft_http.csv')[0],200)
        self.assertTrue(any(d['id']==draft['id'] for d in post('list')[1]['drafts']))
        self.request('POST','/db/query?session='+session,json.dumps({'sql':'DROP TABLE draft_http'}),headers)
        self.request('POST','/db/close?session='+session,'{}',headers)

    def test_configurable_data_and_private_paths(self):
        self.assertEqual(self.request('GET','/data/small.csv')[2], b'value\n42\n')
        for path in ['/data/%2e%2e/app/serve.py','/.git/config','/backups/','/.venv/']:
            self.assertEqual(self.request('GET',path)[0],404)

    def test_project_switch_create_and_return(self):
        headers = self.headers('unused')
        session = json.loads(self.request('POST', '/db/session', '{}', headers)[2])
        route = '/db/project/switch?session=' + session['session']
        parent = str(Path(self.tmp.name))
        status, _, body = self.request('POST', route, json.dumps({'mode':'create', 'path':parent, 'name':'Another project'}), headers, timeout=35)
        self.assertEqual(status, 200, body)
        destination = json.loads(body)
        project = Path(parent)/'Another project'
        self.assertTrue((project/'Open Project.mdsproject').is_file())
        empty_saved = json.loads((project/'saved_queries.json').read_text())
        self.assertEqual(empty_saved, {'queries':[], 'notebooks':[], 'dashboards':[]})
        self.assertEqual(list((project/'data').iterdir()), [])
        status, _, response = self.request('POST', route, json.dumps({'mode':'create', 'path':parent, 'name':'Sample project', 'sampleData':True, 'sampleNotebooks':True}), headers, timeout=35)
        self.assertEqual(status, 200, response)
        sample_project = Path(parent)/'Sample project'
        self.assertTrue((sample_project/'data/small.csv').is_file())
        self.assertTrue(json.loads((sample_project/'saved_queries.json').read_text())['notebooks'])
        self.assertNotEqual(destination['url'], f'http://localhost:{self.port}/')
        # Opening it again reuses the server. Creating over it is refused.
        self.assertEqual(json.loads(self.request('POST',route,json.dumps({'mode':'open','path':str(project)}),headers)[2])['url'], destination['url'])
        self.assertEqual(self.request('POST',route,json.dumps({'mode':'create','path':parent,'name':'Another project'}),headers)[0],400)
        self.assertEqual(self.request('POST',route,json.dumps({'mode':'create','path':parent,'name':'../escape'}),headers)[0],400)
        self.assertEqual(self.request('POST',route,json.dumps({'mode':'open','path':parent+'/missing'}),headers)[0],400)
        # The original session is still bound to the original folder.
        status, _, _ = self.request('POST','/db/query?session='+session['session'],json.dumps({'sql':'SELECT 1'}),headers)
        self.assertEqual(status,200)

    def test_z_rename_and_missing_project(self):
        headers = self.headers('unused')
        session = json.loads(self.request('POST', '/db/session', '{}', headers)[2])
        original = Path(session['project'])
        query = '/db/query?session=' + session['session']
        self.assertEqual(self.request('POST',query,json.dumps({'sql':'CREATE TABLE rename_check AS SELECT 42 AS value'}),headers)[0],200)
        route = '/db/project/rename?session=' + session['session']
        self.assertEqual(self.request('POST',route,json.dumps({'name':'../bad'}),headers)[0],400)
        status, _, body = self.request('POST',route,json.dumps({'name':'Renamed project'}),headers)
        self.assertEqual(status,200,body)
        destination = Path(json.loads(body)['project'])
        self.assertFalse(original.exists())
        self.assertTrue((destination/'Open Project.mdsproject').exists())
        new = json.loads(self.request('POST','/db/session','{}',headers)[2])
        self.assertEqual(new['project'],str(destination))
        self.assertEqual(self.request('POST','/db/query?session='+new['session'],json.dumps({'sql':'SELECT * FROM rename_check'}),headers)[0],200)
        moved = destination.with_name('Moved externally')
        destination.rename(moved)
        try:
            status, _, error = self.request('POST','/db/query?session='+new['session'],json.dumps({'sql':'SELECT 1'}),headers)
            self.assertEqual(status,409)
            self.assertIn('Project folder not found',json.loads(error)['error'])
            self.assertFalse(destination.exists())
        finally:
            moved.rename(destination)


if __name__ == '__main__':
    unittest.main()
