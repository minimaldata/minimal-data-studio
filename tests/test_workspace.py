"""Native database and migration checks in disposable workspaces."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
import uuid

import pyarrow as pa
import pyarrow.parquet as pq
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from workspace_db import Workspace


class WorkspaceChecks(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / 'data').mkdir()
        self.ws = None

    def tearDown(self):
        if self.ws:
            self.ws.close()
        self.tmp.cleanup()

    def start(self):
        if self.ws:
            self.ws.close()
        self.ws = Workspace(self.root, self.root / 'data')
        return self.ws.session(self.ws.new_session()['session'])

    def query(self, session, sql):
        return pa.ipc.open_stream(self.ws.query(session, sql)).read_all().to_pylist()

    def test_file_table_links_survive_restart_and_rename(self):
        session = self.start()
        file = self.root / 'data' / 'lesson.csv'
        file.write_text('value\n42\n')
        self.ws.import_path(session, file)
        self.ws.import_path(session, file, name='lesson_2')
        self.assertEqual(self.ws.file_tables(session)['data/lesson.csv'], ['lesson', 'lesson_2'])
        session = self.start()
        self.query(session, 'ALTER TABLE lesson RENAME TO renamed')
        self.assertEqual(set(self.ws.file_tables(session)['data/lesson.csv']), {'renamed', 'lesson_2'})
        self.query(session, 'DROP TABLE renamed')
        self.query(session, 'DROP TABLE lesson_2')
        self.query(session, 'CREATE TABLE lesson (value INTEGER)')
        self.assertEqual(self.ws.file_tables(session), {})

    def legacy(self, name, kind='table', sql=None):
        directory = self.root / '.relations'
        directory.mkdir(exist_ok=True)
        record = {'id': uuid.uuid4().hex, 'name': name, 'kind': kind}
        if sql:
            record['sql'] = sql
        else:
            pq.write_table(pa.table({'id': [1, 2], 'label': ['00123', None]}), directory / (record['id'] + '.parquet'))
        (directory / (name + '.json')).write_text(json.dumps(record))
        return record

    def test_migrate_dependencies_and_do_not_resurrect_deleted_objects(self):
        self.legacy('saved_table')
        self.legacy('a_second_view', 'view', 'CREATE VIEW a_second_view AS SELECT * FROM z_first_view')
        self.legacy('z_first_view', 'view', 'CREATE VIEW z_first_view AS SELECT * FROM saved_table')
        s = self.start()
        self.assertEqual(self.ws.warnings, [])
        expected = [{'id': 1, 'label': '00123'}, {'id': 2, 'label': None}]
        self.assertEqual(self.query(s, 'SELECT * FROM a_second_view'), expected)
        self.assertTrue((self.root / '.studio/migration-backup/saved_table.json').exists())
        self.query(s, "UPDATE saved_table SET label='updated' WHERE id=1")
        self.query(s, 'DROP VIEW a_second_view')
        s = self.start()
        self.assertEqual(self.query(s, 'SELECT label FROM saved_table WHERE id=1'), [{'label': 'updated'}])
        with self.assertRaises(Exception):
            self.query(s, 'SELECT * FROM a_second_view')
        self.assertEqual(len(list((self.root / '.relations').glob('*.json'))), 3)

    def test_failed_migration_preserves_original_and_retries(self):
        self.legacy('dependent', 'view', 'CREATE VIEW dependent AS SELECT * FROM missing_source')
        s = self.start()
        self.assertTrue(self.ws.warnings)
        self.query(s, 'CREATE TABLE missing_source AS SELECT 7 AS value')
        s = self.start()
        self.assertEqual(self.ws.warnings, [])
        self.assertEqual(self.query(s, 'SELECT * FROM dependent'), [{'value': 7}])

    def test_bootstrap_is_one_time_and_deleted_tables_stay_deleted(self):
        (self.root / 'datasets.json').write_text('{"sample":"sample.csv"}')
        (self.root / 'data/sample.csv').write_text('id\n1\n')
        (self.root / 'views.sql').write_text('CREATE VIEW initial_view AS SELECT * FROM sample;')
        s = self.start()
        self.query(s, 'DROP VIEW initial_view')
        self.query(s, 'DROP TABLE sample')
        s = self.start()
        self.assertEqual(self.query(s, "SELECT table_name FROM information_schema.tables WHERE table_schema='main'"), [])

    def test_temporary_tables_and_transactions_are_connection_scoped(self):
        a = self.start()
        b = self.ws.session(self.ws.new_session()['session'])
        self.query(a, 'CREATE TABLE shared AS SELECT 1 AS value')
        self.query(a, 'CREATE TEMP TABLE scratch AS SELECT 2 AS value')
        with self.assertRaises(Exception):
            self.query(b, 'SELECT * FROM scratch')
        self.query(a, 'BEGIN')
        self.query(a, 'UPDATE shared SET value=9')
        self.assertEqual(self.query(b, 'SELECT * FROM shared'), [{'value': 1}])
        self.query(a, 'ROLLBACK')
        self.query(a, 'ALTER TABLE shared ADD COLUMN note VARCHAR')
        s = self.start()
        self.assertEqual(self.query(s, 'SELECT * FROM shared'), [{'value': 1, 'note': None}])
        with self.assertRaises(Exception):
            self.query(s, 'SELECT * FROM scratch')

    def test_import_formats_collisions_and_failure_atomicity(self):
        s = self.start()
        self.assertEqual(self.ws.import_file(s, 'sample.csv', b'id,label\n1,alpha\n2,\n')['name'], 'sample')
        with self.assertRaisesRegex(ValueError, 'already exists'):
            self.ws.import_file(s, 'sample.tsv', b'id\tlabel\n3\tbeta\n')
        self.assertEqual(self.ws.import_file(s, 'sample_2.tsv', b'id\tlabel\n3\tbeta\n')['name'], 'sample_2')
        self.ws.import_file(s, 'nested.json', b'[{"id":4,"label":"gamma"}]')
        with self.assertRaises(Exception):
            self.ws.import_file(s, 'broken.parquet', b'bad parquet')
        s = self.start()
        self.assertEqual(self.query(s, 'SELECT * FROM sample'), [{'id':1, 'label':'alpha'}, {'id':2, 'label':None}])
        self.assertEqual(self.query(s, 'SELECT * FROM sample_2'), [{'id':3, 'label':'beta'}])
        self.assertEqual(self.query(s, 'SELECT * FROM nested'), [{'id':4, 'label':'gamma'}])
        with self.assertRaises(Exception):
            self.query(s, 'SELECT * FROM broken')

    def test_migration_collision_never_overwrites_live_data(self):
        s = self.start()
        self.query(s, "CREATE TABLE saved_table AS SELECT 99 AS id, 'keep' AS label")
        record = self.legacy('saved_table')
        s = self.start()
        self.assertTrue(self.ws.warnings)
        self.assertFalse(self.ws.imported('legacy:' + record['id']))
        self.assertEqual(self.query(s, 'SELECT * FROM saved_table'), [{'id':99, 'label':'keep'}])

    def test_corrupt_legacy_table_does_not_block_valid_migration(self):
        good = self.legacy('good')
        bad = self.legacy('bad')
        (self.root / '.relations' / (bad['id'] + '.parquet')).write_bytes(b'bad file')
        s = self.start()
        self.assertTrue(self.ws.imported('legacy:' + good['id']))
        self.assertFalse(self.ws.imported('legacy:' + bad['id']))
        self.assertEqual(len(self.query(s, 'SELECT * FROM good')), 2)
        self.assertTrue(self.ws.warnings)

    def test_arrow_snapshot_empty_schema_and_precise_types(self):
        s = self.start()
        body = self.ws.query(s, "SELECT 9007199254740993::BIGINT AS large, 12.345::DECIMAL(9,3) AS amount, NULL::VARCHAR AS label")
        self.ws.arrow_table(s, 'staging', body)
        self.query(s, 'CREATE TABLE frozen AS SELECT * FROM staging')
        self.query(s, 'CREATE TABLE empty_table AS SELECT * FROM frozen WHERE false')
        s = self.start()
        rows = self.query(s, 'SELECT * FROM frozen')
        self.assertEqual(rows[0]['large'], 9007199254740993)
        self.assertEqual(str(rows[0]['amount']), '12.345')
        empty = pa.ipc.open_stream(self.ws.query(s, 'SELECT * FROM empty_table')).read_all()
        self.assertEqual(empty.num_rows, 0)
        self.assertEqual(empty.schema.names, ['large', 'amount', 'label'])


if __name__ == '__main__':
    unittest.main()
