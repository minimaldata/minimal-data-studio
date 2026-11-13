#!/usr/bin/env python3
"""Build a self-contained Mac app. Run on the target Mac architecture."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import plistlib
import shutil
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[2]
config = json.loads((ROOT/'packaging/macos/updates.json').read_text())
parser = argparse.ArgumentParser()
parser.add_argument('--channel', choices=['stable', 'preview'], default='preview')
parser.add_argument('--version', default=config['version'])
parser.add_argument('--build-number', type=int, default=config['build'])
args = parser.parse_args()
VERSION = args.version
if args.channel == 'stable' and '-' in VERSION:
    raise SystemExit('Stable builds require a release version, not a prerelease version')
ARCH = {'arm64':'aarch64','x86_64':'x86_64'}[platform.machine()]
SHA = {
    'aarch64':'f3e1cd83a7f1d70e58b0d69102c18bd6867d2f973068dc5cbfd5822e445c66df',
    'x86_64':'d38edc2df25e7e7f886c802bf2fa552422b097c509dbdcbae828827470356095'
}[ARCH]
NAME = f'cpython-3.11.18+20261026-{ARCH}-apple-darwin-install_only_stripped.tar.gz'
URL = 'https://github.com/astral-sh/python-build-standalone/releases/download/20261026/' + NAME.replace('+','%2B')
BUILD = ROOT/'build'/'macos'
DIST = ROOT/'dist'
APP = BUILD/'Minimal Data Studio.app'
RES = APP/'Contents'/'Resources'
def run(*args, **kw):
    subprocess.run([str(a) for a in args], check=True, **kw)
BUILD.mkdir(parents=True,exist_ok=True)
DIST.mkdir(exist_ok=True)
cache = BUILD/NAME
if not cache.exists():
    run('curl','--fail','--location','--retry','3',URL,'--output',cache)
assert hashlib.sha256(cache.read_bytes()).hexdigest() == SHA, 'Python archive checksum mismatch'
if APP.exists():
    shutil.rmtree(APP)
RES.mkdir(parents=True)
(APP/'Contents'/'MacOS').mkdir()
with tarfile.open(cache) as archive:
    for member in archive.getmembers():
        if member.name.startswith('/') or '..' in Path(member.name).parts:
            raise ValueError('Unsafe archive member')
    archive.extractall(RES)
python = RES/'python'/'bin'/'python3'
lock = ROOT/'packaging'/'macos'/'requirements.lock'
requirements = lock if lock.exists() else ROOT/'packaging'/'macos'/'requirements.in'
run(python,'-m','pip','install','--disable-pip-version-check','--no-compile','--only-binary=:all:','-r',requirements)
if not lock.exists():
    frozen = subprocess.check_output([str(python),'-m','pip','freeze'],text=True)
    lock.write_text(frozen)
# Console scripts should follow the relocatable runtime instead of the build folder.
for executable in (RES/'python'/'bin').iterdir():
    if executable.is_symlink() or not executable.is_file():
        continue
    data = executable.read_bytes()
    if data.startswith(b'#!') and b'python' in data.split(b'\n',1)[0]:
        body = data.split(b'\n',1)[1]
        executable.write_bytes(b'#!/bin/sh\n\'\'\'exec\' "$(dirname "$0")/python3" "$0" "$@"\n\' \'\'\'\n' + body)
from bundle_r import bundle
bundle(RES)
shutil.copytree(ROOT/'packaging/macos/licenses', RES/'licenses')
studio = RES/'studio'
studio.mkdir()
# Explicit allowlist: no project, local DB, secrets, original saved work, or Git history.
for name in ['index.html','serve.py','workspace_access.py','task_runner.py', 'task_schedule.py','remote_sources.py','remote_transfers.py','google_profiles.py','remote_connectors.py','remote_models.py','model_references.py','workspace_db.py','project_files.py','excel_files.py','runtime_setup.py','runtime_probe.py','project_launcher.py','draft_data.py','draft-editor.js','sql-completion.js','datasets.json','views.sql','LICENSE','THIRD_PARTY.md']:
    shutil.copy2(ROOT/name,studio/name)
for name in ['kernels','data','examples','assets','project-guides','frontend']:
    shutil.copytree(ROOT/name,studio/name,ignore=shutil.ignore_patterns('__pycache__','.DS_Store'))
for path in (RES/'python').rglob('__pycache__'):
    shutil.rmtree(path)
sparkle = ROOT/'build/sparkle'
sparkle.mkdir(parents=True, exist_ok=True)
sparkle_archive = sparkle/f"Sparkle-{config['sparkle_version']}.tar.xz"
if not sparkle_archive.exists():
    run('curl', '--fail', '--location', f"https://github.com/sparkle-project/Sparkle/releases/download/{config['sparkle_version']}/{sparkle_archive.name}", '--output', sparkle_archive)
if hashlib.sha256(sparkle_archive.read_bytes()).hexdigest() != config['sparkle_sha256']:
    raise SystemExit('Sparkle archive checksum mismatch')
run('tar', '-xf', sparkle_archive, '-C', sparkle)
frameworks = APP/'Contents/Frameworks'
frameworks.mkdir()
run('ditto', sparkle/'Sparkle.framework', frameworks/'Sparkle.framework')
launcher_source = BUILD/'LauncherCombined.swift'
launcher_source.write_text((ROOT/'packaging/macos/CredentialProjects.swift').read_text() + '\n' + (ROOT/'packaging/macos/Credentials.swift').read_text() + '\n' + (ROOT/'packaging/macos/TaskCredentials.swift').read_text() + '\n' + (ROOT/'packaging/macos/Launcher.swift').read_text())
run('xcrun','swiftc','-O','-F',frameworks,'-framework','Sparkle','-Xlinker','-rpath','-Xlinker','@executable_path/../Frameworks','-target' ,platform.machine()+'-apple-macosx12.0',
    launcher_source,'-o',APP/'Contents/MacOS/MinimalDataStudio')
run('xcrun','swiftc','-O',ROOT/'packaging/macos/ChooseFolder.swift','-o',RES/'ChooseFolder')
run('xcrun','swiftc',ROOT/'packaging/macos/Icon.swift','-o',BUILD/'make-icon')
run(BUILD/'make-icon',BUILD/'icon-png')
iconset = BUILD/'Studio.iconset'
iconset.mkdir(exist_ok=True)
for size in [16,32,128,256,512]:
    shutil.copyfile(BUILD/'icon-png'/f'size_{size}.png',iconset/f'icon_{size}x{size}.png')
    shutil.copyfile(BUILD/'icon-png'/f'size_{size*2}.png',iconset/f'icon_{size}x{size}@2x.png')
run('iconutil','-c','icns',iconset,'-o',RES/'Studio.icns')
info = {
    'CFBundleName':'Minimal Data Studio','CFBundleDisplayName':'Minimal Data Studio',
    'CFBundleIdentifier':'com.minimaldata.studio','CFBundleExecutable':'MinimalDataStudio',
    'CFBundlePackageType':'APPL','CFBundleIconFile':'Studio.icns','CFBundleShortVersionString':VERSION.split('-')[0],
    'CFBundleVersion':str(args.build_number),'LSMinimumSystemVersion':'14.0','NSHighResolutionCapable':True,
    'CFBundleDocumentTypes': [{
        'CFBundleTypeName': 'Minimal Data Studio Project',
        'CFBundleTypeRole': 'Editor', 'LSHandlerRank': 'Owner',
        'LSItemContentTypes': ['com.minimaldata.studio.project'],
        'CFBundleTypeIconFile': 'Studio.icns'
    }],
    'UTExportedTypeDeclarations': [{
        'UTTypeIdentifier': 'com.minimaldata.studio.project',
        'UTTypeDescription': 'Minimal Data Studio Project',
        'UTTypeConformsTo': ['public.json'],
        'UTTypeTagSpecification': {'public.filename-extension': ['mdsproject']}
    }],
    'SUFeedURL':config['feeds'][args.channel],
    'SUPublicEDKey':config['public_key'],
    'SUEnableAutomaticChecks':True, 'SUAutomaticallyUpdate':False,
    'SUAllowsAutomaticUpdates':False,
    'MDSReleaseChannel':args.channel, 'MDSVersion':VERSION,
    'CFBundleURLTypes':[{'CFBundleURLName':'Studio updates', 'CFBundleURLSchemes':['mds-studio']}],
    'NSDocumentsFolderUsageDescription':'Choose a project folder for your data and saved work.'
}
(APP/'Contents/Info.plist').write_bytes(plistlib.dumps(info))
shutil.copy2(ROOT/'packaging/macos/READ-ME-FIRST.txt', RES/'READ-ME-FIRST.txt')
# Local integrity signature only: no Apple account, notarization, or App Store.
run('codesign','--force','--deep','--sign','-',APP)
label = 'Apple-Silicon' if ARCH == 'aarch64' else 'Intel'
zipfile = DIST/f'Minimal-Data-Studio-{VERSION}-macOS-{label}.zip'
if zipfile.exists(): zipfile.unlink()
run('ditto','-c','-k','--sequesterRsrc','--keepParent',APP,zipfile)
sha = hashlib.sha256(zipfile.read_bytes()).hexdigest()
Path(str(zipfile)+'.sha256').write_text(sha+'  '+zipfile.name+'\n')
shutil.copy2(ROOT/'packaging/macos/READ-ME-FIRST.txt',DIST/'READ-ME-FIRST.txt')
print(json.dumps({'app':str(APP),'download':str(zipfile),'sha256':sha}))

from make_dmg import make_dmg
dmg = DIST/f'Minimal-Data-Studio-{VERSION}-macOS-{label}.dmg'
if dmg.exists(): dmg.unlink()
make_dmg(APP, dmg)
Path(str(dmg)+'.sha256').write_text(hashlib.sha256(dmg.read_bytes()).hexdigest()+'  '+dmg.name+'\n')
