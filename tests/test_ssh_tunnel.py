import socket
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
import paramiko
from ssh_tunnel import SSHTunnel, TunnelError
from remote_connectors import ReadOnlyConnector, validate_config, ConnectorError

class Server(paramiko.ServerInterface):
    def __init__(self, key):self.key=key;self.destination=None
    def check_auth_publickey(self, username, key):return paramiko.AUTH_SUCCESSFUL if username=='reader' and key==self.key else paramiko.AUTH_FAILED
    def get_allowed_auths(self, username):return 'publickey'
    def check_channel_direct_tcpip_request(self, chanid, origin, destination):self.destination=destination;return paramiko.OPEN_SUCCEEDED

class TunnelTests(unittest.TestCase):
    def test_encrypted_key_forward_and_cleanup(self):
        with tempfile.TemporaryDirectory() as directory:
            key=paramiko.RSAKey.generate(2048);path=Path(directory)/'hidden-key'
            key.write_private_key_file(str(path),password='dummy-passphrase');path.chmod(0o600)
            hostkey=paramiko.RSAKey.generate(2048);listener=socket.socket();listener.bind(('127.0.0.1',0));listener.listen(1);listener.settimeout(10)
            server=Server(key);transports=[]
            def run():
                client,_=listener.accept();transport=paramiko.Transport(client);transports.append(transport);transport.add_server_key(hostkey);transport.start_server(server=server)
                channel=transport.accept(10)
                if channel:
                    data=channel.recv(32);channel.sendall(data)
            thread=threading.Thread(target=run,daemon=True);thread.start()
            config=dict(sshHost='127.0.0.1',sshPort=listener.getsockname()[1],sshUser='reader',sshKeyPath=str(path),host='private-db.example',port=5432)
            calls=[]
            def resolve(config):calls.append(config);return {'password':'dummy-database','sshPassphrase':'dummy-passphrase'}
            tunnel=SSHTunnel()
            try:
                port,secrets=tunnel.open(config,resolve)
                self.assertTrue(calls[0]['sshServerFingerprint'].startswith('SHA256:'))
                self.assertEqual(secrets,{'password':'dummy-database'})
                with socket.create_connection(('127.0.0.1',port),timeout=3) as client:
                    client.sendall(b'tunnel works');self.assertEqual(client.recv(32),b'tunnel works')
                self.assertEqual(server.destination,('private-db.example',5432))
                tunnel.close();self.assertFalse(tunnel.transport.is_active())
            finally:
                tunnel.close();listener.close()
                for transport in transports:transport.close()
                thread.join(2)

    def test_denied_host_closes_before_authentication(self):
        with patch('ssh_tunnel.socket.create_connection'),patch('paramiko.Transport') as factory:
            transport=factory.return_value;transport.get_remote_server_key.return_value.asbytes.return_value=b'host'
            tunnel=SSHTunnel()
            def denied(_):raise ValueError('SSH server was not trusted.')
            with self.assertRaisesRegex(TunnelError,'not trusted'):tunnel.open(dict(sshHost='example',sshPort=22),denied)
            transport.auth_publickey.assert_not_called();transport.close.assert_called()

    def test_tls_preserves_database_hostname(self):
        config=dict(provider='postgres',preset='direct',name='RDS',host='db.example.com',port=5432,database='db',user='fuel',credentialId='dummy',sslrootcert='',timeoutSeconds=60,sshHost='jump.example.com',sshPort=22,sshUser='ec2-user',sshKeyPath='/tmp/key',sshPassphraseId='')
        self.assertEqual(validate_config(config),config)
        for change in [dict(sshPort=0),dict(sshKeyPath='relative'),dict(sshHost='https://host'),dict(sshPassphrase='secret')]:
            with self.assertRaises(ConnectorError):validate_config(dict(config,**change))
        with patch('ssh_tunnel.SSHTunnel') as factory,patch('psycopg.connect') as connect:
            factory.return_value.open.return_value=(54321,{'password':'dummy'})
            connector=ReadOnlyConnector(config,credential_resolver=lambda _:{});connector.connect()
            settings=connect.call_args.kwargs
            self.assertEqual(settings['host'],'db.example.com');self.assertEqual(settings['hostaddr'],'127.0.0.1');self.assertEqual(settings['port'],54321);self.assertEqual(settings['sslmode'],'verify-full')
            connector.close();factory.return_value.close.assert_called()
