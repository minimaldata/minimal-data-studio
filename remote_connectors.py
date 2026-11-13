"""Read-only DB-API connectors. Credentials stay with native SSO/libpq profiles.
SELECT validation is a product guard, not a sandbox for database functions.
"""
import datetime
import decimal
import json
import re
import threading
import time
import uuid
import pyarrow as pa

class ConnectorError(ValueError):
    pass


LABELS = {'bigquery': 'BigQuery', 'snowflake': 'Snowflake', 'postgres': 'Postgres'}
MAX_ROWS, MAX_BYTES, PREVIEW_ROWS = 100_000, 64 * 1024 * 1024, 1000


def provider(config):
    return config.get('provider', 'bigquery')


def capabilities(config):
    return {'query': True, 'snapshot': True, 'publish': provider(config) == 'bigquery', 'upload': provider(config) == 'bigquery'}


def validate_config(item):
    kind = item.get('provider', 'bigquery')
    if kind not in LABELS:
        raise ConnectorError('Choose BigQuery, Snowflake or Postgres.')
    common = {'id', 'name', 'provider'}
    fields = {'bigquery': {'project','location','maximumBytesBilled','authProfile'}, 'postgres': {'service','timeoutSeconds'},
              'snowflake': {'account','user','role','warehouse','database','timeoutSeconds','authentication','credentialId','mfaMethod'}}[kind]
    if set(item) - common - fields:
        raise ConnectorError('Only connection settings are accepted. Do not paste credentials here.')
    name = item.get('name', '')
    if not isinstance(name, str) or not name.strip() or len(name) > 80:
        raise ConnectorError('Enter a connection name up to 80 characters.')
    result = {'name': name.strip(), 'provider': kind}
    if kind == 'bigquery':
        project, location = (str(item.get(k, '')).strip() for k in ('project', 'location'))
        if not re.fullmatch(r'[a-z][a-z0-9-]{4,61}[a-z0-9]', project):
            raise ConnectorError('Enter a valid Google Cloud project ID.')
        if not re.fullmatch(r'[A-Za-z][A-Za-z0-9-]{1,40}', location):
            raise ConnectorError('Enter a dataset location, for example US or europe-west2.')
        limit = item.get('maximumBytesBilled', 1_000_000_000)
        if type(limit) is not int or not 1 <= limit <= 10**13:
            raise ConnectorError('Enter a query byte limit between 1 and 10,000,000,000,000.')
        profile=item.get('authProfile','')
        if not isinstance(profile,str) or (profile and not re.fullmatch(r'[a-f0-9]{32}',profile)):
            raise ConnectorError('Choose a Google authentication profile.')
        result.update(project=project, location=location, maximumBytesBilled=limit)
        if profile: result['authProfile']=profile
    else:
        timeout = item.get('timeoutSeconds', 60)
        if type(timeout) is not int or not 1 <= timeout <= 300:
            raise ConnectorError('Choose a query timeout between 1 and 300 seconds.')
        result['timeoutSeconds'] = timeout
        for key in fields - {'timeoutSeconds','authentication','credentialId','mfaMethod'}:
            value = item.get(key, '')
            if not isinstance(value, str) or not value.strip() or len(value) > 255 or any(ord(c) < 32 for c in value):
                raise ConnectorError('Enter ' + key + ' (up to 255 characters).')
            if key in ('service','account') and not re.fullmatch(r'[A-Za-z0-9_.-]+', value):
                raise ConnectorError('Use a profile/account identifier, not a URL or connection string.')
            result[key] = value.strip()
    if kind=='snowflake':
        auth=item.get('authentication','sso')
        if auth not in ('sso','password_mfa'):raise ConnectorError('Choose browser SSO or password + MFA.')
        result['authentication']=auth
        if auth=='password_mfa':
            key=item.get('credentialId','')
            if not isinstance(key,str) or not re.fullmatch(r'[A-Za-z0-9-]{1,100}',key):
                raise ConnectorError('Choose a Keychain password connected to this project.')
            method=item.get('mfaMethod','push')
            if method not in ('push','passcode'):raise ConnectorError('Choose MFA approval or a passcode.')
            result.update(credentialId=key,mfaMethod=method)
    return result


