"""Project ownership and safe stop checks use isolated folders and registry."""
import http.client
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from urllib.parse import urlsplit


class ProjectManagerChecks(unittest.TestCase):
    def test_concurrent_launch_reuses_server_and_stop_is_scoped(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            registry = root/'registry.json'
            app = Path(__file__).resolve().parents[1]
            projects = []
            processes = []
            logs = []
            for name in ('first', 'second'):
                folder = root/name
                (folder/'.studio').mkdir(parents=True)
                (folder/'.studio/creation-options.json').write_text('{"sampleData":false,"sampleNotebooks":false}')
                projects.append(folder)
            def start(project, number):
                ready = root/f'ready{number}.json'
                log = tempfile.TemporaryFile(); logs.append(log)
                env = dict(os.environ, MDS_PROJECT_REGISTRY=str(registry), MDS_READY_FILE=str(ready), MDS_MANAGER_ID='test-owner')
                proc = subprocess.Popen([sys.executable,str(app/'serve.py'),'--project-dir',str(project),'--port','0'],env=env,stdout=log,stderr=log)
                processes.append(proc)
                return proc, ready
            def ready(file):
                deadline = time.monotonic()+35
                while time.monotonic()<deadline:
                    try: return json.loads(file.read_text())['url']
                    except (FileNotFoundError, ValueError): time.sleep(.05)
                self.fail('Server did not become ready')
            def request(url, method, path, token=''):
                c=http.client.HTTPConnection('localhost',urlsplit(url).port,timeout=5)
                c.request(method,path,headers={'X-Studio-Token':token})
                r=c.getresponse(); result=r.status,r.read(); c.close(); return result
            try:
                p1,r1=start(projects[0],1)
                p2,r2=start(projects[0],2)
                url=ready(r1); self.assertEqual(ready(r2),url)
                deadline=time.monotonic()+5
                while p1.poll() is None and p2.poll() is None and time.monotonic()<deadline: time.sleep(.05)
                self.assertEqual(sum(p.poll() is None for p in (p1,p2)),1)
                sibling, r3=start(projects[1],3); other=ready(r3)
                self.assertEqual(request(url,'POST','/manager/stop','wrong')[0],403)
                self.assertEqual(request(url,'GET','/project-health')[0],200)
                status, metadata = request(url,'GET','/project-metadata')
                self.assertEqual(status,200)
                self.assertEqual(json.loads(metadata), {'tables':0, 'views':0})
                # Table uploads must return a response before Python/R can run.
                c = http.client.HTTPConnection('localhost',urlsplit(url).port,timeout=5)
                c.request('POST','/kernel/input?run=12345678-1234-1234-1234-123456789abc&name=flowers',body=b'upload-test',headers={'Origin':url.rstrip('/')})
                response = c.getresponse()
                self.assertEqual(response.status,204)
                response.read(); c.close()

                entry=json.loads(registry.read_text())[str(projects[0].resolve())]
                self.assertEqual(entry['owner'],'test-owner')
                self.assertEqual(request(url,'POST','/manager/stop',entry['token'])[0],200)
                for p in (p1,p2): p.wait(timeout=8)
                self.assertEqual(request(other,'GET','/project-health')[0],200)
                self.assertTrue((projects[0]/'.studio/workspace.duckdb').is_file())
                p4,r4=start(projects[0],4)
                self.assertEqual(request(ready(r4),'GET','/project-health')[0],200)
                # Stop must still work after a folder is moved outside Studio.
                other_entry=json.loads(registry.read_text())[str(projects[1].resolve())]
                projects[1].rename(root/'moved-second')
                self.assertEqual(request(other,'POST','/manager/stop',other_entry['token'])[0],200)
                sibling.wait(timeout=8)

            finally:
                for p in processes:
                    if p.poll() is None: p.terminate()
                for p in processes: p.wait(timeout=10)
                for log in logs: log.close()
