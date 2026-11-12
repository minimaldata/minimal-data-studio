"""One local entry point; tests use disposable projects, never a running user project."""
from pathlib import Path
import subprocess
import sys
root = Path(__file__).resolve().parents[1]
for command in ([sys.executable, '-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_*.py'],
                ['node', '--test', *map(str, sorted((root / 'tests').glob('*.mjs')))],
                [sys.executable, 'scripts/check_frontend.py']):
    subprocess.run(command, cwd=root, check=True)
