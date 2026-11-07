"""Bundle the official arm64 R runtime; relocate native load paths into the app."""
import hashlib
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT/'build/r-cache'
MAGIC = {bytes.fromhex(x) for x in ['feedface','cefaedfe','feedfacf','cffaedfe','cafebabe','bebafeca','cafebabf','bfbafeca']}

def run(*args):
    subprocess.run([str(x) for x in args], check=True)

def fetch(name, url, sha):
    p = CACHE/name
    if not p.exists(): run('curl','-fL','--retry','3',url,'-o',p)
    if hashlib.sha256(p.read_bytes()).hexdigest() != sha: raise ValueError('Checksum mismatch: '+name)
    return p

def bundle(resources):
    if platform.machine() != 'arm64': raise ValueError('Bundled R release currently supports Apple Silicon only')
    CACHE.mkdir(parents=True, exist_ok=True)
    pkg = fetch('R-4.6.2-arm64.pkg','https://mac.r-project.org/bin/macosx/sonoma-arm64/base/R-4.6.2-arm64.pkg','a678b4db1fcd71b1b1cc58edcfa4a8d36ee012a02659dde9eab9366e93571157')
    extracted = CACHE/'expanded'
    if not extracted.exists():
        run('pkgutil','--check-signature',pkg)
        run('pkgutil','--expand-full',pkg,extracted)
    source = extracted/'R-fw.pkg/Payload/R.framework/Versions/4.6/Resources'
    dest = Path(resources)/'R'
    shutil.copytree(source,dest,symlinks=True,ignore=shutil.ignore_patterns('*.dSYM'))
    # Optional X11/Tcl interfaces require separate desktop installations; Studio uses Quartz.
    for relative in ['library/tcltk','modules/R_X11.so','modules/R_de.so','library/grDevices/libs/cairo.so']:
        p=dest/relative
        if p.is_dir(): shutil.rmtree(p)
        elif p.exists(): p.unlink()
    package = fetch('nanoparquet_0.5.2.tgz','https://cran.r-project.org/bin/macosx/sonoma-arm64/contrib/4.6/nanoparquet_0.5.2.tgz','2f13a13706dcf1471dee612ac9f33a2ff8adbba00d4533aa61c45864d180d1ff')
    with tarfile.open(package) as t:
        for m in t.getmembers():
            if m.name.startswith('/') or '..' in Path(m.name).parts: raise ValueError('Unsafe package path')
        t.extractall(dest/'library')
    # The R shell launcher and Rscript must discover their new location at runtime.
    p=dest/'bin/R'
    s=p.read_text().replace('R_HOME_DIR="/Library/Frameworks/R.framework/Resources"','R_HOME_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)"')
    s=s.replace('/Library/Frameworks/R.framework/Resources/', '${R_HOME}/')
    p.write_text(s)
    envfile=dest/'etc/Renviron'
    envfile.write_text(envfile.read_text().replace('/Library/Frameworks/R.framework/Resources/', '${R_HOME}/'))
    native=dest/'bin/Rscript'
    native.rename(dest/'bin/Rscript-native')
    native.write_text('''#!/bin/sh
RHOME="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)"
export RHOME
exec "$RHOME/bin/Rscript-native" "$@"
''')
    native.chmod(0o755)
    # Preserve upstream licenses, help, and sources references. No personal R libraries.
    binaries=[]
    for p in dest.rglob('*'):
        if not p.is_file() or p.is_symlink() or p.suffix=='.class': continue
        with p.open('rb') as stream: is_native=stream.read(4) in MAGIC
        if is_native: binaries.append(p)
    for p in binaries:
        lines=subprocess.check_output(['otool','-L',str(p)],text=True).splitlines()[1:]
        for line in lines:
            if not line.startswith('\t'): continue
            dep=line.strip().split(' (')[0]
            if dep.startswith(('/System/Library/','/usr/lib/','@')): continue
            if '/Resources/' in dep: target=dest/dep.split('/Resources/',1)[1]
            elif (dest/'lib'/Path(dep).name).exists(): target=dest/'lib'/Path(dep).name
            elif '/' not in dep: continue  # Mach-O install ID, not an external library.
            else: raise ValueError(f'Unbundled dependency: {p}: {dep}')
            if not target.exists(): raise ValueError(f'Missing bundled dependency: {target}')
            relocated='@loader_path/'+os.path.relpath(target,p.parent)
            run('install_name_tool','-change',dep,relocated,p)
        if p.suffix in ('.so','.dylib'):
            run('install_name_tool','-id','@loader_path/'+p.name,p)
        run('codesign','--force','--sign','-',p)
    (dest/'STUDIO-NOTES.txt').write_text('R 4.6.2 with recommended packages and nanoparquet 0.5.2.\nRelocated by packaging/macos/bundle_r.py. Optional X11, Cairo and Tcl/Tk interfaces omitted. Use Quartz graphics.\nR license: COPYING (GPL-2 or GPL-3). nanoparquet license: library/nanoparquet/LICENSE.\nSources: https://cran.r-project.org/src/base/R-4/R-4.6.2.tar.gz\nhttps://cran.r-project.org/src/contrib/nanoparquet_0.5.2.tar.gz\n')

if __name__=='__main__':
    import sys
    bundle(Path(sys.argv[1]))
