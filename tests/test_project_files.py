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

    def test_read_only_previews(self):
        import pyarrow as pa
        import pyarrow.parquet as pq
        with tempfile.TemporaryDirectory() as tmp:
            files = ProjectFiles(tmp)
            csv = files.bring('sample.csv', b'code,label\n001,"hello, world"\n002,\n')
            before = Path(csv['full']).read_bytes()
            preview = files.preview(csv['relative'])
            self.assertEqual(preview['rows'], [['001','hello, world'],['002','']])
            self.assertEqual(Path(csv['full']).read_bytes(), before)
            tsv = files.bring('sample.tsv', b'a\tb\n1\t2\n')
            self.assertEqual(files.preview(tsv['relative'])['rows'], [['1','2']])
            md = files.bring('README.md', b'# Heading\n<script>alert(1)</script>')
            self.assertIn('<script>', files.preview(md['relative'])['source'])
            bad = files.bring('bad.csv', b'a,b\n1,2,3\n')
            self.assertIn('expected 2', files.preview(bad['relative'])['error'])
            badjson = files.bring('bad.json', b'{"x":')
            self.assertIn('error', files.preview(badjson['relative']))
            good = files.bring('good.json', b'{"x":[1,null,{"a":"b"}]}')
            self.assertEqual(files.preview(good['relative'])['value']['x'][1], None)
            pq.write_table(pa.table({'x':range(105)}), Path(tmp)/'data'/'sample.parquet')
            parquet = files.preview('data/sample.parquet')
            self.assertEqual(len(parquet['rows']), 100)
            self.assertTrue(parquet['limited'])
            self.assertEqual(parquet['schema'][0]['type'], 'int64')
            large = files.bring('large.txt', b'x'*1_000_010)
            self.assertTrue(files.preview(large['relative'])['truncated'])
            for path in ['../secret', '.studio/workspace.duckdb']:
                with self.assertRaises(ValueError): files.preview(path)