def select_only(sql, kind):
    if not isinstance(sql, str) or not sql.strip() or len(sql) > 900_000:
        raise ConnectorError('Enter a SELECT query under 900 KB.')
    try:
        import sqlglot
        from sqlglot import expressions as exp
        statements = [s for s in sqlglot.parse(sql, read=kind, error_message_context=0) if s is not None]
        forbidden = (exp.DDL, exp.DML, exp.Into, exp.Lock, exp.Command)
        if len(statements) != 1 or not isinstance(statements[0], exp.Query) or any(isinstance(n, forbidden) for n in statements[0].walk()):
            raise ConnectorError()
        # System commands embedded in Snowflake SELECTs can change server state.
        if kind == 'snowflake' and any(isinstance(n, exp.Anonymous) and n.name.upper().startswith('SYSTEM$') for n in statements[0].walk()):
            raise ConnectorError()
    except ImportError:
        raise ConnectorError('Install the preview connector dependencies before connecting.') from None
    except Exception:
        raise ConnectorError('This connection is read-only: run one SELECT query, with optional CTEs. Writes, scripts, SELECT INTO and locking clauses are not supported.') from None
    return sql


def quoted(value):
    return '"' + value.replace('"', '""') + '"'


def safe_error(error, kind):
    """Do not return raw driver errors: they can contain DSNs, tokens or query data."""
    if isinstance(error, ConnectorError):
        return str(error)[:1200]
    code = str(getattr(error, 'sqlstate', '') or '')
    if kind=='snowflake':
        number=str(getattr(error,'errno','') or '')
        # Only bounded numeric codes / SQLSTATE are exposed; never SDK messages or URLs.
        details=[]
        if re.fullmatch(r'[0-9]{1,8}',number):details.append('code '+number)
        if re.fullmatch(r'[A-Z0-9]{5}',code):details.append('SQLSTATE '+code)
        suffix=' ('+', '.join(details)+')' if details else ''
        if code.startswith('28') or number in ('390100','390139','390191'):
            if number=='390139':
                return 'Snowflake rejected this authentication method'+suffix+'. Ask your Snowflake administrator which sign-in methods are permitted for this user.'
            if number=='390191':
                return 'The SSO identity does not match the selected Snowflake user'+suffix+'. Sign in with the matching identity.'
            return 'Snowflake rejected sign-in'+suffix+'. Check the account identifier, your actual login username (which may differ from CURRENT_USER()), and the selected Keychain password. If these work on the Snowflake website, ask your administrator to inspect the failed login for an MFA or authentication-policy restriction.'
    else:
        suffix=''
    if code.startswith('28'):
        return 'Authentication failed. Check the username and password in your local Postgres service profile.'
    if code == '42501':
        return 'Access denied. Ask for read access to this schema/table and permission to use the query warehouse.'
    if code in ('57014', '604'):
        return 'The query was cancelled or reached its time limit.'
    if code.startswith('42'):
        return 'The query could not be resolved. Check SQL syntax, quoted identifiers, and access to the selected database/schema.'
    return LABELS[kind] + ' could not complete the request'+suffix+'. Check connectivity, authentication, database/role access and the query timeout. Driver details are withheld to avoid exposing credentials.'


