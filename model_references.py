"""Small SQL-aware reference compiler. This is not a template execution engine.
Only {{ reference_key }} and {{ @model_id }} expand; quoted SQL and comments do not.
"""
import re


def reference_tokens(sql, tolerant=False):
    tokens = []
    i = 0
    while i < len(sql):
        if sql.startswith('--', i) or sql[i] == '#':
            end = sql.find('\n', i)
            i = len(sql) if end < 0 else end + 1
        elif sql.startswith('/*', i):
            end = sql.find('*/', i + 2)
            i = len(sql) if end < 0 else end + 2
        elif sql[i] in "'\"`":
            quote = sql[i]
            delimiter = quote * 3 if quote != '`' and sql.startswith(quote * 3, i) else quote
            i += len(delimiter)
            while i < len(sql):
                if sql[i] == '\\':
                    i += 2
                elif sql.startswith(delimiter, i):
                    i += len(delimiter)
                    if len(delimiter) == 1 and sql.startswith(delimiter, i):
                        i += 1
                        continue
                    break
                else:
                    i += 1
        elif sql.startswith('{{', i):
            end = sql.find('}}', i + 2)
            key = sql[i + 2:end].strip() if end >= 0 else ''
            if end < 0 or not re.fullmatch(r'(?:[A-Za-z_][A-Za-z0-9_]*|@[a-f0-9]{32})', key):
                if not tolerant:
                    raise ValueError('Invalid model reference. Use {{ reference_key }} and close it with }}.')
                i = len(sql) if end < 0 else end + 2
                continue
            tokens.append((i, end + 2, key))
            i = end + 2
        elif sql.startswith('}}', i):
            if not tolerant:
                raise ValueError('Unexpected }}. Model references start with {{.')
            i += 2
        else:
            i += 1
    return tokens


def bind_references(sql, connection, models, previous=None, tolerant=False):
    """Retain bindings for removed tokens too, so history restore cannot retarget a name."""
    bindings = dict(previous or {})
    for _, _, key in reference_tokens(sql, tolerant):
        if key in bindings:
            continue
        found = [m for m in models if m['draft']['connection'] == connection and
                 (m['id'] == key[1:] if key.startswith('@') else m['reference'] == key)]
        if len(found) == 1:
            bindings[key] = found[0]['id']
        elif not tolerant:
            raise ValueError('Unknown model reference {{ ' + key + ' }}. Choose a model from autocomplete in this connection.')
    return bindings


def compile_model(sql, connection, models, owner=None, previous=None):
    by_id = {m['id']: m for m in models}
    bindings = bind_references(sql, connection, models, previous)
    tokens = reference_tokens(sql)
    direct_ids = list(dict.fromkeys(bindings[key] for _, _, key in tokens))
    visited, stack = set(), []

    phase = 'draft'

    def dependencies(model):
        draft = model.get(phase) or model['draft']
        if model['id'] == owner:
            return direct_ids
        refs = bind_references(draft['sql'], draft['connection'], models, draft.get('references'), tolerant=True)
        return list(dict.fromkeys(refs[key] for _, _, key in reference_tokens(draft['sql'], True) if key in refs))

    def visit(key):
        if key in stack:
            names = [by_id[k]['reference'] for k in stack[stack.index(key):] + [key]]
            raise ValueError('Circular model dependency: ' + ' → '.join(names))
        if key in visited:
            return
        model = by_id.get(key)
        if model is None:
            raise ValueError('A referenced model no longer exists. Replace its reference explicitly.')
        if model['draft']['connection'] != connection:
            raise ValueError('Model references must use the same BigQuery connection.')
        stack.append(key)
        for dep in dependencies(model):
            visit(dep)
        stack.pop()
        visited.add(key)

    # Check both the editable graph and the graph that would actually be live.
    # An upstream draft may remove an edge that still exists in its published view.
    for phase in ('draft', 'published'):
        visited.clear()
        if owner:
            visit(owner)
        else:
            for key in direct_ids:
                visit(key)
    details = []
    for key in direct_ids:
        m = by_id[key]
        if m.get('pending'):
            raise ValueError('Check the pending publication of ' + m['reference'] + ' first.')
        published = m.get('published')
        if not published:
            raise ValueError('Publish ' + m['reference'] + ' first. References use published outputs, not draft SQL.')
        details.append({'id': key, 'reference': m['reference'], 'name': m['draft']['name'],
                        'destination': published['destination'], 'kind': published['kind'],
                        'jobId': published['jobId'], 'etag': published['etag']})
    targets = {d['id']: d['destination'] for d in details}
    pieces, cursor = [], 0
    for start, end, key in tokens:
        destination = targets[bindings[key]]
        if not re.fullmatch(r'[a-z][a-z0-9-]*\.[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*', destination):
            raise ValueError('Invalid stored warehouse destination for a referenced model.')
        pieces.extend((sql[cursor:start], '`' + destination + '`'))
        cursor = end
    pieces.append(sql[cursor:])
    return {'compiledSql': ''.join(pieces), 'references': bindings, 'dependencies': details}


def dependents(model_id, models):
    output = []
    for m in models:
        for phase in ('draft', 'published'):
            definition = m.get(phase)
            if not definition:
                continue
            refs = bind_references(definition['sql'], definition['connection'], models, definition.get('references'), True)
            if any(refs.get(key) == model_id for _, _, key in reference_tokens(definition['sql'], True)):
                output.append({'id': m['id'], 'name': m['draft']['name'], 'reference': m['reference'], 'phase': phase})
    return output
