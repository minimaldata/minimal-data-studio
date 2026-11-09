"""Project-scoped file navigation and atomic, non-overwriting file copies."""
import os
import csv
import json
import io
import codecs
from pathlib import Path
import tempfile

MANAGED = {'.studio', 'saved_queries.json', 'backups'}

class ProjectFiles:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        for name in ('data', 'exports', '.studio'):
            (self.root / name).mkdir(exist_ok=True)

        self.ensure_project_file()
        self.ensure_agent_guides()

    def ensure_agent_guides(self):
        """Seed portable agent guidance without replacing project-owned instructions."""
        templates = Path(__file__).resolve().parent / 'project-guides'
        for name in ('AGENTS.md', 'STUDIO_SAVED_WORK.md'):
            destination = self.root / name
            content = (templates / name).read_text(encoding='utf-8')
            # Do not follow or replace an existing file, directory, or symlink.
            try:
                with destination.open('x', encoding='utf-8') as stream:
                    stream.write(content)
            except FileExistsError:
                pass

    def ensure_project_file(self):
        # A marker travels with the folder: never store an absolute path or localhost URL.
        for marker in self.root.glob('*.mdsproject'):
            try:
                if marker.is_symlink() or marker.stat().st_size > 4096:
                    continue
                data = json.loads(marker.read_text())
                if isinstance(data, dict) and data.get('format') == 'minimal-data-studio-project' and data.get('version') == 1:
                    return marker
            except (OSError, ValueError):
                continue
        name = 'Open Project'
        index = 1
        while True:
            marker = self.root / (name + (f' {index}' if index > 1 else '') + '.mdsproject')
            try:
                with marker.open('x') as file:
                    json.dump({'format': 'minimal-data-studio-project', 'version': 1}, file, indent=2)
                    file.write('\n')
                return marker
            except FileExistsError:
                index += 1

    def resolve(self, relative):
        p = Path(relative or '.')
        if p.is_absolute() or any(part.startswith('.') or part in MANAGED for part in p.parts if part != '.'):
            raise ValueError('Outside this project or managed by the app. Bring an outside file into the project first.')
        target = (self.root / p).resolve()
        if target != self.root and self.root not in target.parents:
            raise ValueError('Outside this project. Bring the file into the project first.')
        # Also reject aliases to protected files through symlinks.
        if any(part.startswith('.') or part in MANAGED for part in target.relative_to(self.root).parts):
            raise ValueError('This file is managed by the app.')
        return target

    def describe(self, path):
        return {'name': path.name, 'relative': path.relative_to(self.root).as_posix(), 'full': str(path), 'directory': path.is_dir()}

    def listing(self, relative=''):
        directory = self.resolve(relative)
        if not directory.exists():
            raise ValueError(f'Folder not found: {directory}. It may have been moved or renamed. Refresh Files or open the project at its current location.')
        if not directory.is_dir():
            raise ValueError('Choose a project folder.')
        entries = []
        for p in sorted(directory.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
            if p.name.startswith('.') or p.name in MANAGED:
                continue
            try:
                self.resolve(p.relative_to(self.root).as_posix())
                entries.append(self.describe(p))
            except ValueError:
                entries.append({**self.describe(p), 'outside': True})
        return {'root': str(self.root), 'relative': directory.relative_to(self.root).as_posix(), 'full': str(directory), 'entries': entries}

    def bring(self, filename, body):
        if not filename or filename in ('.', '..') or '/' in filename or '\\' in filename or filename.startswith('.') or any(ord(c) < 32 for c in filename):
            raise ValueError('Choose a file with a regular file name.')
        folder = self.resolve('data')
        name = Path(filename)
        fd, temporary = tempfile.mkstemp(dir=self.root / '.studio', prefix='incoming-')
        try:
            with os.fdopen(fd, 'wb') as f:
                f.write(body)
                f.flush()
                os.fsync(f.fileno())
            n = 1
            while True:
                destination = folder / (filename if n == 1 else f'{name.stem}_{n}{name.suffix}')
                try:
                    os.link(temporary, destination)
                    return self.describe(destination)
                except FileExistsError:
                    n += 1
        finally:
            os.unlink(temporary)

    def excel_csv(self, relative, sheet, header, name):
        from excel_files import read_excel
        source = self.resolve(relative)
        if source.suffix.lower() != '.xlsx':
            raise ValueError('Choose an Excel workbook.')
        if not isinstance(name, str) or not name.lower().endswith('.csv') or name.startswith('.') or any(c in name for c in '/\\') or any(ord(c) < 32 for c in name):
            raise ValueError('Choose a CSV filename without folder separators.')
        data = read_excel(source, sheet, header)
        destination = self.resolve('exports') / name
        fd, temporary = tempfile.mkstemp(dir=self.root / '.studio', prefix='excel-csv-')
        try:
            with os.fdopen(fd, 'w', encoding='utf-8', newline='') as stream:
                writer = csv.writer(stream)
                writer.writerow(data['columns'])
                writer.writerows(data['rows'])
                stream.flush()
                os.fsync(stream.fileno())
            try:
                os.link(temporary, destination)
            except FileExistsError:
                raise ValueError('That CSV already exists. Choose another filename; nothing was overwritten.')
        finally:
            os.unlink(temporary)
        return self.describe(destination)

    def preview(self, relative, sheet=None, header=1):
        file = self.resolve(relative)
        if not file.exists():
            raise ValueError(f'File not found: {file}. It may have been moved or renamed. Refresh Files and choose its current location.')
        if not file.is_file():
            raise ValueError('Choose a project file.')
        kind = file.suffix.lower().lstrip('.')
        result = {**self.describe(file), 'kind': kind, 'size': file.stat().st_size}
        if kind == 'xlsx':
            from excel_files import read_excel
            try:
                result.update(read_excel(file, sheet, header, reject_errors=False))
            except ValueError as error:
                import openpyxl
                workbook = openpyxl.load_workbook(file, read_only=True, data_only=True, keep_links=False)
                try:
                    result.update(sheets=workbook.sheetnames, sheet=sheet or workbook.sheetnames[0], header=int(header), error=str(error))
                finally:
                    workbook.close()
            return result
        if kind == 'parquet':
            import pyarrow.parquet as pq
            parquet = pq.ParquetFile(file)
            columns = parquet.schema_arrow.names
            total = parquet.metadata.num_rows
            if len(columns)>512 or total>250000 or total*len(columns)>2000000:
                raise ValueError('This file exceeds the viewer limit: 512 columns, 250,000 rows or 2 million cells. Use a SQL query to inspect a smaller selection.')
            rows = []
            for batch in parquet.iter_batches(batch_size=10000):
                rows.extend([[None if row[name] is None else str(row[name]) for name in columns] for row in batch.to_pylist()])
            result.update(columns=columns,
                          schema=[{'name': f.name, 'type': str(f.type)} for f in parquet.schema_arrow],
                          rows=rows, limited=False, total=total, checkedAll=True)
            return result
        if kind not in ('md', 'markdown', 'csv', 'tsv', 'json', 'txt', 'sql', 'py', 'r'):
            raise ValueError('Preview is available for Markdown, CSV, TSV, JSON, Parquet and text/code files.')
        with file.open('rb') as stream:
            raw = stream.read(1_000_001)
        result['truncated'] = len(raw) > 1_000_000
        try:
            decoder = codecs.getincrementaldecoder('utf-8-sig')()
            result['source'] = decoder.decode(raw[:1_000_000], final=not result['truncated'])
        except UnicodeDecodeError:
            raise ValueError('This file is not valid UTF-8 text; preview cannot decode it without changing its contents.')
        try:
            if kind in ('csv', 'tsv'):
                # Parse the complete file independently of the bounded raw-source excerpt.
                with file.open(encoding='utf-8-sig', newline='') as stream:
                    reader = csv.reader(stream, delimiter='\t' if kind == 'tsv' else ',', strict=True)
                    columns = next(reader, [])
                    rows = []
                    for row in reader:
                        if len(row) != len(columns):
                            raise ValueError(f'Row {reader.line_num} has {len(row)} fields; expected {len(columns)}. Check commas and quotes in the source.')
                        rows.append(row)
                        if len(columns)>512 or len(rows)>250000 or len(rows)*len(columns)>2000000:
                            raise ValueError('This file exceeds the viewer limit: 512 columns, 250,000 rows or 2 million cells. Use a SQL query to inspect a smaller selection.')
                result.update(columns=columns, rows=rows, limited=False, total=len(rows), checkedAll=True)
            elif kind == 'json':
                if result['truncated']:
                    raise ValueError('JSON exceeds the 1 MB preview limit. Source shows the beginning only.')
                def invalid_constant(value):
                    raise ValueError('Invalid JSON constant: ' + value)
                result['value'] = json.loads(result['source'], parse_constant=invalid_constant)
        except (ValueError, csv.Error, RecursionError) as error:
            result['error'] = str(error)
        return result
