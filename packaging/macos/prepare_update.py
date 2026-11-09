#!/usr/bin/env python3
"""Stage a signed appcast; never upload or change the public feed automatically."""
import argparse
from pathlib import Path
import plistlib
import platform
import shutil
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--app', required=True)
parser.add_argument('--tag', required=True)
parser.add_argument('--notes', required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
app = Path(args.app).resolve()
info = plistlib.loads((app/'Contents/Info.plist').read_bytes())
channel = info['MDSReleaseChannel']
version = info['MDSVersion']
if args.tag != 'v'+version:
    raise SystemExit('Release tag must match the built app version')
if channel == 'stable' and '-' in version:
    raise SystemExit('Prerelease versions cannot enter the stable feed')
for command in [['codesign','--verify','--deep','--strict',str(app)],
                ['xcrun','stapler','validate',str(app)],
                ['spctl','--assess','--type','execute',str(app)]]:
    subprocess.run(command, check=True)
stage = root/'dist/updates'/channel/args.tag
stage.mkdir(parents=True, exist_ok=False)
label = 'Apple-Silicon' if platform.machine() == 'arm64' else 'Intel'
archive = stage/f'Minimal-Data-Studio-{version}-macOS-{label}.zip'
subprocess.run(['ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', str(app), str(archive)], check=True)
shutil.copy2(args.notes, stage/(archive.stem+'.md'))
# generate_appcast signs the archive using the Sparkle key held in Keychain.
subprocess.run([str(root/'build/sparkle/bin/generate_appcast'),
    '--download-url-prefix', f'https://github.com/minimaldata/minimal-data-studio/releases/download/{args.tag}/',
    '--embed-release-notes', '--maximum-deltas', '0', '-o', str(stage/(channel+'.xml')), str(stage)], check=True)
print(f'Staged for review: {stage}. Upload the archive first, then publish {channel}.xml. Nothing has been published.')
