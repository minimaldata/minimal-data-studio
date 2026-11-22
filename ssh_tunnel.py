"""One loopback forward per database connection; trust is approved by the native app."""
import base64
import hashlib
from pathlib import Path
import select
import socket
import stat
import threading

class TunnelError(ValueError):
    pass

class SSHTunnel:
    def __init__(self):
        self.transport = self.listener = self.channel = self.client = None
        self.worker = None
        self.stopped = threading.Event()

    def open(self, config, resolve):
        import paramiko
        secrets = {}
        try:
            self.transport = paramiko.Transport(socket.create_connection((config['sshHost'], config['sshPort']), timeout=15))
            self.transport.banner_timeout = self.transport.auth_timeout = 15
            self.transport.start_client(timeout=15)
            if not self.transport.is_active():
                raise TunnelError('SSH handshake did not complete. Check the SSH host and port.')
            fingerprint = 'SHA256:' + base64.b64encode(hashlib.sha256(self.transport.get_remote_server_key().asbytes()).digest()).decode().rstrip('=')
            # Native code matches saved metadata, confirms/pins the server fingerprint,
            # and authorizes credentials before any private key is used.
            try:secrets = resolve(dict(config, sshServerFingerprint=fingerprint))
            except ValueError as error:raise TunnelError(str(error)[:1200]) from None
            path = Path(config['sshKeyPath'])
            info = path.stat()
            if not stat.S_ISREG(info.st_mode) or info.st_size > 1024 * 1024 or info.st_mode & 0o077:
                raise TunnelError('SSH private key must be a regular file readable only by your Mac account. Set its permissions to 600.')
            passphrase=secrets.pop('sshPassphrase', '')
            key = paramiko.PKey.from_path(path, passphrase=passphrase.encode() if passphrase else None)
            del passphrase
            self.transport.auth_publickey(config['sshUser'], key)
            del key
            if not self.transport.is_authenticated():
                raise TunnelError('SSH key authentication was not completed.')
            self.transport.set_keepalive(30)
            self.channel = self.transport.open_channel('direct-tcpip', (config['host'], config['port']), ('127.0.0.1', 0), timeout=15)
            self.listener = socket.socket()
            self.listener.bind(('127.0.0.1', 0))
            self.listener.listen(1)
            self.listener.settimeout(15)
            port = self.listener.getsockname()[1]
            self.worker = threading.Thread(target=self._forward, daemon=True)
            self.worker.start()
            return port, secrets
        except Exception as error:
            secrets.clear()
            self.close()
            if isinstance(error, TunnelError):raise
            if isinstance(error, paramiko.PasswordRequiredException):
                raise TunnelError('This SSH key is encrypted. Choose its passphrase from Credentials in SSH tunnel settings.') from None
            if isinstance(error, paramiko.AuthenticationException):
                raise TunnelError('SSH authentication failed. Check the SSH username, private key and key passphrase.') from None
            if isinstance(error, paramiko.ChannelException):
                raise TunnelError('The SSH server could not reach the database. Check the RDS hostname, port and EC2 network access.') from None
            raise TunnelError('SSH connection failed or was not approved. Check the SSH host, port, private key, passphrase and any message in the Mac app.') from None

    def _forward(self):
        try:
            self.client, _ = self.listener.accept()
            self.listener.close()
            while not self.stopped.is_set():
                ready, _, _ = select.select([self.client, self.channel], [], [], 1)
                for source in ready:
                    data = source.recv(65536)
                    if not data:return
                    (self.channel if source is self.client else self.client).sendall(data)
        except (OSError, EOFError):
            pass
        finally:
            self.close()

    def close(self):
        self.stopped.set()
        for resource in (self.listener, self.client, self.channel, self.transport):
            if resource:
                try:resource.close()
                except Exception:pass
