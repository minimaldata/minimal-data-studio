import tempfile
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from project_files import ProjectFiles

class ProjectFileChecks(unittest.TestCase):
    def test_copy_paths_collisions_and_boundary(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'project'
            files = ProjectFiles(root)
            a = files.bring('my data.csv', b'id\n1\n')
            b = files.bring('my data.csv', b'id\n2\n')
            self.assertEqual(a['relative'], 'data/my data.csv')
            self.assertEqual(b['relative'], 'data/my data_2.csv')
            self.assertEqual(Path(a['full']).read_bytes(), b'id\n1\n')
            self.assertEqual(len(files.listing('data')['entries']), 2)
            for path in ('../outside', '/etc/passwd', '.studio', 'saved_queries.json'):
                with self.assertRaises(ValueError): files.resolve(path)
            (root / 'external').symlink_to(Path(tmp), target_is_directory=True)
            self.assertTrue(next(e for e in files.listing()['entries'] if e['name']=='external')['outside'])
            with self.assertRaises(ValueError): files.resolve('external')
            for name in ('../bad.csv','/bad.csv','.hidden','x\\y.csv'):
                with self.assertRaises(ValueError): files.bring(name, b'x')
