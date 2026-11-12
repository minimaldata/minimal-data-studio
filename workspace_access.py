"""One cooperative browser writer per local project, with synchronized lease operations."""
import secrets
import time
import threading
import functools

def locked(method):
    @functools.wraps(method)
    def call(self,*args,**kwargs):
        with self.lock:return method(self,*args,**kwargs)
    return call

class WorkspaceAccess:
    def __init__(self, clock=time.monotonic, ttl=30):
        self.lock=threading.RLock(); self.clock=clock; self.ttl=ttl; self.clients={}; self.owner=None; self.pending=None
        self.enabled=False; self.tickets={}; self.changes=0

    def expire(self):
        now=self.clock()
        self.clients={key:seen for key,seen in self.clients.items() if now-seen<self.ttl}
        if self.owner not in self.clients: self.owner=None
        if self.pending not in self.clients: self.pending=None
        if self.owner is None and self.pending:
            self.owner=self.pending;self.pending=None
        self.tickets={key:value for key,value in self.tickets.items() if now-value[1]<self.ttl}

    @locked
    def writable(self, client):
        self.expire()
        return not self.enabled or bool(client and client==self.owner)

    @locked
    def handle(self, client, action='heartbeat', ticket=None):
        if not isinstance(client,str) or not 8<=len(client)<=100: raise ValueError('Invalid browser identity.')
        self.enabled=True; self.expire(); self.clients[client]=self.clock()
        if action=='hello':
            grant=self.tickets.pop(ticket,None) if isinstance(ticket,str) else None
            if grant and self.owner==grant[0]: self.owner=client
            elif self.owner is None: self.owner=client
        elif action=='request':
            if self.owner is None: self.owner=client
            elif self.owner!=client:
                if self.pending not in (None,client): raise ValueError('Another tab is already waiting to edit. Try again shortly.')
                self.pending=client
        elif action=='yield':
            if self.owner!=client: raise ValueError('This tab no longer owns editing.')
            if self.pending:
                self.owner=self.pending; self.pending=None
        elif action=='cancel':
            if self.pending==client:self.pending=None
        elif action=='release':
            self.clients.pop(client,None)
            if self.owner==client:self.owner=None
            if self.pending==client:self.pending=None
        elif action not in ('heartbeat','ticket'): raise ValueError('Unknown workspace action.')
        result={'writer':self.owner==client,'tabs':len(self.clients),'requested':self.pending is not None and self.owner==client,
                'waiting':self.pending==client,'available':self.owner is None,'changes':self.changes}
        if action=='ticket' and self.owner!=client:raise ValueError('Editing is still in another tab.')
        if self.owner==client and action in ('hello','heartbeat','ticket'):
            token=secrets.token_urlsafe(32);self.tickets[token]=(client,self.clock());result['ticket']=token
        return result
