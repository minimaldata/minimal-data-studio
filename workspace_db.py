"""One local DuckDB file, isolated browser connections, and resumable legacy import."""
import io
import difflib
from datetime import datetime, timezone
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
    def __init__(self, root, data_root, project_root=None, migrate_legacy=True, seed_samples=True):
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
        self.connection.execute('CREATE TABLE IF NOT EXISTS _studio.relation_heads (name VARCHAR PRIMARY KEY, generation VARCHAR, signature VARCHAR)')
        self.connection.execute('CREATE TABLE IF NOT EXISTS _studio.definition_versions (id VARCHAR PRIMARY KEY, generation VARCHAR, body VARCHAR)')
        self.connection.execute('CREATE TABLE IF NOT EXISTS _studio.database_folders (path VARCHAR PRIMARY KEY)')
        self.connection.execute('CREATE TABLE IF NOT EXISTS _studio.database_locations (name VARCHAR PRIMARY KEY, folder VARCHAR)')
        self.migrate_legacy = migrate_legacy
        self.seed_samples = seed_samples
        self.initialize(Path(data_root))
        # Recover provenance for the bundled datasets using their recorded imports.
        config = self.root / 'datasets.json'
        datasets = json.loads(config.read_text()) if config.exists() else {}
        for name, relative in datasets.items():
            source = self.project_root / 'data' / relative
            if source.is_file() and self.imported('dataset:' + name.lower()):
                row = self.connection.execute("SELECT comment FROM duckdb_tables() WHERE database_name=current_database() AND schema_name='main' AND table_name=?", [name]).fetchone()
                if row and row[0] is None:
                    self.mark_file_source(self.connection, name, source)


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
        if not self.seed_samples:
            return
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
        ddl = str(statements[0].type).split('.')[-1] in ('CREATE', 'ALTER', 'DROP')
        if ddl:
            self.sync_definitions(c)
        try:
            c.execute(sql)
        except duckdb.CatalogException as error:
            duplicate = re.search(r'(?:Table|View) with name "([^"]+)" already exists', str(error), re.I)
            if duplicate:
                message = self.duplicate_name_message(session, duplicate[1])
                if message:
                    raise ValueError(message) from error
            raise
        table = c.fetch_arrow_table()
        if ddl:
            self.sync_definitions(c, sql)
        sink = pa.BufferOutputStream()
        with pa.ipc.new_stream(sink, table.schema) as writer:
            writer.write_table(table)
        return sink.getvalue().to_pybytes()

    def database_folders(self, session, request):
        c = session['conn']
        action = request.get('action', 'list')
        paths = [row[0] for row in c.execute('SELECT path FROM _studio.database_folders ORDER BY path').fetchall()]
        def clean(value):
            value = str(value).strip()
            if len(value) > 240 or any(not part.strip() or part.strip() in ('.', '..') or any(ord(ch)<32 or ch=='\\' for ch in part) for part in value.split('/')):
                raise ValueError('Use folder names separated by /, without empty names, . or .. .')
            return '/'.join(part.strip() for part in value.split('/'))
        def add(path):
            parts = path.split('/')
            for i in range(1, len(parts)+1):
                prefix = '/'.join(parts[:i])
                if any(p.casefold() == prefix.casefold() and p != prefix for p in paths):
                    raise ValueError('Use the existing folder’s capitalization: folder names are unique regardless of case.')
            for i in range(1, len(parts)+1):
                c.execute('INSERT OR IGNORE INTO _studio.database_folders VALUES (?)', ['/'.join(parts[:i])])
        if action == 'create':
            path = clean(request.get('path', ''))
            if any(p.casefold() == path.casefold() for p in paths):
                raise ValueError('That Database folder already exists.')
            add(path)
        elif action == 'move':
            self.sync_definitions(c)
            name = request.get('name', '')
            obj = self.catalog_objects(c).get(name.lower())
            if not obj:
                raise ValueError('That table or view no longer exists. Refresh Database.')
            folder = request.get('folder', '')
            if folder and folder not in paths:
                raise ValueError('That folder no longer exists. Choose another folder.')
            c.execute('INSERT OR REPLACE INTO _studio.database_locations VALUES (?, ?)', [obj['name'].lower(), folder])
        elif action in ('rename', 'delete'):
            path = request.get('path')
            if path not in paths:
                raise ValueError('That folder no longer exists. Refresh Database.')
            parent = path.rpartition('/')[0]
            target = clean(request.get('target', '')) if action == 'rename' else parent
            affected = [p for p in paths if p == path or p.startswith(path + '/')]
            if action == 'rename':
                if target.startswith(path + '/'):
                    raise ValueError('A folder cannot be moved inside itself.')
                destinations = [target + p[len(path):] for p in affected]
                if any(d.casefold() == p.casefold() for d in destinations for p in paths if p not in affected):
                    raise ValueError('A destination folder already exists. Choose another name.')
            c.execute('BEGIN')
            try:
                locations = c.execute('SELECT name, folder FROM _studio.database_locations').fetchall()
                for name, folder in locations:
                    if folder in affected:
                        destination = target + folder[len(path):] if action == 'rename' else parent
                        c.execute('UPDATE _studio.database_locations SET folder=? WHERE name=?', [destination, name])
                for folder in affected:
                    c.execute('DELETE FROM _studio.database_folders WHERE path=?', [folder])
                if action == 'rename':
                    for folder in destinations:
                        add(folder)
                c.execute('COMMIT')
            except Exception:
                c.execute('ROLLBACK')
                raise
        elif action != 'list':
            raise ValueError('Unknown Database folder action.')
        objects = self.catalog_objects(c)
        locations = {name: folder for name, folder in c.execute('SELECT name, folder FROM _studio.database_locations').fetchall() if name in objects}
        return {'folders': [r[0] for r in c.execute('SELECT path FROM _studio.database_folders ORDER BY path').fetchall()], 'locations': locations}

    def duplicate_name_message(self, session, name):
        c = session['conn']
        obj = self.catalog_objects(c).get(name.lower())
        if not obj:
            return None
        row = c.execute('SELECT folder FROM _studio.database_locations WHERE name=?', [name.lower()]).fetchone()
        location = 'Database' + (' / ' + row[0].replace('/', ' / ') if row and row[0] else ' (root)')
        return f'“{obj["name"]}” already exists as a {obj["kind"]} in {location}. Names must be unique across Database folders. Choose a different name; the existing object is unchanged.'

    def create_notebook_table(self, session, request):
        c = session['conn']
        name, source, folder = request.get('name', '').strip(), request.get('source', ''), request.get('folder', '')
        if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', name):
            raise ValueError('Use a table name starting with a letter or underscore, followed by letters, numbers or underscores.')
        duplicate = self.duplicate_name_message(session, name)
        if duplicate:
            raise ValueError(duplicate)
        if folder and not c.execute('SELECT 1 FROM _studio.database_folders WHERE path=?', [folder]).fetchone():
            raise ValueError('That Database folder no longer exists. Reopen Create table and choose a folder.')
        if not c.execute("SELECT 1 FROM duckdb_tables() WHERE temporary AND schema_name='main' AND table_name=?", [source]).fetchone():
            raise ValueError('This notebook output is no longer available. Rerun the notebook before creating a table.')
        catalog = c.execute('SELECT current_database()').fetchone()[0]
        qualified = ident(catalog) + '.main.' + ident(name)
        origin = 'Snapshot of notebook “' + str(request.get('notebook', 'Untitled')) + '”, cell “' + source + '” (' + str(request.get('language', '')) + '). Created ' + datetime.now(timezone.utc).isoformat() + '. This is stored output, not an independently runnable SQL definition.'
        c.execute('BEGIN')
        try:
            c.execute(f'CREATE TABLE {qualified} AS SELECT * FROM temp.main.{ident(source)}')
            c.execute(f'COMMENT ON TABLE {qualified} IS {literal(json.dumps({"notebook": request.get("notebook"), "cell": source, "run_at": request.get("runAt")}))}')
            self.record_definition(session, name, origin=origin)
            c.execute('INSERT OR REPLACE INTO _studio.database_locations VALUES (?, ?)', [name.lower(), folder])
            count = c.execute(f'SELECT count(*) FROM {qualified}').fetchone()[0]
            c.execute('COMMIT')
        except Exception:
            c.execute('ROLLBACK')
            raise
        return {'name': name, 'rows': count, 'folder': folder}

    def catalog_objects(self, c):
        rows = c.execute("SELECT table_name, 'table', sql, comment FROM duckdb_tables() WHERE database_name=current_database() AND schema_name='main' AND NOT temporary UNION ALL SELECT view_name, 'view', sql, comment FROM duckdb_views() WHERE database_name=current_database() AND schema_name='main' AND NOT temporary AND NOT internal").fetchall()
        return {name.lower(): dict(name=name, kind=kind, signature=sql, comment=comment) for name, kind, sql, comment in rows}

    def append_definition(self, c, obj, query=None, origin=None, action='Definition updated', restored_from=None):
        key = obj['name'].lower()
        head = c.execute('SELECT generation FROM _studio.relation_heads WHERE name=?', [key]).fetchone()
        generation = head[0] if head else uuid.uuid4().hex
        version = dict(id=uuid.uuid4().hex, name=obj['name'], kind=obj['kind'], query=query,
                       origin=origin or 'SQL definition', action=action, restoredFrom=restored_from,
                       at=datetime.now(timezone.utc).isoformat())
        c.execute('INSERT INTO _studio.definition_versions VALUES (?, ?, ?)', [version['id'], generation, json.dumps(version)])
        c.execute('INSERT OR REPLACE INTO _studio.relation_heads VALUES (?, ?, ?)', [key, generation, obj['signature']])
        return version

    def sync_definitions(self, c, executed_sql=None):
        objects = self.catalog_objects(c)
        heads = {name: signature for name, signature in c.execute('SELECT name, signature FROM _studio.relation_heads').fetchall()}
        for name in heads.keys() - objects.keys():
            c.execute('DELETE FROM _studio.relation_heads WHERE name=?', [name])
            c.execute('DELETE FROM _studio.database_locations WHERE name=?', [name])
        # Capture straightforward CREATE ... AS SELECT statements executed in the SQL editor.
        executed_sql = re.sub(r'^\s*(?:(?:--[^\n]*(?:\n|$)|/\*.*?\*/)\s*)*', '', executed_sql or '', flags=re.S)
        match = re.match(r'^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW)\s+(?:main\.)?("(?:[^"]|"")+"|[A-Za-z_][\w]*)\s+AS\b[ \t]?(.+)$', executed_sql or '', re.I | re.S)
        target = match[1].strip('"').replace('""', '"').lower() if match else None
        for key, obj in objects.items():
            if key in heads and heads[key] == obj['signature'] and key != target:
                continue
            query = None
            origin = 'Original creation SQL was not recorded. This table may have been imported or created before definition history was available.'
            try:
                metadata = json.loads(obj['comment'] or '{}')
            except (ValueError, TypeError):
                metadata = {}
            if isinstance(metadata, dict) and metadata.get('minimal_data_studio_source'):
                origin = 'Imported from ' + metadata['minimal_data_studio_source'] + '. No reusable SQL definition was saved.'
            elif isinstance(metadata, dict) and metadata.get('manual_draft'):
                origin = 'Created from an editable CSV draft. Manual values are not stored in definition history.'
            if key == target and not re.search(r'__(?:result)_|_draft_|_excel_', match[2]):
                query = match[2]
            elif obj['kind'] == 'view':
                definition = re.match(r'^CREATE\s+VIEW\s+.*?\s+AS\s+(.*?);?$', obj['signature'], re.I | re.S)
                if definition:
                    query = definition[1]
            if query:
                origin = 'SQL definition'
            self.append_definition(c, obj, query, origin, 'Definition recorded' if key not in heads else 'Definition changed in SQL editor')
        return objects

    def definition_info(self, session, name):
        c = session['conn']
        objects = self.sync_definitions(c)
        obj = objects.get(name.lower())
        if not obj:
            raise ValueError('This table or view no longer exists. Refresh Database.')
        generation = c.execute('SELECT generation FROM _studio.relation_heads WHERE name=?', [name.lower()]).fetchone()[0]
        versions = [json.loads(row[0]) for row in c.execute('SELECT body FROM _studio.definition_versions WHERE generation=?', [generation]).fetchall()]
        versions.sort(key=lambda v: v['at'])
        for i, version in enumerate(versions):
            previous = next((v for v in reversed(versions[:i]) if v.get('query')), None)
            before = (previous['query'] if previous else '').splitlines()
            after = (version.get('query') or '').splitlines()
            version['diff'] = '\n'.join(difflib.unified_diff(before, after, fromfile='Previous definition', tofile='This definition', lineterm=''))
        return dict(name=obj['name'], catalog=c.execute('SELECT current_database()').fetchone()[0], kind=obj['kind'], current=versions[-1], versions=list(reversed(versions)))

    def record_definition(self, session, name, query=None, origin=None):
        obj = self.catalog_objects(session['conn']).get(name.lower())
        if not obj:
            raise ValueError('Table or view no longer exists.')
        self.append_definition(session['conn'], obj, query, origin, 'Creation source recorded')

    def apply_definition(self, session, request):
        c = session['conn']
        info = self.definition_info(session, request['name'])
        if not info['current']['query']:
            raise ValueError('This object has no saved SQL definition and cannot be replaced from the definition editor. Create a new table from a separate query instead.')
        if request.get('base') != info['current']['id']:
            raise ValueError('The definition changed in another tab. Reload this object before applying changes.')
        query, kind = request.get('query', ''), request.get('kind')
        restored = request.get('restore')
        if restored:
            version = next((v for v in info['versions'] if v['id'] == restored), None)
            if not version or not version['query']:
                raise ValueError('This version has no reusable SQL definition to restore.')
            query, kind = version['query'], version['kind']
        statements = c.extract_statements(query)
        if len(statements) != 1 or str(statements[0].type).split('.')[-1] != 'SELECT':
            raise ValueError('Enter one SELECT query (WITH is supported), without CREATE or other statements.')
        if kind not in ('table', 'view'):
            raise ValueError('Choose Table or View.')
        name = info['name']
        qualified = ident(info['catalog']) + '.main.' + ident(name)
        c.execute('BEGIN')
        try:
            if info['kind'] == kind == 'view':
                c.execute(f'CREATE OR REPLACE VIEW {qualified} AS {query}')
            else:
                # No CASCADE: dependencies must not be silently removed.
                c.execute(f'DROP {info["kind"].upper()} {qualified}')
                c.execute(f'CREATE {kind.upper()} {qualified} AS {query}')
            obj = self.catalog_objects(c)[name.lower()]
            self.append_definition(c, obj, query, action='Restored definition' if restored else 'Applied definition', restored_from=restored)
            c.execute('COMMIT')
        except Exception:
            c.execute('ROLLBACK')
            raise
        return self.definition_info(session, name)

    def mark_file_source(self, connection, name, file):
        try:
            relative = Path(file).resolve().relative_to(self.project_root).as_posix()
        except ValueError:
            return
        metadata = json.dumps({'minimal_data_studio_source': relative})
        connection.execute(f'COMMENT ON TABLE {ident(name)} IS {literal(metadata)}')

    def file_tables(self, session):
        # Table comments survive reloads and renames, and disappear on DROP.
        linked = {}
        rows = session['conn'].execute("SELECT table_name, comment FROM duckdb_tables() WHERE database_name=current_database() AND schema_name='main' AND NOT temporary").fetchall()
        for name, comment in rows:
            try:
                metadata = json.loads(comment or '{}')
                source = metadata.get('minimal_data_studio_source') if isinstance(metadata, dict) else None
                if isinstance(source, str):
                    linked.setdefault(source, []).append(name)
            except (ValueError, TypeError):
                pass
        return linked

    def import_file(self, session, filename, body):
        file = self.file(session, uuid.uuid4().hex + Path(filename).suffix.lower())
        try:
            file.write_bytes(body)
            return self.import_path(session, file, filename)
        finally:
            file.unlink(missing_ok=True)

    def plan_import(self, session, file, name=None, sheet=None, header=1, filename=None):
        file = Path(file)
        if not file.is_file():
            raise ValueError(f'File not found: {file}. Refresh Files and select its current location.')
        suffix = file.suffix.lower()
        reader = {'.csv':'read_csv_auto', '.tsv':'read_csv_auto', '.json':'read_json_auto', '.parquet':'read_parquet'}.get(suffix)
        if not reader and suffix != '.xlsx':
            raise ValueError('Import supports CSV, TSV, JSON, Parquet and XLSX files.')
        if suffix == '.xlsx' and not sheet:
            import openpyxl
            wb = openpyxl.load_workbook(file, read_only=True, data_only=True, keep_links=False)
            try:
                sheet = wb.sheetnames[0]
            finally:
                wb.close()
        stem = Path(filename or file.name).stem + ('_' + sheet if suffix == '.xlsx' else '')
        suggested = re.sub(r'\W+', '_', stem, flags=re.ASCII).lower() or 'imported_table'
        if suggested[0].isdigit():
            suggested = '_' + suggested
        name = suggested if name is None else name.strip()
        if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', name):
            raise ValueError('Use a table name starting with a letter or underscore, followed by letters, numbers or underscores.')
        exists = session['conn'].execute("SELECT 1 FROM information_schema.tables WHERE lower(table_name)=lower(?) AND table_schema='main'", [name]).fetchone() is not None
        token = uuid.uuid4().hex
        binding = '_excel_' + token if suffix == '.xlsx' else None
        options = ", delim='\\t', header=true" if suffix == '.tsv' else ''
        sql = f'CREATE TABLE {ident(name)} AS\nSELECT * FROM ' + (ident(binding) if binding else f'{reader}({literal(file)}{options})') + ';'
        plan = dict(name=name, source=str(file), sheet=sheet, header=header, binding=binding, sql=sql)
        plans = session.setdefault('import_plans', {})
        while len(plans) >= 16:
            plans.pop(next(iter(plans)))
        plans[token] = plan
        python = None
        if binding:
            python = ("from excel_files import read_excel  # Studio's openpyxl reader\n"
                      "import pyarrow as pa\n\n"
                      f"excel = read_excel({str(file)!r}, sheet={sheet!r}, header={header!r})\n"
                      "table = pa.Table.from_arrays(\n"
                      "    [pa.array([row[i] for row in excel['rows']], type=pa.string())\n"
                      "     for i in range(len(excel['columns']))],\n"
                      "    names=excel['columns'],\n"
                      ")\n"
                      f"connection.register({binding!r}, table)")
        return dict(plan=token, name=name, sql=sql, python=python, exists=exists, duplicateMessage=self.duplicate_name_message(session, name) if exists else None,
                    note=(f'Python/openpyxl reads sheet {sheet!r}, header row {header}, as text columns and registers the temporary input below. Then DuckDB executes this SQL. This temporary input exists only during import.' if binding else 'This SQL creates a new table. The source file is unchanged.'))

    def execute_import_plan(self, session, token):
        plan = session.get('import_plans', {}).get(token)
        if not plan:
            raise ValueError('Import preview expired. Change the name or reopen Import as table to refresh it.')
        c = session['conn']
        if c.execute("SELECT 1 FROM information_schema.tables WHERE lower(table_name)=lower(?) AND table_schema='main'", [plan['name']]).fetchone():
            raise ValueError(self.duplicate_name_message(session, plan['name']))
        self.sync_definitions(c)
        file = Path(plan['source'])
        if not file.is_file():
            raise ValueError(f'File not found: {file}. Refresh Files and select its current location.')
        if plan['binding']:
            from excel_files import read_excel
            excel = read_excel(file, plan['sheet'], plan['header'])
            table = pa.Table.from_arrays([pa.array([r[i] for r in excel['rows']], type=pa.string()) for i in range(len(excel['columns']))], names=excel['columns'])
            c.register(plan['binding'], table)
        try:
            c.execute(plan['sql'])
        finally:
            if plan['binding']:
                c.unregister(plan['binding'])
        self.mark_file_source(c, plan['name'], file)
        origin = 'Imported from ' + str(file.relative_to(self.project_root) if file.is_relative_to(self.project_root) else file.name)
        if plan['binding']:
            origin += f" · sheet {plan['sheet']} · header row {plan['header']} (Python/openpyxl)."
        self.record_definition(session, plan['name'], origin=origin)
        session['import_plans'].pop(token, None)
        return {'name':plan['name'], 'source':str(file)}

    def import_path(self, session, file, filename=None, sheet=None, header=1, name=None):
        plan = self.plan_import(session, file, name, sheet, header, filename)
        return self.execute_import_plan(session, plan['plan'])

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
