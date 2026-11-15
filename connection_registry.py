"""Mac-local shared connection settings; project files contain portable links only."""
import contextlib
import fcntl
import json
import os
from pathlib import Path
import uuid
from remote_connectors import validate_config


def registry_root():
    if os.environ.get('MDS_CONNECTIONS_DIR'):
        return Path(os.environ['MDS_CONNECTIONS_DIR'])
    if os.environ.get('MDS_PROJECT_REGISTRY'):
        return Path(os.environ['MDS_PROJECT_REGISTRY']).parent/'connections'
    return Path.home()/'Library/Application Support/Minimal Data Studio/connections'


def atomic(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp=path.with_name(path.name+'.'+uuid.uuid4().hex+'.tmp')
    try:
        with open(temp,'x') as f:
            os.chmod(temp,0o600);json.dump(value,f,indent=2);f.flush();os.fsync(f.fileno())
        temp.replace(path)
    finally:temp.unlink(missing_ok=True)


class ConnectionRegistry:
    def __init__(self, root=None):
        self.root=Path(root) if root is not None else registry_root()
        self.path=self.root/'connections.json'

    @contextlib.contextmanager
    def locked(self):
        self.root.mkdir(parents=True,exist_ok=True,mode=0o700)
        with open(self.root/'.lock','a') as guard:
            fcntl.flock(guard,fcntl.LOCK_EX)
            state=json.loads(self.path.read_text()) if self.path.exists() else {'revision':0,'connections':[],'projects':{},'migrations':{}}
            yield state

    def write(self,state):
        state['revision']+=1;atomic(self.path,state)

    def view(self):
        with self.locked() as state:
            result={'revision':state['revision'],'connections':[]}
            for c in state['connections']:
                used=[{'path':p,'name':Path(p).name} for p,refs in state['projects'].items() if c['id'] in refs.values()]
                result['connections'].append(dict(c,projects=used))
            return result

    def save(self,request):
        with self.locked() as state:
            if request.get('revision')!=state['revision']:raise ValueError('Connections changed in another window. Refresh and try again.')
            item=request.get('connection',{});clean=validate_config(item)
            key=item.get('id') or uuid.uuid4().hex
            old=next((c for c in state['connections'] if c['id']==key),None)
            if item.get('id') and not old:raise ValueError('Connection no longer exists.')
            if old and old['provider']!=clean['provider']:raise ValueError('Create a separate connection to change providers.')
            if any(c['id']!=key and c['name'].casefold()==clean['name'].casefold() for c in state['connections']):raise ValueError('That connection name is already used on this Mac.')
            used=[p for p,r in state['projects'].items() if key in r.values()]
            if old and used and request.get('confirmed') is not True:raise ValueError('Confirm that this change applies to every project using the connection.')
            clean['id']=key;state['connections']=[c for c in state['connections'] if c['id']!=key]+[clean];self.write(state)
            return dict(clean)

    def delete(self,request):
        with self.locked() as state:
            if request.get('revision')!=state['revision']:raise ValueError('Connections changed. Refresh and try again.')
            if request.get('confirmed') is not True:raise ValueError('Confirm deletion from this Mac. Project links will need reconnection.')
            state['connections']=[c for c in state['connections'] if c['id']!=request.get('id')];self.write(state)
        return self.view()

    def project(self,path):
        path=Path(path);project=str(path.parent.parent.resolve())
        with self.locked() as state:
            links=json.loads(path.read_text()) if path.exists() else {'revision':0,'connections':[]}
            if links.get('format')!=2:
                migrated=[]
                for item in links['connections']:
                    marker=project+'\n'+item['id'];key=state['migrations'].get(marker)
                    if not key:
                        clean=validate_config(item);key=uuid.uuid4().hex
                        base=clean['name'];name=base;n=2
                        while any(c['name'].casefold()==name.casefold() for c in state['connections']):name=base+' ('+str(n)+')';n+=1
                        clean.update(id=key,name=name);state['connections'].append(clean);state['migrations'][marker]=key
                    migrated.append(self.link(item,key))
                links={'format':2,'revision':links['revision'],'connections':migrated}
                state['projects'][project]={c['id']:c['connectionId'] for c in migrated}
                self.write(state) # Save central settings first, so interrupted migration is retryable.
                atomic(path,links)
            refs={c['id']:c['connectionId'] for c in links['connections']}
            if state['projects'].get(project)!=refs:state['projects'][project]=refs;self.write(state)
            configs={c['id']:c for c in state['connections']};resolved=[]
            for ref in links['connections']:
                c=configs.get(ref['connectionId'])
                resolved.append(dict(c or ref,id=ref['id'],sharedId=ref['connectionId'],missing=c is None))
            return {'revision':links['revision'],'connections':resolved,'centralRevision':state['revision']}

    @staticmethod
    def link(c,key):
        return {k:v for k,v in dict(id=c['id'],connectionId=key,name=c['name'],provider=c.get('provider','bigquery'),preset=c.get('preset')).items() if v is not None}

    def attach(self,path,request):
        self.project(path)
        with self.locked() as state:
            links=json.loads(path.read_text())
            if request.get('revision')!=links['revision']:raise ValueError('Project connections changed. Refresh and try again.')
            c=next((c for c in state['connections'] if c['id']==request.get('connectionId')),None)
            if c is None:raise ValueError('Choose an available connection on this Mac.')
            local=request.get('replace') or c['id']
            old=next((r for r in links['connections'] if r['id']==local),None)
            if request.get('replace') and (not old or request.get('confirmed') is not True):raise ValueError('Confirm which connection should replace this project link.')
            if old and old['provider']!=c['provider']:raise ValueError('Reconnect using the same database provider.')
            if any(r['connectionId']==c['id'] and r['id']!=local for r in links['connections']):raise ValueError('This connection is already added to this project.')
            ref=self.link(dict(c,id=local),c['id']);links['connections']=[r for r in links['connections'] if r['id']!=local]+[ref];links['revision']+=1
            state['projects'][str(path.parent.parent.resolve())]={r['id']:r['connectionId'] for r in links['connections']}
            self.write(state);atomic(path,links)
        return self.project(path)

    def detach(self,path,request):
        self.project(path)
        with self.locked() as state:
            links=json.loads(path.read_text())
            if request.get('revision')!=links['revision']:raise ValueError('Project connections changed. Refresh and try again.')
            links['connections']=[r for r in links['connections'] if r['id']!=request.get('id')];links['revision']+=1
            state['projects'][str(path.parent.parent.resolve())]={r['id']:r['connectionId'] for r in links['connections']};self.write(state);atomic(path,links)
        return self.project(path)
