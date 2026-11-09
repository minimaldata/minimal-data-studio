#!/usr/bin/env python3
"""Create a drag-to-Applications disk image; no publishing or signing implicit."""
import argparse
from pathlib import Path
import plistlib
import subprocess
import tempfile
import sys


def make_dmg(app, output, volume_name='Minimal Data Studio — Install'):
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
        work = Path(temporary)
        stage = work/'stage'
        stage.mkdir()
        subprocess.run(['ditto', str(app), str(stage/app.name)], check=True)
        (stage/'Applications').symlink_to('/Applications')
        (stage/'.background').mkdir()
        subprocess.run(['swift', '-module-cache-path', str(root/'build/swift-module-cache'),
                        str(Path(__file__).with_name('DmgBackground.swift')),
                        str(stage/'.background/installer.png')], check=True)
        writable = work/'installer.dmg'
        subprocess.run(['hdiutil', 'create', '-volname', volume_name, '-fs', 'HFS+',
                        '-srcfolder', str(stage), '-format', 'UDRW', str(writable)], check=True)
        attached = plistlib.loads(subprocess.check_output(
            ['hdiutil', 'attach', '-nobrowse', '-plist', str(writable)]))
        volume = next(item['mount-point'] for item in attached['system-entities'] if 'mount-point' in item)
        try:
            # Build the alias on the mounted volume so it survives distribution.
            subprocess.run([str(tools), str(Path(__file__).with_name('dmg_layout.py')), volume], check=True)
        finally:
            subprocess.run(['hdiutil', 'detach', volume], check=True)
        subprocess.run(['hdiutil', 'convert', str(writable), '-format', 'UDZO', '-o', str(output)], check=True)
    return output

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('app')
    parser.add_argument('output')
    parser.add_argument('--volume-name', default='Minimal Data Studio — Install')
    args = parser.parse_args()
    print(make_dmg(args.app, args.output, args.volume_name))
