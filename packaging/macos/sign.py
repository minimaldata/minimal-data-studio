#!/usr/bin/env python3
"""Sign a separate release candidate. Credentials stay in macOS Keychain."""
import argparse
from pathlib import Path
import shutil
import subprocess

MACHO = {bytes.fromhex(x) for x in ['feedface','cefaedfe','feedfacf','cffaedfe','cafebabe','bebafeca','cafebabf','bfbafeca']}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--identity', required=True, help='Developer ID Application identity or certificate SHA-1')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    source = root/'build/macos/Minimal Data Studio.app'
    destination = root/'build/signed/Minimal Data Studio.app'
    if destination.exists():
        raise SystemExit('Signed candidate already exists. Inspect it before starting a new candidate.')
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, destination, symlinks=True)
    notes = destination/'Contents/Resources/READ-ME-FIRST.txt'
    text = notes.read_text()
    start = text.find('This preview is not notarized')
    end = text.find('SQL and Python', start)
    if start >= 0 and end > start:
        text = text[:start] + 'Download and first-launch help:\nhttps://minimaldata.github.io/minimal-data-studio/\n\n' + text[end:]
    notes.write_text(text.replace('This is an early preview, not a signed production release.',
                                  'This is an early preview signed with an Apple Developer ID.'))
    binaries = []
    for path in destination.rglob('*'):
        if path.is_symlink() or not path.is_file():
            continue
        with path.open('rb') as stream:
            if stream.read(4) in MACHO:
                binaries.append(path)
    # Sign nested native libraries and interpreters before sealing the outer app.
    for path in sorted(binaries, key=lambda p:len(p.parts), reverse=True):
        subprocess.run(['codesign','--force','--timestamp','--options','runtime','--sign',args.identity,str(path)],check=True)
    subprocess.run(['codesign','--force','--timestamp','--options','runtime','--sign',args.identity,str(destination)],check=True)
    subprocess.run(['codesign','--verify','--deep','--strict',str(destination)],check=True)
    print(f'Signed {len(binaries)} native binaries: {destination}')

if __name__ == '__main__':
    main()
