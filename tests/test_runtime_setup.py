import base64
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from runtime_setup import RuntimeSetup

class RuntimeChecks(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root/'.studio').mkdir()
        self.manager = RuntimeSetup(self.root, self.root)
    def test_bundled_r_and_custom_selection_are_separate(self):
        from unittest.mock import patch
        studio = self.root/'resources/studio'
        studio.mkdir(parents=True)
        bundled = studio.parent/'R/bin/Rscript'
        bundled.parent.mkdir(parents=True)
        bundled.write_text('#!/bin/sh\n')
        manager = RuntimeSetup(studio, self.root)
        self.assertEqual(manager.selection('r'), str(bundled))
        manager.settings['r'] = {'mode':'custom','path':'/custom/Rscript'}
        self.assertEqual(manager.selection('r'), '/custom/Rscript')
        with patch.dict(os.environ, {'RHOME':'/wrong','R_HOME':'/wrong','R_LIBS':'/wrong'}):
            env = manager.environment('r')
            self.assertNotIn('RHOME', env)
            self.assertNotIn('R_HOME', env)
            self.assertNotIn('R_LIBS', env)
            self.assertNotIn('R_LIBS_USER', env)
        manager.close()

    def tearDown(self):
        self.manager.close()
        self.tmp.cleanup()
    def test_selection_persistence_and_invalid_path(self):
        result = self.manager.choose('python','custom',sys.executable)
        self.assertTrue(result['version'],result)
        other=RuntimeSetup(self.root,self.root)
        self.assertEqual(other.selection('python'),sys.executable)
        with self.assertRaises(ValueError):
            other.choose('python','custom','/no/such/python')
        self.assertEqual(other.selection('python'),sys.executable)
        other.choose('python','managed')
        self.assertEqual(other.settings['python']['mode'],'managed')
    def test_custom_r_does_not_inherit_managed_library(self):
        self.manager.settings['r']={'mode':'custom','path':'/missing'}
        self.assertNotIn('R_LIBS_USER',self.manager.environment('r'))
        self.manager.settings['r']={'mode':'managed'}
        self.assertEqual(self.manager.environment('r')['R_LIBS_USER'],str(self.manager.r_library))
    @unittest.skipUnless(os.name=='posix','PTY terminal requires POSIX')
    def test_interactive_terminal_and_close(self):
        self.manager.terminal('test','start',{})
        self.manager.terminal('test','resize',{'cols':60,'rows':14})
        first=self.manager.terminal('test','input',{'data':"printf 'MDS_TEST_OK\\n'; pwd\n"})
        output=base64.b64decode(first.get('output','')).decode(errors='replace')
        until=time.monotonic()+5
        while time.monotonic()<until and str(self.root) not in output:
            output+=base64.b64decode(self.manager.terminal('test','poll',{}).get('output','')).decode(errors='replace')
            time.sleep(.05)
        self.assertIn('MDS_TEST_OK',output)
        self.assertIn(str(self.root),output)
        self.assertFalse(self.manager.terminal('other','poll',{})['running'])
        self.manager.terminal('test','stop',{})
        self.assertNotIn('test',self.manager.terminals)
