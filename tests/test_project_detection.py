import json
from pathlib import Path
import tempfile
import unittest
from project_launcher import ProjectLauncher

class ProjectDetection(unittest.TestCase):
    def test_marker_and_legacy_database(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)
            self.assertFalse(ProjectLauncher.is_project(p))
            marker = p / 'Open Project.mdsproject'
            marker.write_text('not a project')
            self.assertFalse(ProjectLauncher.is_project(p))
            marker.write_text(json.dumps({'format':'minimal-data-studio-project','version':1}))
            self.assertTrue(ProjectLauncher.is_project(p))
            marker.unlink()
            (p/'.studio').mkdir()
            (p/'.studio/workspace.duckdb').touch()
            self.assertTrue(ProjectLauncher.is_project(p))

    def test_folder_listing_labels_projects(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root/'Z ordinary').mkdir()
            project = root/'a project'
            (project/'.studio').mkdir(parents=True)
            (project/'.studio/workspace.duckdb').touch()
            launcher = ProjectLauncher(root, root, root, 'http://localhost:1/')
            try:
                info = launcher.folders(d)
                self.assertEqual(info['folders'], [{'name':'a project','isProject':True},{'name':'Z ordinary','isProject':False}])
                self.assertFalse(info['isProject'])
            finally:
                launcher.close()