def arrow_result(rows, description, kind):
    names = [d[0] for d in description]
    if len(set(names)) != len(names):
        raise ConnectorError('Result column names must be unique. Add SQL aliases before saving a snapshot.')
    arrays = []
    for index, desc in enumerate(description):
        values = [row[index] for row in rows]
        code = desc[1]
        # Common empty/all-null columns retain driver metadata instead of becoming NULL type.
        pg = {16:pa.bool_(),20:pa.int64(),21:pa.int16(),23:pa.int32(),700:pa.float32(),701:pa.float64(),17:pa.binary(),1082:pa.date32(),1114:pa.timestamp('us'),1184:pa.timestamp('us','UTC'),1083:pa.time64('us')}
        sf = {1:pa.float64(),2:pa.string(),3:pa.date32(),4:pa.timestamp('us'),6:pa.timestamp('us','UTC'),7:pa.timestamp('us','UTC'),8:pa.timestamp('us'),11:pa.binary(),12:pa.time64('us'),13:pa.bool_()}
        dtype = (pg if kind == 'postgres' else sf).get(code)
        if (kind=='postgres' and code==1700) or (kind=='snowflake' and code==0):
            precision, scale = desc[4], desc[5]
            if precision and 0 < precision <= 76 and scale is not None and scale >= 0:
                dtype = pa.decimal128(precision, scale) if precision<=38 else pa.decimal256(precision,scale)
        values = [json.dumps(v,default=str,ensure_ascii=False) if isinstance(v,(dict,list,tuple)) else str(v) if isinstance(v,uuid.UUID) else v for v in values]
        if dtype is None and any(isinstance(v,int) and not isinstance(v,bool) and abs(v)>2**63-1 for v in values):
            values = [decimal.Decimal(v) if v is not None else None for v in values]
        if not any(v is not None for v in values) and dtype is None:
            dtype = pa.string()
        try:
            arrays.append(pa.array(values,type=dtype))
        except Exception:
            raise ConnectorError('A result column could not be represented safely. Cast complex or unsupported values to text in SQL and run again.') from None
    return pa.Table.from_arrays(arrays,names=names)


