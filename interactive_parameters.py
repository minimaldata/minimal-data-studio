"""Typed scalar values for DuckDB named parameters; never SQL interpolation."""
import datetime
import math
import re


def parameter_values(specs, values=None):
    if not isinstance(specs, dict) or len(specs) > 20:
        raise ValueError('Use at most 20 app parameters.')
    if values is None: values = {}
    if not isinstance(values, dict) or set(values) - set(specs):
        raise ValueError('Unknown app parameter.')
    result = {}
    for name, spec in specs.items():
        if not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{0,63}', name) or not isinstance(spec, dict):
            raise ValueError('Invalid parameter declaration.')
        kind = spec.get('type')
        if kind not in ('string', 'number', 'date', 'boolean') or not isinstance(spec.get('label', name), str):
            raise ValueError('Parameters require a scalar type and text label.')
        value = values.get(name, spec.get('default'))
        if kind == 'string' and (not isinstance(value, str) or len(value) > 1000):
            raise ValueError(name + ': enter text of at most 1,000 characters.')
        if kind == 'number' and (isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)):
            raise ValueError(name + ': enter a finite number.')
        if kind == 'boolean' and not isinstance(value, bool):
            raise ValueError(name + ': choose true or false.')
        if kind == 'date':
            try:
                if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value): raise ValueError()
                datetime.date.fromisoformat(value)
            except ValueError: raise ValueError(name + ': enter a valid YYYY-MM-DD date.')
        result[name] = value
    return result
