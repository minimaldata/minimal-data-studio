"""Revision-checked project-local interactive documents; no code is executed here."""
import json
import os
import shutil
from interactive_inputs import validate_bindings
from pathlib import Path

MAX_BYTES = 4_000_000

class DocumentConflict(ValueError):
    pass


def validate_documents(documents):
    if not isinstance(documents, list) or len(documents) > 100:
        raise ValueError('Expected at most 100 interactive documents.')
    ids = set()
    for doc in documents:
        if not isinstance(doc, dict) or not isinstance(doc.get('id'), str) or not doc['id'] or doc['id'] in ids:
            raise ValueError('Each document needs a unique ID.')
        ids.add(doc['id'])
        validate_bindings(doc.get('bindings', []))
        if type(doc.get('stateVersion', 1)) is not int or doc.get('stateVersion', 1) < 1:
            raise ValueError('Saved stateVersion must be a positive integer.')
        if not isinstance(doc.get('parameters', {}), dict):
            raise ValueError('Saved parameters must be an object.')
        if 'folder' in doc:
            folder_parts(doc['folder'])
        for key in (('name',) if 'folder' in doc else ('name', 'html', 'css', 'javascript')):
            if not isinstance(doc.get(key), str) or len(doc[key]) > 500_000:
                raise ValueError('Invalid document ' + key)
        if not doc['name'].strip() or len(doc['name']) > 120:
            raise ValueError('Use a document name of 1–120 characters.')
        if not isinstance(doc.get('inputs'), dict) or not isinstance(doc.get('state'), dict):
            raise ValueError('Inputs and state must be JSON objects.')
    return documents

class InteractiveDocuments:
    def __init__(self, project):
        self.path = Path(project) / '.studio' / 'interactive-documents.json'

    def read(self):
        if not self.path.exists():
            return {'format': 1, 'revision': 0, 'documents': []}
        value = json.loads(self.path.read_text())
        if not isinstance(value, dict) or value.get('format') != 1 or type(value.get('revision')) is not int or value['revision'] < 0:
            raise ValueError('Unsupported interactive document format or revision. Existing work has not been changed.')
        validate_documents(value.get('documents'))
        return value

    def save(self, request):
        if not isinstance(request, dict): raise ValueError('Expected a document object.')
        current = self.read()
        if request.get('revision') != current['revision']:
            raise DocumentConflict('Interactive documents changed in another window. Reload before saving; your edits are still here.')
        documents = validate_documents(request.get('documents'))
        value = {'format': 1, 'revision': current['revision'] + 1, 'documents': documents}
        body = json.dumps(value, allow_nan=False, ensure_ascii=False)
        if len(body.encode()) > MAX_BYTES:
            raise ValueError('Interactive documents exceed the 4 MB prototype limit. Use a smaller input snapshot.')
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if self.path.exists():
            backups = self.path.parent / 'interactive-backups'
            backups.mkdir(exist_ok=True)
            shutil.copyfile(self.path, backups / f"{current['revision']:012}.json")
        temporary = self.path.with_suffix('.tmp')
        temporary.write_text(body)
        os.replace(temporary, self.path)
        for old in sorted((self.path.parent / 'interactive-backups').glob('*.json'))[:-20]:
            try: old.unlink()
            except OSError: pass  # The save succeeded even if an old backup could not be pruned.
        return value


def folder_parts(relative):
    from pathlib import PurePosixPath
    if not isinstance(relative, str) or not relative or '\\' in relative:
        raise ValueError('Choose a project-relative app folder.')
    parts = PurePosixPath(relative).parts
    if not parts or PurePosixPath(relative).is_absolute() or any(p.startswith('.') or p in ('backups', 'node_modules') for p in parts):
        raise ValueError('App folders must be inside the project, outside private folders.')
    return parts