class ReadOnlyConnector:
    def __init__(self, config, connect=None, credential_resolver=None, progress=None):
        self.config, self.kind = config, provider(config)
        self.progress=progress or (lambda phase: None)
        self.credential_resolver=credential_resolver
        self._connect = connect
        self.conn = None
        self.cursor = None
        self.unusable = False
        self.cancelled = threading.Event()

    def connect(self):
        if self.conn is not None:
            self.progress("connected")
            return self.conn
        try:
            if self._connect:
                self.conn = self._connect(self.config)
            elif self.kind == 'postgres':
                import psycopg
                self.conn = psycopg.connect(service=self.config['service'], connect_timeout=15,
                    sslmode='verify-full', application_name='Minimal Data Studio',
                    options='-c statement_timeout='+str(self.config['timeoutSeconds']*1000)+' -c default_transaction_read_only=on')
                self.conn.read_only = True
            else:
                import snowflake.connector
                auth={'authenticator':'externalbrowser','client_store_temporary_credential':False}
                if self.config.get('authentication')=='password_mfa':
                    if not self.credential_resolver:raise ConnectorError('Open this project from the updated Mac preview to use Keychain authentication.')
                    self.progress("credentials")
                    try:values=self.credential_resolver(self.config)
                    except ValueError as error:raise ConnectorError(str(error)) from None
                    if not isinstance(values.get('password'),str) or not values['password']:raise ConnectorError('The selected Keychain password is empty or unavailable.')
                    auth={'authenticator':'username_password_mfa','password':values.pop('password'),
                          'client_request_mfa_token':True,'client_store_temporary_credential':False}
                    if self.config.get('mfaMethod')=='passcode':
                        if not values.get('passcode'):raise ConnectorError('MFA passcode was not provided. No connection was opened.')
                        auth['passcode']=values.pop('passcode')
                    values.clear()
                try:
                    if self.cancelled.is_set():raise ConnectorError('Cancelled before authentication.')
                    self.progress("mfa_push" if self.config.get("authentication")=="password_mfa" and self.config.get("mfaMethod","push")=="push" else "signing_in")
                    self.conn = snowflake.connector.connect(account=self.config['account'], user=self.config['user'],
                    role=self.config['role'],warehouse=self.config['warehouse'],database=self.config['database'],
                    **auth,
                    login_timeout=60,network_timeout=30,client_session_keep_alive=False,
                    session_parameters={'STATEMENT_TIMEOUT_IN_SECONDS':self.config['timeoutSeconds'],'QUERY_TAG':'Minimal Data Studio preview','ABORT_DETACHED_QUERY':True})
                finally:
                    auth.clear()
                with self.conn.cursor() as cur:
                    cur.execute('USE SECONDARY ROLES NONE')
            if self.cancelled.is_set():
                raise ConnectorError('Cancelled before execution.')
            self.progress("connected")
            return self.conn
        except ImportError:
            self.progress("error")
            raise ConnectorError('This preview runtime is missing '+LABELS[self.kind]+' dependencies. Install requirements.txt in the preview environment.') from None
        except Exception as error:
            self.unusable = True
            self.progress("error")
            if str(getattr(error, 'sqlstate', '') or '').startswith(('08', '28')) or str(getattr(error, 'errno', '')) in ('390111','390112','390114','250001','250002'):
                self.unusable = True
            raise ConnectorError(safe_error(error,self.kind)) from None

    def catalog(self, schema=None):
        conn = self.connect()
        cur = conn.cursor()
        try:
            if schema is None:
                sql = ('SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN (\'pg_catalog\',\'information_schema\') AND schema_name NOT LIKE \'pg_toast%\' AND has_schema_privilege(schema_name,\'USAGE\') ORDER BY schema_name LIMIT 501' if self.kind=='postgres' else
                       'SELECT schema_name FROM '+quoted(self.config['database'])+'.information_schema.schemata WHERE schema_name <> \'INFORMATION_SCHEMA\' ORDER BY schema_name LIMIT 501')
                cur.execute(sql)
                rows=cur.fetchmany(501)
                return {'datasets':[r[0] for r in rows[:500]],'truncated':len(rows)>500}
            if not isinstance(schema,str) or not schema or len(schema)>255:
                raise ConnectorError('Choose a schema.')
            catalog = 'information_schema.tables' if self.kind=='postgres' else quoted(self.config['database'])+'.information_schema.tables'
            permissions = " AND has_table_privilege(quote_ident(table_schema)||'.'||quote_ident(table_name),'SELECT')" if self.kind=='postgres' else ''
            cur.execute('SELECT table_name, table_type FROM '+catalog+' WHERE table_schema = %s'+permissions+' ORDER BY table_name LIMIT 501',(schema,))
            rows=cur.fetchmany(501)
            tables=[]
            for name,kind in rows[:500]:
                parts=([self.config['database']] if self.kind=='snowflake' else [])+[schema,name]
                qualified='.'.join(quoted(p) for p in parts)
                tables.append({'name':name,'kind':kind,'qualified':qualified,'sql':'SELECT *\nFROM '+qualified+'\nLIMIT 1000;'})
            return {'tables':tables,'truncated':len(rows)>500}
        except Exception as error:
            if str(getattr(error, 'sqlstate', '') or '').startswith(('08', '28')) or str(getattr(error, 'errno', '')) in ('390111','390112','390114','250001','250002'):
                self.unusable = True
            raise ConnectorError(safe_error(error,self.kind)) from None
        finally:
            cur.close()

    def query(self, sql):
        sql=select_only(sql,self.kind)
        conn=self.connect()
        if self.cancelled.is_set():raise ConnectorError('Cancelled before execution.')
        cur=conn.cursor(name='studio_'+uuid.uuid4().hex) if self.kind=='postgres' else conn.cursor()
        self.cursor=cur
        rows=[];size=0;truncated=False
        deadline=time.monotonic()+self.config['timeoutSeconds']
        try:
            if self.kind=='snowflake':
                # Async submission exposes the job ID while it is running, so Cancel works.
                cur.execute_async(sql)
                while conn.is_still_running(conn.get_query_status_throw_if_error(cur.sfqid)):
                    if self.cancelled.is_set() or time.monotonic()>deadline:
                        self.cancel()
                        raise ConnectorError('The query was cancelled or reached its time limit.')
                    time.sleep(.2)
                if self.cancelled.is_set():raise ConnectorError('Query cancelled.')
                cur.get_results_from_sfqid(cur.sfqid)
            else:
                cur.execute(sql)
            while True:
                if self.cancelled.is_set():raise ConnectorError('Query cancelled.')
                if time.monotonic()>deadline:
                    self.cancel()
                    raise ConnectorError('The query reached its time limit. Filter it or increase the timeout in connection settings.')
                batch=cur.fetchmany(500)
                if not batch:break
                description=cur.description
                batch_table=arrow_result(batch,description,self.kind)
                remaining_rows=max(0,MAX_ROWS-len(rows))
                if size+batch_table.nbytes>MAX_BYTES or len(batch)>remaining_rows:
                    # Keep the largest prefix that fits, even when the first fetch
                    # batch is bigger than our budget. Never treat it as complete.
                    low,high=0,min(len(batch),remaining_rows)
                    while low<high:
                        middle=(low+high+1)//2
                        if size+batch_table.slice(0,middle).nbytes<=MAX_BYTES:low=middle
                        else:high=middle-1
                    rows.extend(batch[:low])
                    if not rows:
                        raise ConnectorError('The first result row is larger than Studio’s 64 MB preview limit. Select fewer columns or shorten large text/binary values in SQL, then run again.')
                    truncated=True
                    break
                size+=batch_table.nbytes
                rows.extend(batch)
            table=arrow_result(rows,cur.description,self.kind)
            if table.nbytes>MAX_BYTES:
                # Final type inference can use more bytes than the individual
                # batches (for example an all-null batch followed by numbers).
                low,high=0,table.num_rows
                while low<high:
                    middle=(low+high+1)//2
                    if table.slice(0,middle).nbytes<=MAX_BYTES:low=middle
                    else:high=middle-1
                if not low:
                    raise ConnectorError('The first result row is larger than Studio’s 64 MB preview limit. Select fewer columns or shorten large text/binary values in SQL, then run again.')
                # take copies the prefix instead of retaining oversized buffers.
                table=table.take(pa.array(range(low),type=pa.int64()))
                truncated=True
            row_count=getattr(cur,'rowcount',None)
            row_count=row_count if isinstance(row_count,int) and row_count>=0 else None
            return {'arrow':table.slice(0,PREVIEW_ROWS),'snapshotArrow':table if not truncated else None,'displayArrow':table,'availableRows':table.num_rows,
                    'totalRows':table.num_rows,'resultRowCount':row_count,'truncated':truncated,'jobId':getattr(cur,'sfqid',None) or uuid.uuid4().hex,
                    'project':self.config.get('database',self.config.get('service')),
                    'fetchedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
                    'warning':'Preview limit reached. Use a full transfer to save all rows as CSV or in DuckDB.' if truncated else ''}
        except Exception as error:
            if str(getattr(error, 'sqlstate', '') or '').startswith(('08', '28')) or str(getattr(error, 'errno', '')) in ('390111','390112','390114','250001','250002'):
                self.unusable = True
            raise ConnectorError(safe_error(error,self.kind)) from None
        finally:
            self.cursor=None
            cur.close()
            if self.kind=='postgres':conn.rollback()

    def stream_result(self, sql, job_id, consume):
        """Consume bounded batches; Snowflake retrieves the original persisted result.
        Postgres uses a new read-only server cursor only after explicit rerun approval.
        """
        conn=self.connect()
        cur=conn.cursor(name='studio_transfer_'+uuid.uuid4().hex) if self.kind=='postgres' else conn.cursor()
        self.cursor=cur
        try:
            if self.cancelled.is_set():raise ConnectorError('Transfer cancelled.')
            if self.kind=='snowflake':cur.get_results_from_sfqid(job_id)
            else:cur.execute(select_only(sql,self.kind))
            while True:
                if self.cancelled.is_set():raise ConnectorError('Transfer cancelled.')
                rows=cur.fetchmany(1000)
                if not rows:break
                consume(arrow_result(rows,cur.description,self.kind))
            # Retain columns even for an empty result.
            consume(arrow_result([],cur.description,self.kind),empty=True)
        except ConnectorError:raise
        except Exception as error:
            if getattr(error,'transfer_safe',False):raise
            raise ConnectorError(safe_error(error,self.kind)) from None
        finally:
            self.cursor=None;cur.close()
            if self.kind=='postgres':conn.rollback()

    def cancel(self,timeout=15):
        self.cancelled.set()
        if not self.conn:return
        try:
            if self.kind=='postgres':self.conn.cancel_safe(timeout=timeout)
            elif self.cursor and self.cursor.sfqid:
                with self.conn.cursor() as cur:cur.execute('SELECT SYSTEM$CANCEL_QUERY(%s)',(self.cursor.sfqid,),timeout=timeout)
        except Exception:
            raise ConnectorError('Cancellation was requested but could not be confirmed. The query timeout still applies.') from None

    def close(self):
        if self.conn:
            try:self.conn.close()
            except Exception:pass
            self.conn = None


