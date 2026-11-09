"""Read-only XLSX ingestion. Text columns preserve mixed cell values without guessing."""
from datetime import date, datetime, time
from itertools import zip_longest
import openpyxl


def cell_text(value):
    if value is None:
        return None
    if isinstance(value, (date, datetime, time)):
        return value.isoformat()
    return str(value)


def read_excel(path, sheet=None, header=1, limit=None, reject_errors=True):
    try:
        header = int(header)
    except (TypeError, ValueError):
        raise ValueError('Header row must be a whole number.')
    if not 1 <= header <= 1048576:
        raise ValueError('Header row must be between 1 and 1048576.')
    values = openpyxl.load_workbook(path, read_only=True, data_only=True, keep_links=False)
    formulas = None
    try:
        formulas = openpyxl.load_workbook(path, read_only=True, data_only=False, keep_links=False)
        sheet = sheet or values.sheetnames[0]
        if sheet not in values.sheetnames:
            raise ValueError('Choose a sheet from this workbook.')
        ws, fs = values[sheet], formulas[sheet]
        # Sheet dimensions can be stale or include formatting-only cells.
        ws.reset_dimensions(); fs.reset_dimensions()
        vr = ws.iter_rows(min_row=header)
        fr = fs.iter_rows(min_row=header)
        first = next(vr, ())
        first_formula = next(fr, ())
        def populated_width(cells):
            return max((i+1 for i,c in enumerate(cells) if c.value is not None), default=0)
        width = max(populated_width(first), populated_width(first_formula))
        if not width:
            raise ValueError('This header row is blank. Choose the row containing column names.')
        rows, row_numbers = [], []
        missing = [c.coordinate for i,c in enumerate(first_formula) if c.data_type == 'f' and (i >= len(first) or first[i].value is None)]
        errors = [c.coordinate for c in first if c.data_type == 'e']
        total = 0
        for rownum, (rv, rf) in enumerate(zip_longest(vr, fr, fillvalue=()), header+1):
            row_width = max(populated_width(rv), populated_width(rf))
            if not row_width:
                continue
            width = max(width, row_width)
            total += 1
            if width > 512 or total > 250000 or total * width > 2000000:
                raise ValueError('This sheet exceeds the viewer/import limit: 512 columns, 250,000 rows or 2 million cells. No data was imported. Split the sheet into smaller files.')
            for i, c in enumerate(rf):
                if c.data_type == 'f' and (i >= len(rv) or rv[i].value is None):
                    missing.append(c.coordinate)
                if c.data_type == 'e' or (i < len(rv) and rv[i].data_type == 'e'):
                    errors.append(c.coordinate)
            if limit is None or len(rows) < limit:
                rows.append([cell_text(rv[i].value) if i < len(rv) else None for i in range(row_width)])
                row_numbers.append(rownum)
        if width > 512:
            raise ValueError('This sheet exceeds the 512-column viewer/import limit.')
        names, used, renamed = [], set(), []
        for i in range(width):
            original = cell_text(first[i].value) if i < len(first) else None
            base = original if original not in (None, '') else f'column_{i+1}'
            name, n = base, 2
            while name.casefold() in used:
                name = f'{base}_{n}'; n += 1
            used.add(name.casefold()); names.append(name)
            if name != original:
                renamed.append(f'Column {i+1} → {name}')
        for row in rows:
            row.extend([None] * (width-len(row)))
        limited = total > len(rows)
        warnings = ['Read-only. Formulas use saved Excel results; Studio does not recalculate them.',
                    'Columns import as text. Dates use ISO format; Excel display formatting is not imported. Blank rows are skipped.']
        if renamed:
            warnings.append('Adjusted headers: ' + '; '.join(renamed))
        if missing:
            warnings.append('Formula results missing at ' + ', '.join(missing[:10]) + '. Recalculate and save the workbook in Excel or another spreadsheet app before importing.')
        if errors:
            warnings.append('Spreadsheet errors at ' + ', '.join(errors[:10]) + '. Resolve these before importing.')
        if reject_errors and limit is None and (missing or errors):
            raise ValueError('\n'.join(warnings[-(bool(missing)+bool(errors)):]))
        return dict(sheets=values.sheetnames, sheet=sheet, header=header, columns=names, rows=rows,
                    limited=limited, total=total, rowNumbers=row_numbers, checkedAll=True, warnings=warnings, missingFormulaResults=len(missing), cellErrors=len(errors))
    finally:
        values.close()
        if formulas is not None:
            formulas.close()
