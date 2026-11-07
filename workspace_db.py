"""One local DuckDB file, isolated browser connections, and resumable legacy import."""
import io
import json
import re
import shutil
import tempfile
import threading
import time
import uuid
from pathlib import Path

import duckdb
import pyarrow as pa


def ident(value):
    return '"' + value.replace('"', '""') + '"'


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


class Workspace:
    def __init__(self, root, data_root, project_root=None, migrate_legacy=True):
        self.root = Path(root)
        self.project_root = Path(project_root or root).resolve()
        self.folder = self.project_root / '.studio'
        self.folder.mkdir(exist_ok=True)
        self.path = self.folder / 'workspace.duckdb'
        self.lock = threading.RLock()
        self.connection = duckdb.connect(str(self.path))
        self.sessions = {}
        self.warnings = []
        self.connection.execute('CREATE SCHEMA IF NOT EXISTS _studio')
        self.connection.execute('CREATE TABLE IF NOT EXISTS _studio.imports (source VARCHAR PRIMARY KEY, name VARCHAR, imported_at TIMESTAMP DEFAULT current_timestamp)')
        self.migrate_legacy = migrate_legacy
        self.initialize(Path(data_root))

    def imported(self, key):
        return self.connection.execute('SELECT 1 FROM _studio.imports WHERE source = ?', [key]).fetchone() is not None

    def import_once(self, key, name, sql):
        if self.imported(key):
            return
        c = self.connection
        c.execute('BEGIN')
        try:
            c.execute(sql)
            c.execute('INSERT INTO _studio.imports(source,name) VALUES (?, ?)', [key, name])
            c.execute('COMMIT')
        except Exception:
            c.execute('ROLLBACK')
            raise

    def initialize(self, data_root):
        config = self.root / 'datasets.json'
        try:
            datasets = json.loads(config.read_text()) if config.exists() else {}
            for name, relative in datasets.items():
                key = 'dataset:' + name.lower()
                try:
                    if self.imported(key):
                        continue
                    file = (data_root / relative).resolve()
                    if data_root.resolve() not in file.parents or file.suffix.lower() not in ('.csv', '.parquet'):
                        raise ValueError('Expected a CSV/Parquet file inside the data directory')
                    reader = 'read_parquet' if file.suffix.lower() == '.parquet' else 'read_csv_auto'
                    self.import_once(key, name, f'CREATE TABLE {ident(name)} AS SELECT * FROM {reader}({literal(file)})')
                except Exception as e:
                    self.warnings.append(f'{name}: {e}')
        except Exception as e:
            self.warnings.append(f'datasets.json: {e}')
        # Bootstrap SQL executes once, never on reload (so it cannot resurrect dropped objects).
        views = self.root / 'views.sql'
        if views.exists():
            try:
                sql = views.read_text()
                if self.connection.extract_statements(sql):
                    self.import_once('bootstrap:views.sql', 'views.sql', sql)
            except Exception as e:
                self.warnings.append(f'views.sql: {e}')
        if not self.migrate_legacy:
            self.connection.execute('CHECKPOINT')
            return
        legacy = self.root / '.relations'
        records = []
        for file in sorted(legacy.glob('*.json')):
            try:
                r = json.loads(file.read_text())
                if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', r['name']) or not re.fullmatch(r'[a-f0-9]{32}', r['id']) or r['kind'] not in ('table', 'view'):
                    raise ValueError('Invalid legacy record')
                if not self.imported('legacy:' + r['id']):
                    records.append(r)
            except Exception as e:
                self.warnings.append(f'{file.name}: {e}; original retained')
        if records:
            archive = self.folder / 'migration-backup'
            if not archive.exists():
                shutil.copytree(legacy, archive)
        pending = sorted(records, key=lambda r: r['kind'] != 'table')
        while pending:
            failed = []
            for r in pending:
                try:
                    if r['kind'] == 'table':
                        file = legacy / (r['id'] + '.parquet')
                        sql = f'CREATE TABLE {ident(r["name"])} AS SELECT * FROM read_parquet({literal(file)})'
                    else:
                        sql = r['sql']
                    self.import_once('legacy:' + r['id'], r['name'], sql)
                except Exception as e:
                    failed.append((r, str(e)))
            if len(failed) == len(pending):
                self.warnings.extend(f'{r["name"]}: {e}; legacy original retained, migration will retry on server restart' for r, e in failed)
                break
            pending = [r for r, _ in failed]
        self.connection.execute('CHECKPOINT')

    def new_session(self):
        with self.lock:
            for key, s in list(self.sessions.items()):
                if time.time() - s['used'] > 86400:
                    self.close_session(key)
            key = uuid.uuid4().hex
            directory = tempfile.mkdtemp(prefix='studio-db-')
            self.sessions[key] = {'conn': self.connection.cursor(), 'dir': directory, 'used': time.time()}
            return {'session': key, 'directory': directory, 'warnings': self.warnings, 'database': str(self.path), 'project': str(self.project_root)}

    def session(self, key):
        if key not in self.sessions:
            raise ValueError('Database session expired. Reload the page to reconnect.')
        s = self.sessions[key]
        s['used'] = time.time()
        return s

    def close_session(self, key):
        s = self.sessions.pop(key, None)
        if s:
            s['conn'].close()  # rolls back an unfinished explicit transaction
            shutil.rmtree(s['dir'], ignore_errors=True)

    def file(self, session, name):
        if not re.fullmatch(r'[A-Za-z0-9_.-]+', name) or name in ('.', '..'):
            raise ValueError('Invalid transfer file name')
        return Path(session['dir']) / name

    def query(self, session, sql):
        c = session['conn']
        statements = c.extract_statements(sql)
        if len(statements) != 1:
            raise ValueError('Send one SQL statement at a time.')
        c.execute(sql)
        table = c.fetch_arrow_table()
        sink = pa.BufferOutputStream()
        with pa.ipc.new_stream(sink, table.schema) as writer:
            writer.write_table(table)
        return sink.getvalue().to_pybytes()

    def import_file(self, session, filename, body):
        file = self.file(session, uuid.uuid4().hex + Path(filename).suffix.lower())
        try:
            file.write_bytes(body)
            return self.import_path(session, file, filename)
        finally:
            file.unlink(missing_ok=True)

    def import_path(self, session, file, filename=None):
        file = Path(file)
        filename = filename or file.name
        suffix = file.suffix.lower()
        reader = {'.csv': 'read_csv_auto', '.tsv': 'read_csv_auto', '.json': 'read_json_auto', '.parquet': 'read_parquet'}.get(suffix)
        if not reader:
            raise ValueError('Import supports CSV, TSV, JSON and Parquet files.')
        base = re.sub(r'\W+', '_', Path(filename).stem, flags=re.ASCII).lower() or 'imported_table'
        if base[0].isdigit():
            base = '_' + base
        c = session['conn']
        used = {r[0].lower() for r in c.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='main'").fetchall()}
        name, n = base, 2
        while name in used:
            name, n = f'{base}_{n}', n + 1
        options = ", delim='\\t', header=true" if suffix == '.tsv' else ''
        c.execute(f'CREATE TABLE {ident(name)} AS SELECT * FROM {reader}({literal(file)}{options})')
        return {'name': name, 'source': str(file)}

    def arrow_table(self, session, name, body):
        if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', name):
            raise ValueError('Invalid table name')
        table = pa.ipc.open_stream(io.BytesIO(body)).read_all()
        c = session['conn']
        binding = '_arrow_' + uuid.uuid4().hex
        c.register(binding, table)
        try:
            c.execute(f'CREATE TEMP TABLE {ident(name)} AS SELECT * FROM {ident(binding)}')
        finally:
            c.unregister(binding)

    def close(self):
        with self.lock:
            for key in list(self.sessions):
                self.close_session(key)
            self.connection.close()
