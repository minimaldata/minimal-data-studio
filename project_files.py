"""Project-scoped file navigation and atomic, non-overwriting file copies."""
import os
from pathlib import Path
import tempfile

MANAGED = {'.studio', 'saved_queries.json', 'backups'}

class ProjectFiles:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        for name in ('data', 'exports', '.studio'):
            (self.root / name).mkdir(exist_ok=True)

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
