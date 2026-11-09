"""A saved address must not send a project to a stopped or unrelated server."""
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from project_launcher import ProjectLauncher


class ProjectReopenChecks(unittest.TestCase):
    def test_reopen_after_child_stops(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp).resolve()
            project = folder / 'lesson'
            project.mkdir()
            (project / '.studio').mkdir()
            (project / '.studio/creation-options.json').write_text('{"sampleData":false,"sampleNotebooks":false}')
            root = Path(__file__).resolve().parents[1]
            with patch.dict(os.environ, {'MDS_PROJECT_REGISTRY': str(folder / 'registry.json')}):
                launcher = ProjectLauncher(root, root / 'data', folder, 'http://localhost:1/')
                try:
                    first = launcher.open(project)
                    self.assertTrue(launcher.server_alive(str(project), first['url']))
                    self.assertFalse(launcher.server_alive(str(folder), first['url']))
                    self.assertEqual(launcher.open(project), first)
                    child = launcher.children[0][0]
                    child.terminate()
                    child.wait(timeout=10)
                    self.assertFalse(launcher.server_alive(str(project), first['url']))
                    reopened = launcher.open(project)
                    self.assertTrue(launcher.server_alive(str(project), reopened['url']))
                    self.assertEqual(len(launcher.children), 2)
                    self.assertEqual(launcher._registry()[str(project)], reopened['url'])
                finally:
                    launcher.close()
