"""Persistent, isolated dataset drafts. No operation updates a source table."""
import csv
import io
import json
import re
import uuid
from datetime import datetime
from decimal import Decimal, InvalidOperation
import pyarrow as pa

MAX_ROWS, MAX_COLS, MAX_CELLS = 10000, 100, 100000
TYPES = {'text': 'VARCHAR', 'number': 'DOUBLE', 'integer': 'BIGINT', 'date': 'DATE', 'datetime': 'TIMESTAMP', 'boolean': 'BOOLEAN'}
TEMPORAL = {'date': ('YYYY-MM-DD', '%Y-%m-%d', r'\d{4}-\d{2}-\d{2}'), 'datetime': ('YYYY-MM-DD HH:MM:SS or YYYY-MM-DDTHH:MM:SS', '%Y-%m-%d %H:%M:%S', r'\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}')}

def quote(s):
    return '"' + s.replace('"', '""') + '"'

def parse(raw):
    if not isinstance(raw, str) or len(raw.encode()) > 8_000_000:
        raise ValueError('Drafts support up to 8 MB of CSV text.')
    try:
        records = list(csv.reader(io.StringIO(raw, newline=''), strict=True))
    except csv.Error as e:
        raise ValueError('CSV structure: ' + str(e) + '. Check quotes around values.') from e
    if not records or not records[0]:
        raise ValueError('Add a header row with column names.')
    cols, rows = records[0], records[1:]
    if len(cols) > MAX_COLS or len(rows) > MAX_ROWS or len(cols)*len(rows) > MAX_CELLS:
        raise ValueError('Editable drafts support up to 10,000 rows, 100 columns and 100,000 cells. Narrow the query before copying it; no rows were discarded.')
    if any(not c.strip() for c in cols) or len(set(c.casefold() for c in cols)) != len(cols):
        raise ValueError('Column names must be nonempty and unique (ignoring capitalization).')
    for i, row in enumerate(rows, 1):
        if len(row) != len(cols):
            raise ValueError(f'CSV data row {i} has {len(row)} values; the header has {len(cols)}. Check commas and quotes.')
    return cols, rows

def check(c, draft, name='new_table'):
    cols, rows = parse(draft.get('raw', ''))
    settings = draft.get('types', {})
    issues, total, counts, expressions = [], 0, {}, []
    missing = draft.get('blanksMissing', True)
    for j, col in enumerate(cols):
        setting = settings.get(col, {})
        kind = setting.get('kind', 'text')
        if kind not in TYPES:
            raise ValueError('Choose a supported column type.')
        value = f'NULLIF({quote(col)}, \'\')' if missing else quote(col)
        temporal_value = f"replace({value}, 'T', ' ')" if kind == 'datetime' else value
        expression = f"CAST(strptime({temporal_value}, '{TEMPORAL[kind][1]}') AS {TYPES[kind]})" if kind in TEMPORAL else f'CAST({value} AS {TYPES[kind]})'
        expressions.append(expression + ' AS ' + quote(col))
        for i, row in enumerate(rows):
            v = row[j]
            if missing and v == '':
                continue
            problem = None
            if kind == 'integer':
                if not re.fullmatch(r'[+-]?\d+', v):
                    problem = ('Expected a whole number', 'Correct the value, choose Number for decimals, or keep it as Text.')
                else:
                    try:
                        if not -(2**63) <= int(v) < 2**63:
                            problem = ('Whole number is too large', 'Keep this identifier as Text to preserve every digit.')
                    except ValueError:
                        problem = ('Whole number is too large', 'Keep this value as Text.')
            elif kind == 'number':
                try:
                    d = Decimal(v)
                    if not re.fullmatch(r'[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?', v) or not d.is_finite() or abs(d) > Decimal('1.7976931348623157e308'):
                        raise InvalidOperation
                except InvalidOperation:
                    problem = ('Expected a number', 'Use a decimal point without currency symbols or grouping commas, or keep it as Text.')
            elif kind == 'boolean' and v.lower() not in ('true', 'false'):
                problem = ('Expected true or false', 'Enter true or false, mark the value missing, or keep it as Text.')
            elif kind in TEMPORAL:
                fmt, parser_format, pattern = TEMPORAL[kind]
                try:
                    if not re.fullmatch(pattern, v):
                        raise ValueError
                    datetime.strptime(v.replace('T', ' ') if kind == 'datetime' else v, parser_format)
                except ValueError:
                    problem = (('DateTime' if kind == 'datetime' else 'Date') + ' must use ' + fmt, 'Use a valid calendar date' + (' and a 24-hour time, including seconds. Examples: 2026-12-31 14:30:00 or 2026-12-31T14:30:00. Either separator can be used in the same column. Time zones are not included.' if kind == 'datetime' else '. Example: 2026-12-31. Other date formats are not accepted.'))
            if problem:
                total += 1
                counts[str(j)] = counts.get(str(j), 0) + 1
                if len(issues) < 500:
                    diagnostic = f"SELECT CAST(? AS {TYPES[kind]});"
                    params = [v]
                    if kind in TEMPORAL:
                        input_sql = "replace(?, 'T', ' ')" if kind == 'datetime' else '?'
                        diagnostic = f'SELECT CAST(strptime({input_sql}, ?) AS {TYPES[kind]});' 
                        params.append(TEMPORAL[kind][1])
                    try:
                        converted = c.execute(diagnostic, params).fetchone()[0]
                        technical = f'DuckDB would interpret this as {converted!s}. Studio requires the explicit format above to avoid unintended conversion.'
                    except Exception as e:
                        technical = str(e)
                    issues.append(dict(row=i, col=j, title=problem[0], solution=problem[1], value=v, technical=technical, sql=diagnostic, parameters=params))
    sql = f'CREATE TABLE {quote(name)} AS\nSELECT\n  ' + ',\n  '.join(expressions) + '\nFROM "_draft_input";'
    return dict(columns=cols, rows=rows, issues=issues, issueCount=total, columnCounts=counts, sql=sql)

