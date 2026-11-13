"""Per-user Google identities. Tokens never enter project state or HTTP responses.

Each profile uses an isolated gcloud ADC store. Google sign-in runs in a private
staging directory; only a verified identity is committed. No process-global ADC
or environment changes are made when resolving a connection.
"""
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import threading
import uuid

SCOPES = ['openid', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/cloud-platform']


def profile_root():
    return Path(os.environ.get('MDS_GOOGLE_PROFILES_DIR') or (Path.home() / 'Library/Application Support/Minimal Data Studio/google-profiles'))


def user_credentials(info):
    from google.oauth2.credentials import Credentials
    if info.get('type') != 'authorized_user':
        raise ValueError('Choose a Google user account. Service-account files are not supported by authentication profiles.')
    # Reconstruct rather than accepting arbitrary token endpoints from a file.
    clean = {key: info[key] for key in ('client_id', 'client_secret', 'refresh_token')}
    return Credentials.from_authorized_user_info(clean, scopes=SCOPES)


def verify_identity(credentials):
    from google.auth.transport.requests import AuthorizedSession
    session = AuthorizedSession(credentials)
    try:
        response = session.get('https://www.googleapis.com/oauth2/v2/userinfo', timeout=25)
        response.raise_for_status()
        data = response.json()
        email = data.get('email', '')
        if data.get('verified_email') is not True or not re.fullmatch(r'[^\s@]+@[^\s@]+', email):
            raise ValueError('Google did not return a verified account email.')
        return email
    finally:
        session.close()


class GoogleProfiles:
    def __init__(self, root=None, identity=None, runner=None):
        self.root = Path(root) if root is not None else profile_root()
        self.identity = identity or verify_identity
        self.runner = runner or subprocess.run
        self.lock = threading.RLock()
        self.jobs = {}

    def directory(self, key):
        if not isinstance(key, str) or not re.fullmatch(r'[a-f0-9]{32}', key):
            raise ValueError('Choose a Google authentication profile.')
        path = self.root / key
        if path.is_symlink():
            raise ValueError('Google authentication profile is unavailable.')
        return path

    def metadata(self, key):
        try:
            data = json.loads((self.directory(key) / 'profile.json').read_text())
            return {'id': key, 'name': data['name'], 'account': data['account']}
        except (OSError, KeyError, json.JSONDecodeError):
            raise ValueError('Google authentication profile is missing on this Mac. Choose or add an account in connection settings.') from None

    def view(self):
        profiles = []
        if self.root.exists():
            for path in self.root.iterdir():
                if re.fullmatch(r'[a-f0-9]{32}', path.name):
                    try: profiles.append(self.metadata(path.name))
                    except ValueError: pass
        return {'profiles': sorted(profiles, key=lambda p: (p['name'].casefold(), p['account']))}

    def credentials(self, key, quota_project):
        self.metadata(key)  # A pending or failed login is never usable.
        try:
            path = self.directory(key) / 'application_default_credentials.json'
            if path.is_symlink(): raise ValueError()
            credentials = user_credentials(json.loads(path.read_text()))
            return credentials.with_quota_project(quota_project)
        except Exception:
            raise ValueError('This Google profile needs to sign in again. Open connection settings and reconnect its account. No default account was used.') from None

    def start(self, request, owner):
        mode = request.get('mode', 'login')
        if mode not in ('login', 'import'): raise ValueError('Choose Google sign-in or copy current ADC.')
        name = request.get('name', '').strip() if isinstance(request.get('name'), str) else ''
        if not name or len(name) > 100 or any(ord(c) < 32 for c in name):
            raise ValueError('Enter a profile name of up to 100 characters.')
        existing = self.metadata(request['profile']) if request.get('profile') else None
        with self.lock:
            if any(j['state'] == 'running' for j in self.jobs.values()):
                raise ValueError('A Google sign-in is already in progress. Finish it in your browser first.')
            if len(self.jobs) > 20: self.jobs = {k:v for k,v in self.jobs.items() if v['state']=='running'}
            token = uuid.uuid4().hex
            self.jobs[token] = {'state': 'running', 'owner': owner}
        threading.Thread(target=self._run, args=(token, name, mode, existing), daemon=True).start()
        return {'id': token}

    def status(self, token, owner):
        with self.lock:
            job = self.jobs.get(token)
            if not job or job['owner'] != owner: raise ValueError('Google sign-in belongs to another editor or has expired.')
            return {k:v for k,v in job.items() if k != 'owner'}

    def _run(self, token, name, mode, existing):
        stage = None
        guard = None
        error = 'Google sign-in could not finish. Try again and complete sign-in in your browser. Your existing accounts were not changed.'
        try:
            self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
            if self.root.is_symlink(): raise ValueError()
            self.root.chmod(0o700)
            guard = open(self.root / '.login.lock', 'a')
            try: fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                error = 'Another Studio project is signing into Google. Finish that sign-in first.'
                raise ValueError()
            stage = self.root / ('.pending-' + uuid.uuid4().hex)
            stage.mkdir(mode=0o700)
            adc = stage / 'application_default_credentials.json'
            if mode == 'login':
                executable = shutil.which('gcloud') or next((p for p in ('/opt/homebrew/bin/gcloud', '/usr/local/bin/gcloud', str(Path.home()/'google-cloud-sdk/bin/gcloud')) if Path(p).is_file()), None)
                if not executable:
                    error = 'Install the Google Cloud CLI first, then try Add Google account again.'
                    raise ValueError()
                env = {k:v for k,v in os.environ.items() if not k.startswith(('CLOUDSDK_', 'GOOGLE_'))}
                env['CLOUDSDK_CONFIG'] = str(stage)
                env['CLOUDSDK_CORE_DISABLE_USAGE_REPORTING'] = 'true'
                command = [executable, 'auth', 'application-default', 'login', '--quiet', '--disable-quota-project', '--scopes='+','.join(SCOPES)]
                if existing: command.append(existing['account'])
                self.runner(command, env=env, cwd=str(stage), stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=300, check=True)
                info = json.loads(adc.read_text())
            else:
                # Explicit user action: copy the current user ADC without changing it.
                source = Path(os.environ.get('GOOGLE_APPLICATION_CREDENTIALS') or (Path(os.environ.get('CLOUDSDK_CONFIG', str(Path.home()/'.config/gcloud'))) / 'application_default_credentials.json'))
                info = json.loads(source.read_text())
            credentials = user_credentials(info)
            account = self.identity(credentials)
            if existing and account.casefold() != existing['account'].casefold():
                error = 'That is a different Google account. Reconnect using the original account, or add a new profile. Existing connections were not changed.'
                raise ValueError()
            # Store only canonical authorized-user material, not CLI logs or credentials DBs.
            clean = {'type':'authorized_user', **{k:info[k] for k in ('client_id','client_secret','refresh_token')}}
            key = existing['id'] if existing else uuid.uuid4().hex
            destination = self.directory(key)
            destination.mkdir(mode=0o700, exist_ok=True)
            for filename, data in [('application_default_credentials.json', clean), ('profile.json', {'name':existing['name'] if existing else name,'account':account})]:
                temporary = destination / ('.write-' + uuid.uuid4().hex)
                fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(fd, 'w') as stream: json.dump(data, stream)
                temporary.replace(destination / filename)
            with self.lock: self.jobs[token].update(state='done', profile=self.metadata(key))
        except Exception:
            with self.lock: self.jobs[token].update(state='error', error=error)
        finally:
            if stage: shutil.rmtree(stage, ignore_errors=True)
            if guard: guard.close()