class SnowflakeSessions:
    """Project-owned, in-memory sessions; one operation per connection at a time.

    Each request gets its own lease/cancellation flag. A completed request cannot
    cancel a later request that happens to reuse the same Snowflake session.
    """
    def __init__(self, factory):
        self.factory = factory
        self.lock = threading.Lock()
        self.entries = {}
        self.closed = False

    def lease(self, config):
        key = json.dumps(config, sort_keys=True)
        with self.lock:
            if self.closed:
                raise ConnectorError('Project connection has closed. Reopen the project.')
            entry = self.entries.get(key)
            if entry is None:
                entry = {'config': dict(config), 'lock': threading.Lock(), 'connector': None, 'retired': False}
                self.entries[key] = entry
        return _SnowflakeLease(self, entry)

    def invalidate(self, connection_id=None):
        with self.lock:
            for key, entry in list(self.entries.items()):
                if connection_id is None or entry['config'].get('id') == connection_id:
                    entry['retired'] = True
                    del self.entries[key]
                    if entry['lock'].acquire(blocking=False):
                        try:
                            if entry['connector']:
                                entry['connector'].close()
                                entry['connector'] = None
                        finally:
                            entry['lock'].release()

    def close(self):
        with self.lock:
            self.closed = True
        self.invalidate()