def handle(workspace, session, action, req):
    c = session['conn']
    c.execute('CREATE TABLE IF NOT EXISTS _studio.drafts (id VARCHAR PRIMARY KEY, revision BIGINT, body VARCHAR)')
    if action == 'list':
        return {'drafts': [dict(json.loads(body), revision=revision) for revision,body in c.execute('SELECT revision,body FROM _studio.drafts ORDER BY id').fetchall()]}
    if action == 'delete':
        key = req.get('id', '')
        if not isinstance(key, str) or not re.fullmatch(r'[a-f0-9-]{36}', key):
            raise ValueError('Invalid draft identifier.')
        previous = c.execute('SELECT revision FROM _studio.drafts WHERE id=?', [key]).fetchone()
        if not previous:
            return {'deleted': key}
        if req.get('revision') != previous[0]:
            raise ValueError('This draft changed in another window. Reload before deleting it.')
        c.execute('DELETE FROM _studio.drafts WHERE id=? AND revision=?', [key, previous[0]])
        return {'deleted': key}
    if action == 'save':
        draft = req['draft']
        key = draft.get('id', '')
        if not re.fullmatch(r'[a-f0-9-]{36}', key):
            raise ValueError('Invalid draft identifier.')
        raw = draft.get('raw', '')
        if not isinstance(raw, str) or len(raw.encode()) > 8_000_000:
            raise ValueError('Drafts support up to 8 MB of CSV text.')
        previous = c.execute('SELECT revision FROM _studio.drafts WHERE id=?', [key]).fetchone()
        revision = previous[0] if previous else 0
        if draft.get('revision', 0) != revision:
            raise ValueError('This draft changed in another window. Copy your CSV text before reloading to avoid losing your edits.')
        clean = {k: draft.get(k) for k in ('id','name','raw','types','blanksMissing','source','history')}
        clean['history'] = (clean['history'] or [])[-200:]
        body = json.dumps(clean)
        c.execute('INSERT INTO _studio.drafts VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,body=excluded.body', [key,revision+1,body])
        return {'revision': revision+1}
    draft = req['draft']
    if action == 'parse':
        cols, rows = parse(draft.get('raw', ''))
        return {'columns': cols, 'rows': rows}
    if action == 'check':
        return check(c, draft)
    if action == 'csv':
        parse(draft.get('raw', ''))
        name = req.get('name', '')
        if not re.fullmatch(r'[A-Za-z0-9_-]+\.csv', name):
            raise ValueError('The filename must end in .csv (for example, my_dataset.csv). Before .csv, use only letters, numbers, underscores or hyphens; no spaces.')
        exports = workspace.project_root / 'exports'
        exports.mkdir(exist_ok=True)
        if workspace.project_root.resolve() not in exports.resolve().parents:
            raise ValueError('The exports folder must be inside this project.')
        path = exports / name
        try:
            with path.open('x', newline='') as f:
                f.write(draft['raw'])
        except FileExistsError:
            raise ValueError('That CSV already exists. Choose another filename; nothing was overwritten.')
        return {'path': 'exports/' + name}
    if action == 'create':
        name = req.get('name', '')
        if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', name):
            raise ValueError('Use a table name starting with a letter or underscore, followed by letters, numbers or underscores.')
        if c.execute("SELECT 1 FROM information_schema.tables WHERE table_schema='main' AND lower(table_name)=lower(?)", [name]).fetchone():
            raise ValueError(workspace.duplicate_name_message(session, name))
        workspace.sync_definitions(c)
        result = check(c, draft, name)
        if result['issueCount']:
            raise ValueError(f"Resolve {result['issueCount']} issues before creating a table.")
        table = pa.Table.from_arrays([pa.array([r[j] for r in result['rows']], type=pa.string()) for j in range(len(result['columns']))], names=result['columns'])
        binding = '_draft_' + uuid.uuid4().hex
        c.register(binding, table)
        sql = result['sql'].replace('FROM "_draft_input";', 'FROM ' + quote(binding) + ';')
        try:
            c.execute('BEGIN')
            c.execute(sql)
            metadata = json.dumps({'manual_draft':draft.get('id'), 'source':draft.get('source'), 'history':draft.get('history', [])[-200:]})
            c.execute('COMMENT ON TABLE ' + quote(name) + " IS '" + metadata.replace("'", "''") + "'")
            workspace.record_definition(session, name, origin='Created from editable CSV draft “' + draft.get('name', 'Untitled') + '”. Manual values are not stored in definition history.')
            c.execute('COMMIT')
        except Exception:
            c.execute('ROLLBACK')
            raise
        finally:
            c.unregister(binding)
        return {'name':name}
    raise ValueError('Unknown draft action.')
