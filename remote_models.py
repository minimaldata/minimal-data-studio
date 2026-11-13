"""Project-owned BigQuery SQL drafts and explicit, recoverable publication.
No credentials or warehouse data are persisted here. SQL is preserved verbatim.
"""
import copy
import difflib
import json
import re
import threading
import time
import uuid
from pathlib import Path
from model_references import bind_references, compile_model, dependents


class RemoteModels:
    def __init__(self, project, remote):
        self.path = Path(project) / '.studio/bigquery-models.json'
        self.remote = remote
        self.lock = threading.RLock()
        self.plans = {}
        self.state = json.loads(self.path.read_text()) if self.path.exists() else {'format': 1, 'models': []}
        for model in self.state['models']:
            if not model.get('reference'):
                model['reference'] = self._new_reference(model['draft']['table'], model['draft']['connection'])

    def _new_reference(self, table, connection):
        used = {m.get('reference') for m in self.state['models'] if m['draft']['connection'] == connection}
        reference, suffix = table, 2
        while reference in used:
            reference = table + '_' + str(suffix)
            suffix += 1
        return reference

    def compile(self, request):
        with self.lock:
            model = self._get(request['id']) if request.get('id') else None
            connection = request.get('connection') or (model['draft']['connection'] if model else '')
            config=self.remote.connection(connection)
            if config.get('provider','bigquery')!='bigquery':
                raise ValueError('Managed model references are available only for BigQuery in this preview.')
            if model and connection != model['draft']['connection']:
                raise ValueError('The editor connection does not match this model.')
            sql = request.get('sql', model['draft']['sql'] if model else '')
            if not isinstance(sql, str) or len(sql) > 900_000:
                raise ValueError('Enter SQL under 900 KB.')
            result = compile_model(sql, connection, self.state['models'], model['id'] if model else None,
                                   model['draft'].get('references') if model else None)
            result['dependents'] = dependents(model['id'], self.state['models']) if model else []
            return result

    def _check_dependencies(self, client, compiled):
        for dependency in compiled['dependencies']:
            model = self._get(dependency['id'])
            if model.get('pending') or model.get('published', {}).get('jobId') != dependency['jobId']:
                raise ValueError('An upstream model changed. Review the compiled SQL again.')
            self._destination(client, model)

    def view(self):
        with self.lock:
            return copy.deepcopy(self.state)

    def _write(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temp = self.path.with_suffix('.tmp')
        temp.write_text(json.dumps(self.state, indent=2))
        temp.replace(self.path)

    def _get(self, key, revision=None):
        model = next((m for m in self.state['models'] if m['id'] == key), None)
        if not model:
            raise ValueError('This model no longer exists.')
        if revision is not None and model['revision'] != revision:
            raise ValueError('This model changed. Reopen it before saving or publishing; your editor text is still available.')
        return model

    def save(self, request):
        with self.lock:
            old = self._get(request['id']) if request.get('id') else None
            if old and (request.get('revision') is None or old.get('pending')):
                raise ValueError('Check the pending publication before editing this model.')
            draft = {k: request.get(k, '') for k in ('name', 'connection', 'dataset', 'table', 'kind', 'sql')}
            if any(not isinstance(v, str) for v in draft.values()):
                raise ValueError('Invalid model settings.')
            if not draft['name'].strip() or len(draft['name']) > 100 or len(draft['sql']) > 900_000:
                raise ValueError('Enter a model name (up to 100 characters) and SQL under 900 KB.')
            if draft['kind'] not in ('table', 'view') or any(not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', draft[k]) for k in ('dataset', 'table')):
                raise ValueError('Choose table or view and use letters, numbers and underscores for destination names.')
            config = self.remote.connection(draft['connection'])
            if config.get('provider','bigquery')!='bigquery':
                raise ValueError('Model publishing is available only for BigQuery. This connection is read-only.')
            draft['project'], draft['location'] = config['project'], config['location']
            draft['destination'] = '.'.join((config['project'], draft['dataset'], draft['table']))
            draft['references'] = bind_references(draft['sql'], draft['connection'], self.state['models'], old['draft'].get('references') if old else None, tolerant=True)
            if old and old['draft'] == draft:
                return copy.deepcopy(old)  # Idempotent retry after a reload during save.
            if old:
                self._get(old['id'], request.get('revision'))
            if old and old.get('published') and any(draft[k] != old['published'][k] for k in ('destination', 'kind', 'connection', 'location')):
                raise ValueError('A published model keeps its destination and materialization in this preview. Create a new model for a different destination or type.')
            for other in self.state['models']:
                if other is not old and other['draft']['destination'].casefold() == draft['destination'].casefold():
                    raise ValueError('Destination is already reserved by Studio model “' + other['draft']['name'] + '”: ' + draft['destination'])
            if old:
                old['draft'] = draft
                old['revision'] += 1
                model = old
            else:
                model = {'id': uuid.uuid4().hex, 'revision': 1, 'reference': self._new_reference(draft['table'], draft['connection']), 'draft': draft, 'versions': []}
                self.state['models'].append(model)
            self._write()
            return copy.deepcopy(model)

    def _destination(self, client, model):
        from google.api_core.exceptions import NotFound
        draft = model['draft']
        try:
            table = client.get_table(draft['destination'], timeout=30)
        except NotFound:
            if model.get('published'):
                raise ValueError('The published object is missing in BigQuery. It will not be recreated silently.') from None
            return None
        if not model.get('published'):
            raise ValueError('A source table or view already exists at ' + draft['destination'] + '. Choose a new name; Studio will not overwrite it.')
        if (table.labels or {}).get('studio_model') != model['id'] or table.etag != model['published']['etag']:
            raise ValueError('This object changed outside Studio (or belongs to another model). Publication stopped. Inspect it in BigQuery before continuing.')
        if table.table_type != draft['kind'].upper():
            raise ValueError('The warehouse object has a different materialization. Publication stopped.')
        return table

    def prepare(self, request):
        from remote_sources import libraries
        with self.lock:
            model = self._get(request.get('id'), request.get('revision'))
            if request.get('revision') is None or model.get('pending'):
                raise ValueError('Check the pending publication before publishing again.')
            draft = model['draft']
            compiled = self.compile({'id': model['id']})
            config = self.remote.connection(draft['connection'])
            if config.get('provider','bigquery')!='bigquery':
                raise ValueError('Model publishing is available only for BigQuery. This connection is read-only.')
            if (config['project'], config['location']) != (draft['project'], draft['location']):
                raise ValueError('Connection destination changed. Save the model settings again before publishing.')
            client = self.remote.client(config)
            try:
                dataset = client.get_dataset(config['project'] + '.' + draft['dataset'], timeout=30)
                if dataset.location.lower() != config['location'].lower():
                    raise ValueError('Destination dataset location does not match the connection.')
                self._destination(client, model)
                self._check_dependencies(client, compiled)
                bq, _ = libraries()
                check = client.query(compiled['compiledSql'], job_config=bq.QueryJobConfig(dry_run=True, use_query_cache=False), location=config['location'], timeout=30)
                if check.statement_type != 'SELECT':
                    raise ValueError('A model must contain a single SELECT query, not DDL, DML or a script.')
                estimated = check.total_bytes_processed or 0
                if estimated > config['maximumBytesBilled']:
                    raise ValueError('Query exceeds this connection’s byte limit.')
                # Embedding a validated SELECT prevents callers from supplying arbitrary DDL.
                sql = ('CREATE OR REPLACE ' if model.get('published') else 'CREATE ') + draft['kind'].upper()
                sql += ' `' + draft['destination'] + '` OPTIONS(labels=[("studio_model", "' + model['id'] + '")]) AS\n' + compiled['compiledSql']
                # Validate the exact generated statement too (including trailing comments/semicolons).
                generated = client.query(sql, job_config=bq.QueryJobConfig(dry_run=True, use_query_cache=False), location=config['location'], timeout=30)
                expected = 'CREATE_VIEW' if draft['kind'] == 'view' else 'CREATE_TABLE_AS_SELECT'
                if generated.statement_type != expected:
                    raise ValueError('The generated publication must be a single ' + expected + ' statement.')
                token = uuid.uuid4().hex
                self.plans[token] = {'id': model['id'], 'revision': model['revision'], 'sql': sql, 'compiled': compiled, 'config': config, 'expires': time.time() + 300}
                self.plans = {k: p for k, p in self.plans.items() if p['expires'] > time.time()}
                before = model.get('published', {}).get('sql', '')
                return {'token': token, 'sql': sql, **compiled, 'destination': draft['destination'], 'kind': draft['kind'], 'replacing': bool(model.get('published')), 'estimatedBytes': estimated,
                        'diff': ''.join(difflib.unified_diff(before.splitlines(True), draft['sql'].splitlines(True), fromfile='Published SQL', tofile='Draft SQL'))}
            finally:
                client.close()

    def publish(self, request, client, config):
        from remote_sources import libraries
        with self.lock:
            plan = self.plans.pop(request.get('token'), None)
            if not plan or plan['expires'] < time.time() or plan['config'] != config or request.get('confirmed') is not True:
                raise ValueError('Publication review expired or changed. Review the draft again.')
            model = self._get(plan['id'], plan['revision'])
            if model.get('pending'):
                raise ValueError('A publication is already pending.')
            current = self.compile({'id': model['id']})
            if current['compiledSql'] != plan['compiled']['compiledSql'] or current['dependencies'] != plan['compiled']['dependencies']:
                raise ValueError('An upstream model changed since review. Review the compiled SQL again.')
            self._check_dependencies(client, current)
            self._destination(client, model)  # Recheck after the confirmation, immediately before execution.
            pending = {'jobId': 'studio_model_' + uuid.uuid4().hex, 'config': config, 'draft': {**copy.deepcopy(model['draft']), **{k: current[k] for k in ('references', 'compiledSql', 'dependencies')}}, 'at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
            model['pending'] = pending
            self._write()  # Durable intent before contacting Google; restart cannot silently forget a write.
            bq, _ = libraries()
            try:
                job = client.query(plan['sql'], job_id=pending['jobId'], job_config=bq.QueryJobConfig(maximum_bytes_billed=config['maximumBytesBilled']), location=config['location'], timeout=30)
            except Exception as error:
                from google.api_core.exceptions import BadRequest, Forbidden, Unauthorized
                if isinstance(error, (BadRequest, Forbidden, Unauthorized)):
                    model.pop('pending')
                    self._write()
                    raise ValueError('BigQuery rejected the publication: ' + str(error)[:1000]) from None
                raise ValueError('Publication could not be confirmed. Use Check publication status before retrying. BigQuery job: ' + pending['jobId']) from None
            try:
                job.result(timeout=300)
            except Exception:
                raise ValueError('Publication could not be confirmed. Use Check publication status before retrying. BigQuery job: ' + pending['jobId']) from None
            return self._finish(client, model, job)

    def _finish(self, client, model, job):
        if job.error_result:
            model.pop('pending')
            self._write()
            raise ValueError('BigQuery rejected the publication: ' + str(job.error_result.get('message', 'Query failed'))[:1000])
        pending = model['pending']
        table = client.get_table(pending['draft']['destination'], timeout=30)
        if (table.labels or {}).get('studio_model') != model['id']:
            raise ValueError('Publication finished but ownership could not be verified. Check the object in BigQuery; the pending record has been retained.')
        version = {**pending['draft'], 'at': pending['at'], 'jobId': pending['jobId'], 'etag': table.etag}
        version['sqlDiff'] = ''.join(difflib.unified_diff(model.get('published', {}).get('sql', '').splitlines(True), version['sql'].splitlines(True), fromfile='Previous publication', tofile='This publication'))
        model['published'] = version
        model['versions'].append(copy.deepcopy(version))
        model.pop('pending')
        model['revision'] += 1
        self._write()
        return {'destination': version['destination'], 'model': copy.deepcopy(model)}

    def reconcile(self, request):
        with self.lock:
            model = self._get(request.get('id'))
            pending = model.get('pending')
            if not pending:
                return copy.deepcopy(model)
            client = self.remote.client(pending['config'])
            try:
                from google.api_core.exceptions import NotFound
                try:
                    job = client.get_job(pending['jobId'], project=pending['config']['project'], location=pending['config']['location'], timeout=30)
                except NotFound:
                    raise ValueError('BigQuery has no record of this job yet. Publication remains blocked to avoid an uncertain duplicate write. Check Google job history before recovery.') from None
                if job.state != 'DONE':
                    raise ValueError('BigQuery is still running this publication. Check again shortly.')
                return self._finish(client, model, job)['model']
            finally:
                client.close()
