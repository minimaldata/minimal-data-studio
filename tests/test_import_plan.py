import tempfile
from pathlib import Path
import unittest
from workspace_db import Workspace

class ImportPlan(unittest.TestCase):
    def test_name_conflict_and_exact_plan(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); file=root/'source.csv'; file.write_text('value\n42\n')
            w=Workspace(root,root,root,False,False)
            session=w.session(w.new_session()['session'])
            try:
                plan=w.plan_import(session,file,name='chosen_table')
                self.assertFalse(plan['exists'])
                self.assertIn('CREATE TABLE "chosen_table"',plan['sql'])
                self.assertEqual(session['import_plans'][plan['plan']]['sql'],plan['sql'])
                w.execute_import_plan(session,plan['plan'])
                self.assertEqual(session['conn'].execute('SELECT * FROM chosen_table').fetchall(),[(42,)])
                duplicate=w.plan_import(session,file,name='CHOSEN_TABLE')
                self.assertTrue(duplicate['exists'])
                with self.assertRaisesRegex(ValueError,'already exists'):
                    w.execute_import_plan(session,duplicate['plan'])
                delayed=w.plan_import(session,file,name='race_name')
                session['conn'].execute('CREATE VIEW race_name AS SELECT 7')
                with self.assertRaisesRegex(ValueError,'already exists'):
                    w.execute_import_plan(session,delayed['plan'])
                with self.assertRaises(ValueError):
                    w.plan_import(session,file,name='bad; DROP TABLE chosen_table')
                with self.assertRaises(ValueError):
                    w.execute_import_plan(session,'fabricated')
                self.assertEqual(session['conn'].execute('SELECT * FROM chosen_table').fetchall(),[(42,)])
            finally: w.close()
