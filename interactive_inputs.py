"""Explicit, bounded local data snapshots for interactive apps; never invoked by a frame."""
import datetime
import decimal
import hashlib
import json
import math
import re
from pathlib import Path

MAX_ROWS = 10_000
MAX_BYTES = 1_000_000


def validate_bindings(bindings):
    if not isinstance(bindings, list) or len(bindings) > 20:
        raise ValueError('Use at most 20 named data inputs.')
    names = set()
    for binding in bindings:
        if not isinstance(binding, dict) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{0,63}', binding.get('name', '')):
            raise ValueError('Input names must start with a letter and contain letters, numbers or underscores.')
        if binding['name'] in names:
            raise ValueError('Input names must be unique.')
        names.add(binding['name'])
        if binding.get('kind') not in ('table', 'view', 'query') or not isinstance(binding.get('source'), str) or not binding['source']:
            raise ValueError('Choose a table, view or saved local SQL query.')
    return bindings


def validate_contract(contract):
    if not isinstance(contract, dict) or len(contract) > 20:
        raise ValueError('app.json inputs must be an object with at most 20 entries.')
    for name, spec in contract.items():
        if not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{0,63}', name) or not isinstance(spec, dict):
            raise ValueError('Invalid app.json input declaration.')
        if not isinstance(spec.get('label', name), str) or not isinstance(spec.get('required', False), bool):
            raise ValueError('Input labels must be text and required must be true or false.')
        columns = spec.get('columns', {})
        if not isinstance(columns, dict) or len(columns) > 100 or any(not key or value not in ('date', 'number', 'string', 'boolean') for key, value in columns.items()):
            raise ValueError('Input columns must declare date, number, string or boolean types.')
    return contract


def validate_columns(name, spec, columns, types):
    actual = dict(zip(columns, types))
    for column, expected in spec.get('columns', {}).items():
        label = spec.get('label', name)
        if column not in actual:
            raise ValueError(label + ': missing column ' + column + '. Choose another source or alias it in a saved query.')
        kind = actual[column].upper()
        matches = {'date': kind == 'DATE' or kind.startswith('TIMESTAMP'),
                   'number': bool(re.fullmatch(r'(U?TINYINT|U?SMALLINT|U?INTEGER|U?BIGINT|U?HUGEINT|FLOAT|DOUBLE|DECIMAL\(.*\))', kind)),
                   'string': kind == 'VARCHAR', 'boolean': kind == 'BOOLEAN'}
        if not matches[expected]:
            raise ValueError(label + ': ' + column + ' must be ' + expected + ', but the source has ' + kind + '. Cast it in a saved query.')


def saved_queries(project):
    file = Path(project) / 'saved_queries.json'
    return json.loads(file.read_text()).get('queries', []) if file.exists() else []


def catalog(workspace, project):
    with workspace.lock:
        relations = [{'kind': x['kind'], 'source': x['name'], 'label': x['name']} for x in workspace.catalog_objects(workspace.connection).values()]
    queries = [{'kind': 'query', 'source': q['id'], 'label': q['name']} for q in saved_queries(project)
               if q.get('lang', 'sql') == 'sql' and not q.get('connection')]
    return {'sources': sorted(relations + queries, key=lambda x: (x['kind'], x['label']))}


