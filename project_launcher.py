"""Open project servers without changing the workspace underneath existing tabs."""
import fcntl
import hashlib
import http.client
import urllib.parse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import secrets
from contextlib import contextmanager


def registry_path():
    override = os.environ.get('MDS_PROJECT_REGISTRY')
    folder = Path.home() / ('Library/Application Support/Minimal Data Studio' if sys.platform == 'darwin' else '.cache/minimal-data-studio')
    path = Path(override) if override else folder / 'projects.json'
    path.parent.mkdir(parents=True, exist_ok=True)
    return str(path)

@contextmanager
def registry_file(path):
    with open(path, 'a+') as f:
        os.chmod(path, 0o600)
        fcntl.flock(f, fcntl.LOCK_EX)
        f.seek(0)
        try:
            entries = json.loads(f.read() or '{}')
        except ValueError:
            entries = {}
        yield entries
        f.seek(0); f.truncate(); json.dump(entries, f); f.flush()

class ServerLease:
    """Lifetime lock acquired before seeding or opening any project database."""
    def __init__(self, project):
        self.project = str(Path(project).resolve())
        self.registry = registry_path()
        self.token = secrets.token_urlsafe(32)
        folder = Path(project) / '.studio'
        folder.mkdir(parents=True, exist_ok=True)
        self.file = open(folder / 'server.lock', 'a+')
        self.acquired = False

    def acquire(self):
        try:
            fcntl.flock(self.file, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.acquired = True
            return None
        except BlockingIOError:
            for _ in range(300):
                with registry_file(self.registry) as entries:
                    entry = entries.get(self.project, {})
                url = entry.get('url') if isinstance(entry, dict) else entry
                if url and ProjectLauncher.server_alive(self.project, url):
                    return url
                time.sleep(.1)
            raise ValueError('This project is already starting or running in another Studio instance. Wait a moment and reopen it; no second server was started.')

    def publish(self, url):
        with registry_file(self.registry) as entries:
            entries[self.project] = {'url':url, 'token':self.token, 'owner':os.environ.get('MDS_MANAGER_ID',''), 'pid':os.getpid()}

    def close(self):
        if self.acquired:
            with registry_file(self.registry) as entries:
                entry = entries.get(self.project)
                if isinstance(entry, dict) and entry.get('token') == self.token:
                    entries.pop(self.project, None)
            fcntl.flock(self.file, fcntl.LOCK_UN)
        self.file.close()


class ProjectLauncher:
    def __init__(self, root, data_root, project, url):
        self.root, self.data_root = str(root), str(data_root)
        self.registry = registry_path()
        self._registry(str(Path(project).resolve()), url)
        self.children = []
        self.lock = threading.Lock()

    def _registry(self, project=None, url=None):
        with registry_file(self.registry) as entries:
            if project is not None:
                old = entries.get(project, {})
                entries[project] = dict(old if isinstance(old, dict) else {}, url=url)
            return {key: value.get('url') if isinstance(value, dict) else value for key, value in entries.items()}

    def remap(self, previous, destination, url):
        with registry_file(self.registry) as entries:
            old = entries.pop(previous, {})
            entries[destination] = dict(old if isinstance(old, dict) else {}, url=url)

    @staticmethod
    def server_alive(project, url):
        """Only reuse a live Studio server serving this exact project."""
        connection = None
        try:
            parsed = urllib.parse.urlsplit(url)
            if parsed.scheme != 'http' or parsed.hostname not in ('localhost', '127.0.0.1') or not parsed.port:
                return False
            connection = http.client.HTTPConnection('127.0.0.1', parsed.port, timeout=2)
            connection.request('GET', '/project-health')
            response = connection.getresponse()
            info = json.loads(response.read(4096)) if response.status == 200 else {}
            expected = hashlib.sha256(os.fsencode(project)).hexdigest()
            return info.get('app') == 'minimal-data-studio' and info.get('project') == expected
        except (OSError, ValueError, TypeError, http.client.HTTPException):
            return False
        finally:
            if connection:
                connection.close()

    @staticmethod
    def is_project(folder):
        if (folder / '.studio' / 'workspace.duckdb').is_file():
            return True
        for marker in folder.glob('*.mdsproject'):
            try:
                if marker.stat().st_size > 4096:
                    continue
                data = json.loads(marker.read_text())
                if isinstance(data, dict) and data.get('format') == 'minimal-data-studio-project' and data.get('version') == 1:
                    return True
            except (OSError, ValueError):
                pass
        return False

    def pick_folder(self, path, create=False):
        candidates = [Path(self.root).parent/'ChooseFolder', Path(self.root)/'build'/'ChooseFolder']
        picker = next((p for p in candidates if p.is_file()), None)
        if sys.platform != 'darwin' or picker is None:
            raise ValueError('The native folder chooser is unavailable. Use the folder list or enter a full path.')
        result = subprocess.run([str(picker), str(Path(path).expanduser()), "create" if create else "open"], capture_output=True, text=True, timeout=300)
        if result.returncode:
            raise ValueError('The folder chooser could not open. Use the folder list instead.')
        selection = json.loads(result.stdout)
        if create and selection.get('path'):
            selected = Path(selection['path'])
            selection['exists'] = selected.exists()
            selection['isProject'] = selected.is_dir() and self.is_project(selected)
        return selection

    def folders(self, path):
        folder = Path(path).expanduser().resolve()
        if not folder.is_dir():
            raise ValueError('Choose an existing folder.')
        return {'path': str(folder), 'parent': str(folder.parent), 'isProject': self.is_project(folder), 'folders': sorted(
            [{'name':p.name, 'isProject':self.is_project(p)} for p in folder.iterdir() if not p.name.startswith('.') and p.is_dir()], key=lambda p: p['name'].casefold())}

    def open(self, path, create=False, name='', sample_data=False, sample_notebooks=False):
        with self.lock:
            folder = Path(path).expanduser()
            if not folder.is_absolute() or not folder.is_dir():
                raise ValueError('Choose an existing folder using its full path.')
            folder = folder.resolve()
            if create:
                if not name.strip() or name != name.strip() or name in ('.', '..') or '/' in name or '\\' in name:
                    raise ValueError('Enter a new folder name without slashes or surrounding spaces.')
                folder = folder / name
                if folder.exists():
                    if self.is_project(folder):
                        raise ValueError('A Studio project already exists here. Use Open project to open it, or choose a different name.')
                    raise ValueError('That folder already exists. Choose a new project name; nothing was overwritten.')
                folder.mkdir()
                (folder / '.studio').mkdir()
                (folder / '.studio' / 'creation-options.json').write_text(json.dumps({
                    'sampleData': bool(sample_data or sample_notebooks), 'sampleNotebooks': bool(sample_notebooks)}))
            key = str(folder)
            known = self._registry()
            if key in known and self.server_alive(key, known[key]):
                return self._selected(key, known[key])
            ready_dir = tempfile.TemporaryDirectory(prefix='mds-project-')
            ready = Path(ready_dir.name) / 'ready.json'
            env = dict(os.environ, MDS_PROJECT_REGISTRY=self.registry, MDS_READY_FILE=str(ready))
            log = tempfile.TemporaryFile(mode='w+b')
            proc = subprocess.Popen([sys.executable, str(Path(self.root)/'serve.py'), '--port', '0',
                '--project-dir', key, '--data-dir', self.data_root], env=env, stdout=subprocess.DEVNULL, stderr=log)
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline:
                if ready.exists():
                    try:
                        url = json.loads(ready.read_text())['url']
                    except (ValueError, KeyError):
                        time.sleep(.05)
                        continue
                    self._registry(key, url)
                    self.children.append((proc, log, ready_dir))
                    return self._selected(key, url)
                if proc.poll() is not None:
                    break
                time.sleep(.05)
            if stop_children and proc.poll() is None:
                proc.terminate()
                proc.wait(timeout=5)
            log.seek(0)
            detail = log.read().decode(errors='replace')[-1500:]
            log.close(); ready_dir.cleanup()
            raise ValueError('Could not open that project. Your current project is unchanged. ' + detail)

    def _selected(self, path, url):
        result = {'project': path, 'url': url}
        print('MDS_PROJECT:' + json.dumps(result), flush=True)
        return result

    def close(self, stop_children=True):
        for proc, log, ready in self.children:
            if stop_children and proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    proc.kill(); proc.wait()
            log.close(); ready.cleanup()