def app_folder(project, relative):
    """Read a bounded, explicitly attached app folder; never follow symlinks."""
    parts = folder_parts(relative)
    base = Path(project).resolve()
    folder = base
    for part in parts:
        folder = folder / part
        if folder.is_symlink():
            raise ValueError('App folders cannot contain symlinks.')
    if not folder.is_dir():
        raise ValueError('App folder not found.')
    files = {}
    total = 0
    for parent, dirs, names in os.walk(folder, followlinks=False):
        dirs[:] = sorted(d for d in dirs if not d.startswith('.') and d not in ('node_modules', 'backups'))
        for name in dirs + names:
            if (Path(parent) / name).is_symlink():
                raise ValueError('App folders cannot contain symlinks.')
        for name in sorted(names):
            path = Path(parent) / name
            if name.startswith('.') or path.suffix.lower() not in ('.html', '.css', '.js', '.mjs', '.json', '.md', '.txt', '.svg', '.sql'):
                continue
            if path.stat().st_size > 500_000:
                raise ValueError('App source files must be under 500 KB.')
            raw = path.read_bytes()
            total += len(raw)
            if total > 2_000_000 or len(files) >= 100:
                raise ValueError('App folders are limited to 100 source files / 2 MB in this preview.')
            files[path.relative_to(folder).as_posix()] = raw.decode('utf-8')
    try:
        manifest = json.loads(files['app.json'])
        if not isinstance(manifest, dict) or manifest.get('format') != 1:
            raise ValueError('app.json must use format 1.')
        api_version = manifest.get('apiVersion', 1)
        state_version = manifest.get('stateVersion', 1)
        if type(api_version) is not int or api_version != 1:
            raise ValueError('This app requires an unsupported Studio API version. Update Studio or use an API version 1 app.')
        if type(state_version) is not int or state_version < 1:
            raise ValueError('app.json stateVersion must be a positive integer.')
        from interactive_inputs import validate_contract
        contract = validate_contract(manifest.get('inputs', {}))
        from interactive_parameters import parameter_values
        parameters = manifest.get('parameters', {})
        parameter_values(parameters)
        for name, spec in contract.items():
            if 'sql' in spec and (not isinstance(spec['sql'], str) or not spec['sql'].endswith('.sql') or spec['sql'] not in files):
                raise ValueError('Input ' + name + ' references a missing or unsupported SQL file inside the app folder.')
        def content(key, default, many=False):
            paths = manifest.get(key, default)
            if not many: paths = [paths]
            if not isinstance(paths, list) or not all(isinstance(p, str) and p in files for p in paths):
                raise ValueError('app.json references a missing or unsupported ' + key + ' file.')
            return '\n'.join(files[p] for p in paths)
        return {'apiVersion': api_version, 'stateVersion': state_version, 'folder': relative, 'files': files, 'inputs': contract, 'parameters': parameters,
                'sqlHashes': {path: __import__('hashlib').sha256(text.encode()).hexdigest() for path,text in files.items() if path.endswith('.sql')}, 'name': manifest.get('name', folder.name),
                'html': content('entry', 'index.html'), 'css': content('styles', [], True),
                'javascript': content('scripts', [], True)}
    except (KeyError, json.JSONDecodeError):
        raise ValueError('The app folder needs a valid app.json manifest.')


def save_app_sql(project, request):
    """Compare source before replacing a declared SQL file; keep a recovery copy."""
    import hashlib
    import tempfile
    folder, source = request.get('folder'), request.get('source')
    content, expected = request.get('content'), request.get('expected')
    if not isinstance(content, str) or not isinstance(expected, str) or len(content.encode()) > 500_000:
        raise ValueError('SQL source must be text under 500 KB.')
    app = app_folder(project, folder)
    if source not in {spec.get('sql') for spec in app['inputs'].values()} or source not in app['files']:
        raise ValueError('Choose a SQL file declared by this app.')
    original = app['files'][source]
    if original != expected:
        raise DocumentConflict('SQL file changed on disk. Your edits were kept; copy them before reloading the source.')
    target = Path(project) / folder / source
    backup = Path(project) / '.studio' / 'sql-source-backups'
    backup.mkdir(parents=True, exist_ok=True)
    (backup / (hashlib.sha256(original.encode()).hexdigest()+'.sql')).write_text(original)
    fd, temporary = tempfile.mkstemp(prefix='.sql-', dir=target.parent)
    try:
        with os.fdopen(fd, 'w') as out: out.write(content)
        if target.is_symlink() or target.read_text() != expected:
            raise DocumentConflict('SQL file changed on disk. Your edits were kept.')
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)
    return {'content': content}


class InteractiveRecovery:
    """A separate checkpoint; restoring never bypasses the saved revision check."""
    def __init__(self, project):
        self.path = Path(project) / '.studio' / 'interactive-recovery' / 'draft.json'

    def read(self):
        value = json.loads(self.path.read_text()) if self.path.exists() else None
        validate_recovery(value)
        return value

    def save(self, value):
        validate_recovery(value)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix('.tmp')
        temporary.write_text(json.dumps(value, allow_nan=False))
        os.replace(temporary, self.path)
        return {'saved': True}


def validate_recovery(value):
    if value is None: return
    if not isinstance(value, dict) or type(value.get('revision')) is not int or value['revision'] < 0:
        raise ValueError('Invalid interactive recovery revision. Saved documents are unchanged.')
    validate_documents(value.get('documents'))
    drafts = value.get('sqlDrafts')
    if not isinstance(drafts, list) or len(drafts) > 200:
        raise ValueError('Invalid SQL draft recovery list.')
    for entry in drafts:
        if not isinstance(entry, list) or len(entry) != 2 or not isinstance(entry[0], str) or not isinstance(entry[1], dict):
            raise ValueError('Invalid SQL draft recovery entry.')
        folder_parts(entry[0])
        if any(not isinstance(entry[1].get(key), str) or len(entry[1][key].encode()) > 500_000 for key in ('text','base')):
            raise ValueError('SQL draft recovery requires bounded source text.')
    raw = value.get('raw')
    if raw is not None and (not isinstance(raw, dict) or any(not isinstance(raw.get(key), str) for key in ('name','html','css','javascript','inputs'))):
        raise ValueError('Invalid editor recovery fields.')
    if len(json.dumps(value, allow_nan=False).encode()) > 6_000_000:
        raise ValueError('Recovery checkpoint exceeds 6 MB. Save or export your work.')
