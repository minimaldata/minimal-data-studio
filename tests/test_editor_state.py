import tempfile
import unittest
from pathlib import Path
from workspace_db import Workspace

class EditorStateChecks(unittest.TestCase):
    def test_restart_conflict_validation_and_isolation(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            state={'format':1,'tabs':[{'name':'Query','sql':'SELECT\n  1','lang':'sql','drafts':{'python':'print(1)'},'connection':'warehouse-test'}],'active':0}
            ws=Workspace(root,root,seed_samples=False)
            self.assertEqual(ws.editor_state()['revision'],0)
            self.assertEqual(ws.editor_state({'revision':0,'state':state}),{'revision':1})
            self.assertTrue(ws.editor_state({'revision':0,'state':state})['conflict'])
            with self.assertRaises(ValueError): ws.editor_state({'revision':1,'state':{'format':1,'tabs':[]}})
            ws.close()
            ws=Workspace(root,root,seed_samples=False)
            self.assertEqual(ws.editor_state()['state'],state)
            ws.close()
            other=root/'other';other.mkdir()
            ws=Workspace(other,other,seed_samples=False)
            self.assertIsNone(ws.editor_state()['state']);ws.close()
