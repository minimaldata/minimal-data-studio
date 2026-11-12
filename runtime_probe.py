"""Check the real HTTP table-transfer path without changing project tables."""
import io
import json
import sys
import uuid
import urllib.request
from pathlib import Path
from project_launcher import registry_path
from urllib.parse import urlsplit
import pyarrow as pa
import pyarrow.parquet as pq


def check_all(base, selection=None):
    parsed = urlsplit(base)
    if parsed.scheme != 'http' or parsed.hostname not in ('localhost', '127.0.0.1'):
        raise ValueError('Runtime checks require a local Studio server.')
    base = base.rstrip('/')
    # The native manager already owns a private per-server token. Browser viewers
    # must not gain kernel execution just because runtime checks need it.
    token = ''
    try:
        entries = json.loads(Path(registry_path()).read_text())
        token = next((entry.get('token','') for entry in entries.values() if isinstance(entry,dict) and entry.get('url','').rstrip('/') == base), '')
    except (OSError, ValueError):
        pass
    def request(path, value=None, raw=False):
        body = value if isinstance(value, bytes) else json.dumps(value).encode() if value is not None else None
        req = urllib.request.Request(base + path, data=body, headers={'Origin': base, 'Content-Type':'application/json','X-Studio-Token':token})
        with urllib.request.urlopen(req, timeout=75) as response:
            content = response.read()
        return content if raw else json.loads(content) if content else None
    results = []
    session = None
    try:
        session = request('/db/session', {})['session']
        selection_error = None
        if selection:
            try:
                request('/db/runtime/select?session='+session, selection)
            except Exception as e:
                if hasattr(e, 'read'):
                    try:
                        selection_error = json.loads(e.read()).get('error', str(e))
                    except Exception:
                        selection_error = str(e)
                else:
                    selection_error = str(e)
        try:
            result = request('/db/query?session='+session, {'sql':'SELECT 2 + 3 AS answer'}, True)
            assert pa.ipc.open_stream(result).read_all().to_pylist() == [{'answer':5}], 'SQL returned an unexpected result.'
            results.append({'name':'SQL', 'ok':True, 'detail':'Query and result transfer passed.'})
        except Exception as e:
            results.append({'name':'SQL', 'ok':False, 'detail':str(e)})
        buf = io.BytesIO(); pq.write_table(pa.table({'value':[2,3]}),buf)
        for lang, code in [('python', 'probe.assign(value=probe["value"] * 2)'), ('r', 'transform(probe, value=value * 2)')]:
            stage = 'Runtime setup'
            setup = {}
            try:
                setup = request('/db/runtime/check?session='+session, {'language':lang})
                if not setup.get('ready'):
                    raise RuntimeError(setup.get('error') or 'Missing required packages: '+', '.join(p['name'] for p in setup.get('packages',[]) if not p.get('ok')))
                run = str(uuid.uuid4())
                stage = 'Sending the input table'
                request('/kernel/input?run='+run+'&name=probe',buf.getvalue(),True)
                stage = 'Running the code'
                out = request('/kernel/run', {'run':run,'lang':lang,'code':code,'params':{}})
                if out.get('error'): raise RuntimeError(out['error'])
                if not out.get('result'): raise RuntimeError('No output table was returned.')
                stage = 'Reading the output table'
                result = request('/kernel/result?run='+run,raw=True)
                assert pq.read_table(io.BytesIO(result)).column('value').to_pylist() == [4,6], 'Unexpected output values.'
                results.append({'name':lang.title() if lang=='python' else 'R','ok':True,'setup':setup,'detail':f"{setup.get('version','')} · {setup.get('mode','managed')} · table round-trip passed."})
            except Exception as e:
                results.append({'name':lang.title() if lang=='python' else 'R','ok':False,'setup':setup,'detail':stage+': '+str(e)})
        if selection_error:
            results[0]['selectionError'] = selection_error
    except Exception as e:
        results = [{'name':n,'ok':False,'detail':'Could not connect to the project: '+str(e)} for n in ('SQL','Python','R')]
    finally:
        if session:
            try: request('/db/close?session='+session,{})
            except Exception: pass
    return results

if __name__ == '__main__':
    print(json.dumps(check_all(sys.argv[1], json.loads(sys.argv[2]) if len(sys.argv)>2 else None)))