class _SnowflakeLease:
    def __init__(self, pool, entry):
        self.pool, self.entry = pool, entry
        self.cancelled = threading.Event()
        self.guard = threading.Lock()
        self.active = None

    def _call(self, method, *args):
        entry = self.entry
        while not entry['lock'].acquire(timeout=.1):
            if self.cancelled.is_set():
                raise ConnectorError('Cancelled while waiting for the Snowflake session.')
        try:
            with self.guard:
                if self.cancelled.is_set():
                    raise ConnectorError('Cancelled before execution.')
                if entry['retired'] or self.pool.closed:
                    raise ConnectorError('Connection settings changed or the project closed. Run again to reconnect.')
                connector = entry['connector']
                if connector and connector.conn is not None and connector.conn.is_closed():
                    connector.close()
                    connector = entry['connector'] = None
                if connector is None:
                    connector = entry['connector'] = self.pool.factory(entry['config'])
                connector.cancelled.clear()
                self.active = connector
            return getattr(connector, method)(*args)
        finally:
            with self.guard:
                connector = entry['connector']
                self.active = None
                if connector and (entry['retired'] or self.pool.closed or self.cancelled.is_set()
                                  or connector.cancelled.is_set() or getattr(connector, 'unusable', False) or connector.conn is None):
                    connector.close()
                    entry['connector'] = None
            entry['lock'].release()

    def catalog(self, schema=None):
        return self._call('catalog', schema)

    def query(self, sql):
        return self._call('query', sql)

    def stream_result(self, sql, job_id, consume):
        return self._call('stream_result', sql, job_id, consume)

    def cancel(self, timeout=15):
        with self.guard:
            self.cancelled.set()
            if self.active:
                self.active.cancel(timeout=timeout)

    def close(self):
        # Operation completion returns the session; only the pool owns its lifetime.
        pass
