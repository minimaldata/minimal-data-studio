import json
from pathlib import Path
import re
import tempfile
import unittest
import duckdb
from project_files import ProjectFiles

class ProjectGuideChecks(unittest.TestCase):
    def test_new_and_existing_projects_get_guides_without_overwriting(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            files=ProjectFiles(root)
            self.assertIn('STUDIO_SAVED_WORK.md',(root/'AGENTS.md').read_text())
            self.assertIn('X-Base-Version',(root/'STUDIO_SAVED_WORK.md').read_text())
            self.assertNotIn(str(root),(root/'AGENTS.md').read_text())
            (root/'AGENTS.md').write_text('My project instructions')
            (root/'STUDIO_SAVED_WORK.md').write_text('My guide additions')
            ProjectFiles(root)
            self.assertEqual((root/'AGENTS.md').read_text(),'My project instructions')
            self.assertEqual((root/'STUDIO_SAVED_WORK.md').read_text(),'My guide additions')
            self.assertEqual(files.preview('AGENTS.md')['kind'],'md')
            (root/'STUDIO_SAVED_WORK.md').unlink()
            ProjectFiles(root)
            self.assertIn('Runnable format example',(root/'STUDIO_SAVED_WORK.md').read_text())

    def test_existing_symlink_is_not_followed(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)/'project';root.mkdir()
            target=Path(folder)/'custom.md';target.write_text('Custom')
            (root/'AGENTS.md').symlink_to(target)
            ProjectFiles(root)
            self.assertTrue((root/'AGENTS.md').is_symlink())
            self.assertEqual(target.read_text(),'Custom')

    def test_documented_example_queries_and_notebook_run(self):
        guide=(Path(__file__).resolve().parents[1]/'project-guides/STUDIO_SAVED_WORK.md').read_text()
        example=json.loads(re.search(r'```json\n(.*?)\n```',guide,re.S).group(1))
        ids=[]
        with duckdb.connect() as c:
            for q in example['queries']:
                ids.append(q['id']);columns=[d[0] for d in c.execute(q['sql']).description]
                self.assertIn(q['chart']['x'],columns)
                for y in q['chart']['y']:self.assertIn(y,columns)
            for n in example['notebooks']:
                ids.append(n['id'])
                for cell in n['cells']:
                    ids.append(cell['id'])
                    if cell['type']=='sql':
                        self.assertRegex(cell['name'],r'^[A-Za-z_][A-Za-z0-9_]*$')
                        c.execute('CREATE TEMP TABLE "'+cell['name']+'" AS '+cell['source'])
                        self.assertGreater(c.execute('SELECT count(*) FROM "'+cell['name']+'"').fetchone()[0],0)
            for d in example['dashboards']:
                ids.append(d['id'])
                for tile in d['tiles']:
                    ids.append(tile['id']);self.assertIn(tile['query_id'],[q['id'] for q in example['queries']])
                    self.assertLessEqual(tile['x']+tile['w'],24)
        self.assertEqual(len(ids),len(set(ids)))
