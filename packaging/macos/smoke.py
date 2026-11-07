#!/usr/bin/env python3
"""Check a relocated bundle against a disposable project."""
import http.client
import json
import os
import plistlib
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

with tempfile.TemporaryDirectory(prefix='Studio package test ') as temp:
    app = Path(temp)/'Moved Studio.app'
    shutil.copytree(Path(sys.argv[1]).resolve(), app, symlinks=True)
    subprocess.run(['codesign','--verify','--deep','--strict',str(app)],check=True)
    info = plistlib.loads((app/'Contents/Info.plist').read_bytes())
    assert info['CFBundleDocumentTypes'][0]['LSItemContentTypes'] == ['com.minimaldata.studio.project']
    resources = app/'Contents/Resources'
    python = resources/'python/bin/python3'
    project = Path(temp)/'Student project'
    project.mkdir()
    env = dict(os.environ, PYTHONNOUSERSITE='1', PYTHONDONTWRITEBYTECODE='1', PYTHONUNBUFFERED='1', MPLCONFIGDIR=str(Path(temp)/'matplotlib'))
    env.pop('PYTHONPATH',None)
    env.pop('PYTHONHOME',None)
    subprocess.run([str(resources/'python/bin/pip'),'--version'],env=env,check=True)
    for iteration in range(2):
        with tempfile.TemporaryFile() as log:
            proc = subprocess.Popen([str(python),str(resources/'studio/serve.py'),'--project-dir',str(project),'--port','0','--seed-project'],env=env,stdout=subprocess.PIPE,stderr=log,text=True)
            try:
                line = proc.stdout.readline().strip()
                assert line.startswith('Minimal Data Studio: http://localhost:'), line
                port = int(line.rsplit(':',1)[1])
                def request(path, body):
                    connection = http.client.HTTPConnection('localhost',port,timeout=60)
                    connection.request('POST',path,json.dumps(body),{'Origin':f'http://localhost:{port}','Content-Type':'application/json'})
                    response = connection.getresponse()
                    data = response.read()
                    assert response.status == 200, (response.status,data)
                    connection.close()
                    return data
                sid = json.loads(request('/db/session',{}))['session']
                query = '/db/query?session='+sid
                if iteration == 0:
                    request(query,{'sql':'CREATE TABLE package_check AS SELECT 42 AS answer'})
                    request(query,{'sql':'CREATE VIEW package_view AS SELECT * FROM package_check'})
                    checked = json.loads(request('/db/runtime/check?session='+sid,{'language':'python'}))
                    assert checked['ready'], checked
                    assert str(app) in checked['path'], checked
                    result = json.loads(request('/kernel/run',{'run':'package_smoke','lang':'python','code':'import pandas as pd\nprint("BUNDLED_PYTHON_OK")\npd.DataFrame({"answer":[42]})'}))
                    assert result['error'] is None and 'BUNDLED_PYTHON_OK' in result['stdout'] and result['result'], result
                data = request(query,{'sql':'SELECT * FROM package_view'})
                decode = subprocess.run([str(python),'-c','import sys,pyarrow as pa; assert pa.ipc.open_stream(sys.stdin.buffer.read()).read_all().to_pylist()==[{"answer":42}]'],input=data,env=env)
                assert decode.returncode == 0
                assert (project/'data/iris.csv').exists()
                marker = json.loads((project/'Open Project.mdsproject').read_text())
                assert marker == {'format':'minimal-data-studio-project','version':1}
                assert json.loads(request('/db/runtime/check?session='+sid, {'language':'python'}))['ready']
                request('/db/close?session='+sid,{})
            finally:
                proc.terminate()
                proc.wait(timeout=10)
                if proc.returncode not in (0,-15):
                    log.seek(0)
                    print(log.read().decode(),file=sys.stderr)
                    raise RuntimeError('Server failed')
    print('PASS: relocated signature, pip, bundled runtime/packages, Python execution, SQL tables/views, restart persistence, sample seeding')
