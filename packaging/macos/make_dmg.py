#!/usr/bin/env python3
"""Create a drag-to-Applications disk image; no publishing or signing implicit."""
import argparse
from pathlib import Path
import shutil
import subprocess
import tempfile
import sys


def make_dmg(app, output):
    app, output = Path(app).resolve(), Path(output).resolve()
    if output.exists():
        raise ValueError(f'Refusing to overwrite {output}')
    output.parent.mkdir(parents=True, exist_ok=True)
    root = Path(__file__).resolve().parents[2]
    tools = root/'build/packaging-tools/bin/python'
    if not tools.exists():
        subprocess.run([sys.executable, '-m', 'venv', str(tools.parents[1])], check=True)
        subprocess.run([str(tools), '-m', 'pip', 'install', 'ds-store==1.3.1'], check=True)
    with tempfile.TemporaryDirectory(prefix='mds-dmg-') as temporary:
        stage = Path(temporary)
        subprocess.run(['ditto', str(app), str(stage/app.name)], check=True)
        (stage/'Applications').symlink_to('/Applications')
        (stage/'Install — drag Studio to Applications.txt').write_text(
            'Drag Minimal Data Studio.app onto Applications.\n'
            'Then eject this disk image and open Studio from Applications.\n'
            'If replacing an older version, quit Studio first and choose Replace.\n'
            'Your project folders remain separate from the app.\n'
            'Future updates: Minimal Data Studio menu → Check for Updates…\n')
        subprocess.run([str(tools), str(Path(__file__).with_name('dmg_layout.py')), str(stage)], check=True)
        subprocess.run(['hdiutil', 'create', '-volname', 'Minimal Data Studio — Install',
                        '-srcfolder', str(stage), '-format', 'UDZO', str(output)], check=True)
    return output

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('app')
    parser.add_argument('output')
    args = parser.parse_args()
    print(make_dmg(args.app, args.output))
