import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]

class VariableSnapshots(unittest.TestCase):
    def test_python_snapshot_survives_error_and_limits_preview(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)
            (p/'params.json').write_text('{}')
            (p/'code.py').write_text('import math\ndf = pd.DataFrame({"x": range(100)})\ntext = "a" * 10000\nraise ValueError("example")')
            subprocess.run([sys.executable, str(ROOT/'kernels/run_python.py'), d], check=True)
            items = {v['name']:v for v in json.loads((p/'variables.json').read_text())}
            self.assertEqual(items['df']['dimensions'], '100 rows × 1 columns')
            self.assertLess(len(items['text']['preview']), 3001)
            self.assertNotIn('math', items)
            self.assertNotIn('pd', items)
            self.assertIn('example', (p/'error.txt').read_text())

    def test_r_snapshot(self):
        import csv
        exe = shutil.which('Rscript')
        if not exe:
            self.skipTest('R not installed')
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)
            (p/'params.R').write_text('')
            (p/'code.R').write_text('df <- data.frame(x=1:100)\ntext <- "hello\\tworld"\nstop("example")')
            subprocess.run([exe, str(ROOT/'kernels/run_r.R'), d], check=True, capture_output=True)
            if not (p/'variables.tsv').exists():
                self.fail((p/'error.txt').read_text())
            with (p/'variables.tsv').open() as f:
                items = {v['name']:v for v in csv.DictReader(f, delimiter='\t')}
            self.assertEqual(items['df']['dimensions'], '100 × 1')
            self.assertIn('text', items)
            self.assertIn('example', (p/'error.txt').read_text())

if __name__ == '__main__':
    unittest.main()
