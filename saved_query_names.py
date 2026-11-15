"""Reject new name collisions while leaving pre-existing duplicate documents intact."""
def name_key(value):
    return str(value or '').strip().lower()


def unique_copy_name(queries, name):
    base = name + ' (copy)'
    used = {name_key(q.get('name')) for q in queries}
    candidate, suffix = base, 2
    while name_key(candidate) in used:
        candidate = f'{base} {suffix}'
        suffix += 1
    return candidate


def validate_query_names(previous, incoming):
    old = {q.get('id'): name_key(q.get('name')) for q in previous if q.get('id')}
    seen = {}
    for query in incoming:
        key = name_key(query.get('name'))
        if not key:
            continue
        for other in seen.get(key, []):
            if (query.get('id') != other.get('id') and old.get(query.get('id')) == key
                    and old.get(other.get('id')) == key):
                continue
            location = other.get('folder') or '(root)'
            raise ValueError(f'“{other.get("name")}” already exists in Saved queries / {location}. Choose a different name.')
        seen.setdefault(key, []).append(query)
