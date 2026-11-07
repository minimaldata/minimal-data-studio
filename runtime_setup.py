"""Local runtime selection and bounded, session-owned interactive terminals."""
import base64
import glob
import json
import os
from pathlib import Path
import shlex
import shutil
import signal
import subprocess
import sys
import threading
import time

class RuntimeSetup:
    def __init__(self, root, project):
        self.root, self.project = Path(root), Path(project)
        self.config = self.project / '.studio' / 'runtimes.json'
        self.lock = threading.RLock()
        self.terminals = {}
        try:
            self.settings = json.loads(self.config.read_text())
        except (OSError, ValueError):
            self.settings = {}
        self.r_library = Path(os.environ.get('MDS_MANAGED_R_LIBRARY', str(self.root / '.venv' / 'R-library')))

    def candidates(self, lang):
        if lang == 'python':
            values = [str(self.root/'.venv'/'bin'/'python'), sys.executable,
                      os.environ.get('SQL_LAB_PYTHON'), shutil.which('python3'), shutil.which('python')]
            values += glob.glob('/Library/Frameworks/Python.framework/Versions/*/bin/python3')
        else:
            values = [shutil.which('Rscript'), '/opt/homebrew/bin/Rscript', '/usr/local/bin/Rscript',
                      '/Library/Frameworks/R.framework/Resources/bin/Rscript']
        # Keep virtual-environment paths intact; resolving symlinks loses the venv.
        return list(dict.fromkeys(os.path.abspath(p) for p in values if p and os.path.isfile(p) and os.access(p, os.X_OK)))

    def selection(self, lang):
        if lang not in ('python', 'r'):
            raise ValueError('Choose Python or R.')
        choice = self.settings.get(lang, {'mode':'managed'})
        if choice.get('mode') == 'custom':
            return choice['path']
        if lang == 'python':
            p = self.root/'.venv'/'bin'/'python'
            return str(p) if p.is_file() else sys.executable
        bundled = self.root.parent/'R/bin/Rscript'
        return str(bundled) if bundled.is_file() else next(iter(self.candidates('r')), None)

    def environment(self, lang, mode=None):
        env = os.environ.copy()
        if lang == 'r':
            for key in ('R_HOME', 'RHOME', 'R_SHARE_DIR', 'R_INCLUDE_DIR', 'R_DOC_DIR', 'R_LIBS', 'R_LIBS_SITE', 'R_LIBS_USER'):
                env.pop(key, None)
            if (mode or self.settings.get('r', {}).get('mode', 'managed')) == 'managed':
                self.r_library.mkdir(parents=True, exist_ok=True)
                env['R_LIBS_USER'] = str(self.r_library)
        return env

    def check(self, lang, path=None, mode=None):
        path = path or self.selection(lang)
        mode = mode or self.settings.get(lang, {}).get('mode', 'managed')
        result = {'language':lang, 'mode':mode, 'path':path, 'packages':[], 'ready':False,
                  'candidates':self.candidates(lang), 'version':None}
        if not path:
            result['error'] = 'Runtime not found. Install R, then check again.' if lang == 'r' else 'Python was not found.'
            return result
        env = self.environment(lang, mode)
        if lang == 'r' and mode == 'custom':
            for key in ('R_HOME', 'RHOME', 'R_SHARE_DIR', 'R_INCLUDE_DIR', 'R_DOC_DIR', 'R_LIBS', 'R_LIBS_SITE', 'R_LIBS_USER'):
                env.pop(key, None)
        if lang == 'python':
            code = """import sys,json,importlib
out={'version':sys.version.split()[0],'packages':[]}
for name in ['pandas','pyarrow','matplotlib']:
 try:
  m=importlib.import_module(name)
  out['packages'].append({'name':name,'ok':True,'version':str(getattr(m,'__version__','installed'))})
 except Exception as e:
  out['packages'].append({'name':name,'ok':False,'error':str(e)})
print('MDS_CHECK:'+json.dumps(out))
"""
            command = [path, '-c', code]
        else:
            code = """cat('MDS_VERSION:',as.character(getRversion()),'\\n',sep='')
ok <- requireNamespace('nanoparquet',quietly=TRUE)
cat('MDS_PACKAGE:',if(ok) as.character(packageVersion('nanoparquet')) else 'MISSING','\\n',sep='')
"""
            command = [path, '--vanilla', '-e', code]
        try:
            proc = subprocess.run(command, cwd=self.project, env=env, capture_output=True, text=True, timeout=20)
            result['log'] = (proc.stdout + proc.stderr)[-10000:]
            if proc.returncode:
                raise ValueError('Runtime check failed: ' + result['log'])
            if lang == 'python':
                data = next(line[10:] for line in proc.stdout.splitlines() if line.startswith('MDS_CHECK:'))
                result.update(json.loads(data))
            else:
                result['version'] = next(line[12:] for line in proc.stdout.splitlines() if line.startswith('MDS_VERSION:'))
                version = next(line[12:] for line in proc.stdout.splitlines() if line.startswith('MDS_PACKAGE:'))
                result['packages'] = [{'name':'nanoparquet','ok':version != 'MISSING','version':version}]
            result['ready'] = all(p['ok'] for p in result['packages'])
        except (OSError, ValueError, StopIteration, subprocess.TimeoutExpired) as error:
            result['error'] = str(error) or 'The selected program did not identify itself as this runtime.'
        if lang == 'python':
            result['install'] = shlex.quote(path) + ' -m pip install "pandas>=2.2,<3" "pyarrow>=17,<24" "matplotlib>=3.9,<4"'
        else:
            prefix = ('R_LIBS_USER=' + shlex.quote(str(self.r_library)) + ' ') if mode == 'managed' else ''
            result['install'] = prefix + shlex.quote(path) + ' --vanilla -e ' + shlex.quote('install.packages("nanoparquet", repos="https://cloud.r-project.org")')
        return result

    def choose(self, lang, mode, path=''):
        if lang not in ('python','r') or mode not in ('managed','custom'):
            raise ValueError('Choose a valid language and environment.')
        if mode == 'custom':
            path = os.path.abspath(os.path.expanduser(path))
            if not os.path.isfile(path) or not os.access(path, os.X_OK):
                raise ValueError('Choose the full path to an executable Python or Rscript program.')
            check = self.check(lang, path, mode)
            if not check.get('version'):
                raise ValueError(check.get('error', 'Not a usable runtime.'))
        with self.lock:
            updated = dict(self.settings)
            updated[lang] = {'mode':mode, 'path':path if mode == 'custom' else ''}
            temporary = self.config.with_suffix('.tmp')
            temporary.write_text(json.dumps(updated, indent=2))
            os.replace(temporary, self.config)
            self.settings = updated
        return self.check(lang)

    def terminal(self, session, action, req):
        if os.name != 'posix':
            raise ValueError('The interactive terminal currently supports macOS and Linux.')
        import fcntl
        import pty
        import struct
        import termios
        with self.lock:
            # Idle/orphaned shells are bounded even if a browser closes without cleanup.
            for key, item in list(self.terminals.items()):
                if time.monotonic() - item['seen'] > 1800:
                    self.stop_terminal(key)
            if action == 'start':
                if session in self.terminals:
                    return {'running':True, 'cwd':str(self.project)}
                master, slave = pty.openpty()
                env = self.environment('r')
                py, r = self.selection('python'), self.selection('r')
                env.update(TERM='xterm-256color', MDS_PYTHON=py or '', MDS_RSCRIPT=r or '')
                env['PATH'] = os.pathsep.join([str(Path(p).parent) for p in (py,r) if p] + [env.get('PATH','')])
                shell = shutil.which('zsh') or shutil.which('bash') or '/bin/sh'
                # A separate helper acquires the controlling TTY before exec, without
                # calling fork/preexec hooks in the threaded HTTP server.
                shell_args = [shell] + (['-f', '-i'] if shell.endswith('zsh') else ['--noprofile', '--norc', '-i'] if shell.endswith('bash') else ['-i'])
                helper = "import os,fcntl,termios;fcntl.ioctl(0,termios.TIOCSCTTY,0);os.execv(" + repr(shell) + "," + repr(shell_args) + ")"
                try:
                    proc = subprocess.Popen([sys.executable,'-c',helper], stdin=slave, stdout=slave, stderr=slave,
                                            start_new_session=True, cwd=self.project, env=env)
                except Exception:
                    os.close(master)
                    raise
                finally:
                    os.close(slave)
                os.set_blocking(master, False)
                self.terminals[session] = {'fd':master,'process':proc,'seen':time.monotonic(),'shell':shell}
                return {'running':True,'cwd':str(self.project),'shell':shell,'python':py,'r':r}
            item = self.terminals.get(session)
            if not item:
                return {'running':False,'output':''}
            item['seen'] = time.monotonic()
            fd = item['fd']
            if action == 'stop':
                self.stop_terminal(session)
                return {'running':False}
            if action == 'input':
                data = req.get('data','').encode()
                if len(data) > 16384:
                    raise ValueError('Terminal input is too large.')
                os.write(fd, data)
            elif action == 'resize':
                cols, rows = max(20,min(300,int(req['cols']))), max(4,min(100,int(req['rows'])))
                fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH',rows,cols,0,0))
            elif action != 'poll':
                raise ValueError('Unknown terminal action.')
            output = b''
            for _ in range(16):
                try:
                    chunk = os.read(fd, 4096)
                    if not chunk: break
                    output += chunk
                except (BlockingIOError, OSError):
                    break
            running = item['process'].poll() is None
            if not running:
                self.stop_terminal(session)
            return {'running':running,'output':base64.b64encode(output).decode()}

    def stop_terminal(self, session):
        item = self.terminals.pop(session, None)
        if not item: return
        try:
            foreground = os.tcgetpgrp(item['fd'])
            if foreground != os.getpgrp():
                os.killpg(foreground, signal.SIGHUP)
        except (OSError, ProcessLookupError): pass
        try: os.killpg(item['process'].pid, signal.SIGHUP)
        except ProcessLookupError: pass
        os.close(item['fd'])
        try: item['process'].wait(timeout=1)
        except subprocess.TimeoutExpired:
            item['process'].kill()
            item['process'].wait()

    def close(self):
        with self.lock:
            for session in list(self.terminals):
                self.stop_terminal(session)
