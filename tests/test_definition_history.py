import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from workspace_db import Workspace


class DefinitionHistoryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.ws = Workspace(self.root, self.root, seed_samples=False)
        self.session = self.ws.session(self.ws.new_session()['session'])

    def tearDown(self):
        self.ws.close()
        self.tmp.cleanup()

    def sql(self, sql):
        self.ws.query(self.session, sql)

    def info(self, name='answer'):
        return self.ws.definition_info(self.session, name)

    def apply(self, query='SELECT 2 AS value', kind='table', **kw):
        return self.ws.apply_definition(self.session, dict(name='answer', base=self.info()['current']['id'], query=query, kind=kind, **kw))

    def test_sql_edit_restore_and_restart(self):
        self.sql('CREATE TABLE answer AS SELECT 1 AS value')
        first = self.info()['current']
        self.assertEqual(first['query'], 'SELECT 1 AS value')
        updated = self.apply()
        self.assertEqual(len(updated['versions']), 2)
        self.assertIn('+SELECT 2 AS value', updated['current']['diff'])
        restored = self.apply(restore=first['id'])
        self.assertEqual(len(restored['versions']), 3)
        self.assertEqual(restored['current']['restoredFrom'], first['id'])
        self.assertEqual(self.session['conn'].execute('SELECT * FROM answer').fetchone(), (1,))
        self.ws.close()
        self.ws = Workspace(self.root, self.root, seed_samples=False)
        self.session = self.ws.session(self.ws.new_session()['session'])
        self.assertEqual(len(self.info()['versions']), 3)

    def test_restore_uses_current_data_and_converts_storage(self):
        self.sql('CREATE TABLE source AS SELECT 1 AS value')
        self.sql('CREATE VIEW answer AS SELECT * FROM source')
        first = self.info()['current']
        self.apply('SELECT value + 1 AS value FROM source')
        self.sql('INSERT INTO source VALUES (3)')
        result = self.apply(restore=first['id'])
        self.assertEqual(result['kind'], 'view')
        self.assertEqual(self.session['conn'].execute('SELECT * FROM answer ORDER BY value').fetchall(), [(1,), (3,)])

    def test_failure_and_stale_edit_leave_object_intact(self):
        self.sql('CREATE TABLE answer AS SELECT 1 AS value')
        first = self.info()['current']['id']
        with self.assertRaises(Exception):
            self.apply('SELECT * FROM missing_relation')
        self.assertEqual(self.info()['current']['id'], first)
        self.assertEqual(self.session['conn'].execute('SELECT * FROM answer').fetchone(), (1,))
        self.apply()
        with self.assertRaisesRegex(ValueError, 'changed in another tab'):
            self.ws.apply_definition(self.session, dict(name='answer',base=first,query='SELECT 7',kind='table'))
        with self.assertRaises(ValueError):
            self.apply('SELECT 1; DROP TABLE answer')
        self.assertEqual(self.session['conn'].execute('SELECT * FROM answer').fetchone(), (2,))

    def test_editor_view_changes_and_existing_table_origin(self):
        self.session['conn'].execute('CREATE TABLE old_table (id INTEGER)')
        self.assertIsNone(self.info('old_table')['current']['query'])
        self.sql('CREATE VIEW answer AS SELECT 1 AS value')
        self.sql('CREATE OR REPLACE VIEW answer AS SELECT 3 AS value')
        self.assertEqual(len(self.info()['versions']), 2)
        self.assertIn('3', self.info()['current']['query'])
        self.sql('DROP VIEW answer')
        self.sql('CREATE TABLE answer AS SELECT 4 AS value')
        self.assertEqual(len(self.info()['versions']), 1)

    def test_comments_reserved_names_and_data_changes(self):
        self.sql('-- lesson query\nCREATE TABLE "select" AS SELECT 1 AS value')
        info = self.info('select')
        self.assertEqual(info['current']['query'], 'SELECT 1 AS value')
        self.sql('INSERT INTO "select" VALUES (2)')
        self.assertEqual(len(self.info('select')['versions']), 1)
        self.ws.apply_definition(self.session, dict(name='select', base=info['current']['id'], query='SELECT 3 AS value', kind='view'))
        self.assertEqual(self.info('select')['kind'], 'view')

    def test_original_sql_formatting_survives_versions_and_restart(self):
        original = "\n-- Keep the teaching notes\nSELECT\n    1 AS value;\n\n"
        self.sql('CREATE VIEW answer AS ' + original)
        self.assertEqual(self.info()['current']['query'], original)
        edited = "\n  -- New explanation\nSELECT\n\t2 AS value;\n"
        version = self.apply(edited, kind='view')['current']
        self.assertEqual(version['query'], edited)
        self.apply('SELECT 3 AS value', kind='view')
        restored = self.apply(restore=version['id'])
        self.assertEqual(restored['current']['query'], edited)
        self.ws.close()
        self.ws = Workspace(self.root, self.root, seed_samples=False)
        self.session = self.ws.session(self.ws.new_session()['session'])
        self.assertEqual(self.info()['current']['query'], edited)

    def test_no_definition_cannot_be_replaced_or_restored(self):
        file = self.root / 'test.csv'
        file.write_text('value\n1\n')
        self.ws.import_path(self.session, file, name='answer')
        original = self.info()
        for kind in ('table', 'view'):
            for extra in ({}, {'restore': original['current']['id']}):
                with self.assertRaisesRegex(ValueError, 'no saved SQL definition'):
                    self.apply(kind=kind, **extra)
                self.assertEqual(self.session['conn'].execute('SELECT * FROM answer').fetchall(), [(1,)])
                self.assertEqual(self.info(), original)

    def test_import_origin_has_no_temporary_sql(self):
        file = self.root / 'test.csv'
        file.write_text('value\n1\n')
        self.ws.import_path(self.session, file, name='answer')
        info = self.info()
        self.assertIsNone(info['current']['query'])
        self.assertIn('test.csv', info['current']['origin'])


if __name__ == '__main__':
    unittest.main()
