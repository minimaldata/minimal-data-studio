import json
from pathlib import Path
import tempfile
import unittest
from workspace_db import Workspace

class EmptyProjects(unittest.TestCase):
    def test_empty_stays_empty_on_reopen(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            data = root/'data'; data.mkdir()
            (data/'sample.csv').write_text('x\n1\n')
            (root/'datasets.json').write_text(json.dumps({'sample':'sample.csv'}))
            (root/'views.sql').write_text('CREATE VIEW sample_view AS SELECT * FROM sample;')
            project = root/'empty'; project.mkdir()
            for _ in range(2):
                w = Workspace(root, data, project, migrate_legacy=False, seed_samples=False)
                self.assertEqual(w.connection.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='main'").fetchall(), [])
                w.close()
            populated = root/'populated'; populated.mkdir()
            w = Workspace(root, data, populated, migrate_legacy=False, seed_samples=True)
            self.assertEqual(w.connection.execute('SELECT x FROM sample').fetchone(), (1,))
            w.close()