def json_value(value):
    if isinstance(value, (datetime.date, datetime.datetime, datetime.time)):
        return value.isoformat()
    if isinstance(value, decimal.Decimal):
        return str(value)  # Preserve precision; apps opt into numeric conversion.
    if isinstance(value, int) and not isinstance(value, bool) and abs(value) > 9007199254740991:
        return str(value)
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, dict):
        return {str(k): json_value(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_value(v) for v in value]
    if value is None or isinstance(value, (str, bool, float, int)):
        return value
    raise ValueError('This input contains an unsupported value type. Select or cast the needed columns in a saved SQL query.')


def refresh(workspace, project, bindings, folder=None, preview=None, parameters=None):
    bindings = validate_bindings(bindings or [])
    contract = {}
    files = {}
    from interactive_parameters import parameter_values
    values = parameter_values({}, parameters) if folder is None else {}
    if folder is not None:
        from interactive_documents import app_folder
        app = app_folder(project, folder)
        contract, files = app['inputs'], app['files']
        values = parameter_values(app['parameters'], parameters)
        automatic = {name: spec for name, spec in contract.items() if 'sql' in spec}
        bindings = [b for b in bindings if b['name'] not in automatic] + [
            dict(name=name, kind='app-sql', source=spec['sql']) for name, spec in automatic.items()]
    if preview is not None:
        if not isinstance(preview, dict) or not isinstance(preview.get('content'), str) or len(preview['content'].encode()) > 500_000:
            raise ValueError('SQL preview must be text under 500 KB.')
        name = preview.get('name')
        if not isinstance(name, str) or name not in contract or 'sql' not in contract[name]:
            raise ValueError('Choose a declared SQL input.')
        bindings = [b for b in bindings if b['name'] == name]
        files[contract[name]['sql']] = preview['content']
        contract = {name: contract[name]}
    names = {b['name'] for b in bindings}
    for name, spec in contract.items():
        if spec.get('required') and name not in names:
            raise ValueError('Choose a source for ' + spec.get('label', name) + '.')
    queries = {q['id']: q for q in saved_queries(project)}
    inputs, metadata = {}, {}
    refreshed = datetime.datetime.now(datetime.timezone.utc).isoformat()
    from interactive_query import input_cursor
    with input_cursor(workspace) as c:
        c.execute('BEGIN TRANSACTION READ ONLY')
        relations = workspace.catalog_objects(c)
        for binding in bindings:
            kind, source, name = binding['kind'], binding['source'], binding['name']
            if kind == 'app-sql':
                sql, label = files[source], contract[name].get('label', name)
            elif kind == 'query':
                q = queries.get(source)
                if not q or q.get('lang', 'sql') != 'sql' or q.get('connection'):
                    raise ValueError('Saved local SQL query is unavailable: ' + source)
                sql, label = q['sql'], q['name']
            else:
                relation = relations.get(source.lower())
                if not relation or relation['kind'] != kind:
                    raise ValueError('Source is unavailable or changed type: ' + source)
                sql, label = 'SELECT * FROM main."' + relation['name'].replace('"', '""') + '"', relation['name']
            statements = c.extract_statements(sql)
            if len(statements) != 1 or str(statements[0].type).split('.')[-1] != 'SELECT':
                raise ValueError('Data inputs require one read-only SELECT query.')
            required = statements[0].named_parameters
            if required and (kind != 'app-sql' or not set(required).issubset(values)):
                raise ValueError('SQL references an undeclared app parameter.')
            used = {key: values[key] for key in required}
            c.execute(sql, used) if used else c.execute(sql)
            columns = [d[0] for d in c.description]
            types = [str(d[1]) for d in c.description]
            if len(columns) != len(set(columns)):
                raise ValueError('Input columns need unique names. Add aliases in the saved query.')
            if name in contract:
                validate_columns(name, contract[name], columns, types)
            rows = c.fetchmany(MAX_ROWS + 1)
            if len(rows) > MAX_ROWS:
                raise ValueError(label + ' exceeds 10,000 rows. Use a filtered or aggregated saved query; no partial snapshot was applied.')
            records = [dict(zip(columns, map(json_value, row))) for row in rows]
            inputs[name] = records
            body = json.dumps({'columns': columns, 'types': types, 'rows': records}, sort_keys=True, allow_nan=False)
            metadata[name] = dict(kind=kind, source=source, label=label, rows=len(rows), columns=columns,
                                  types=types, refreshedAt=refreshed, parameters=used,
                                  contentHash=hashlib.sha256(body.encode()).hexdigest(),
                                  queryHash=hashlib.sha256(sql.encode()).hexdigest())
            if len(json.dumps(inputs).encode()) > MAX_BYTES:
                raise ValueError('Inputs exceed the 1 MB snapshot limit. Use a smaller saved query; nothing was applied.')
        return {'inputs': inputs, 'metadata': metadata}


def create_result_table(workspace, request):
    """Create a new main-schema table from explicitly confirmed app result rows."""
    name, columns, rows = request.get('name'), request.get('columns'), request.get('rows')
    folder = request.get('folder', '')
    if not isinstance(folder, str): raise ValueError('Choose a Database folder.')
    if not isinstance(name, str) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{0,62}', name):
        raise ValueError('Use a table name starting with a letter, with letters, numbers or underscores (up to 63 characters).')
    if not isinstance(columns, list) or not 1 <= len(columns) <= 50 or not isinstance(rows, list) or not 1 <= len(rows) <= MAX_ROWS:
        raise ValueError('Provide 1–50 columns and 1–10,000 result rows.')
    types = {'string':'VARCHAR', 'number':'DOUBLE', 'date':'DATE', 'timestamp':'TIMESTAMP', 'boolean':'BOOLEAN'}
    names = set()
    for col in columns:
        if not isinstance(col, dict) or not isinstance(col.get('name'), str) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{0,62}', col['name']) or col.get('type') not in types:
            raise ValueError('Invalid result column name or type.')
        if col['name'].lower() in names: raise ValueError('Result columns need unique names.')
        names.add(col['name'].lower())
    keys = [col['name'] for col in columns]
    if any(not isinstance(row, dict) or set(row) != set(keys) for row in rows):
        raise ValueError('Every result row must match the declared columns.')
    if len(json.dumps(rows, allow_nan=False).encode()) > MAX_BYTES:
        raise ValueError('Result rows exceed the 1 MB limit.')
    for row in rows:
        for col in columns:
            value = row[col['name']]
            if value is None: continue
            kind = col['type']
            if kind == 'number' and (isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)):
                raise ValueError('Result numeric values must be finite numbers.')
            if kind == 'boolean' and not isinstance(value, bool): raise ValueError('Invalid boolean result.')
            if kind in ('string','date','timestamp') and not isinstance(value, str): raise ValueError('Invalid text or date result.')
    from workspace_db import ident
    with workspace.lock:
        c = workspace.connection.cursor()
        try:
            c.execute('BEGIN TRANSACTION')
            if name.lower() in workspace.catalog_objects(c):
                raise ValueError('A table or view named ' + name + ' already exists. Choose another name; nothing was overwritten.')
            if folder and not c.execute('SELECT 1 FROM _studio.database_folders WHERE path=?', [folder]).fetchone():
                raise ValueError('That Database folder no longer exists. Choose another folder.')
            definition = ', '.join(ident(col['name'])+' '+types[col['type']] for col in columns)
            c.execute('CREATE TABLE main.'+ident(name)+' ('+definition+')')
            c.executemany('INSERT INTO main.'+ident(name)+' VALUES ('+','.join('?' for _ in keys)+')', [[row[key] for key in keys] for row in rows])
            c.execute('INSERT INTO _studio.database_locations VALUES (?, ?)', [name.lower(), folder])
            c.execute('COMMIT')
            return {'name': name, 'rows': len(rows)}
        except Exception:
            c.execute('ROLLBACK')
            raise
        finally: c.close()
