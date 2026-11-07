#!/usr/bin/env python3
"""Finalize an Accepted submission; never publish a rejected/pending candidate."""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import plistlib
import shutil
import subprocess


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--profile', default='minimal-data-studio')
    parser.add_argument('--version', required=True, help='Release filename version, e.g. 0.1.0-alpha.2')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    folder = root/'build/signed'
    app = folder/'Minimal Data Studio.app'
    submission = json.loads((folder/'submission.json').read_text())['id']
    info = json.loads(subprocess.check_output(['xcrun','notarytool','info',submission,'--keychain-profile',args.profile,'--output-format','json']))
    if info['status'] != 'Accepted':
        raise SystemExit('Not ready: ' + info['status'])
    subprocess.run(['xcrun','notarytool','log',submission,'--keychain-profile',args.profile,str(folder/'notary-log.json')],check=True)
    for command in [ ['xcrun','stapler','staple',str(app)],
                     ['xcrun','stapler','validate',str(app)],
                     ['codesign','--verify','--deep','--strict',str(app)],
                     ['spctl','--assess','--type','execute','--verbose=2',str(app)]]:
        subprocess.run(command,check=True)
    version = plistlib.loads((app/'Contents/Info.plist').read_bytes())['CFBundleShortVersionString']
    assert args.version.split('-')[0] == version, 'Version mismatch'
    label = 'Apple-Silicon' if platform.machine() == 'arm64' else 'Intel'
    dist = root/'dist'
    archive = dist/f'Minimal-Data-Studio-{args.version}-macOS-{label}.zip'
    if archive.exists():
        archive.unlink()
    subprocess.run(['ditto','-c','-k','--sequesterRsrc','--keepParent',str(app),str(archive)],check=True)
    checksum = hashlib.sha256(archive.read_bytes()).hexdigest()
    Path(str(archive)+'.sha256').write_text(checksum+'  '+archive.name+'\n')
    shutil.copy2(app/'Contents/Resources/READ-ME-FIRST.txt',dist/'READ-ME-FIRST.txt')
    print(json.dumps({'download':str(archive),'sha256':checksum,'submission':submission}))

if __name__ == '__main__':
    main()
