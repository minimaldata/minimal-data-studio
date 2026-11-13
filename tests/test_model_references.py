import copy
import unittest
from model_references import reference_tokens, compile_model, bind_references, dependents


def model(key, name, sql='SELECT 1', published=True):
    draft = dict(name=name, connection='conn', sql=sql, destination='example-project.sandbox.'+name, kind='view', references={})
    item = dict(id=key*32, reference=name, draft=draft)
    if published:item['published']={**copy.deepcopy(draft), 'etag':key, 'jobId':'job-'+key}
    return item


class ReferenceChecks(unittest.TestCase):
    def test_preserves_sql_and_ignores_quoted_and_commented_braces(self):
        source = "SELECT '{{ no }}', r\"{{ no }}\", '''{{ no }}''', `{{ no }}`\n-- {{ no }}\n# {{ no }}\n/* {{ no }} */\nFROM {{ costs }} AS c;\n"
        m=model('a','costs')
        result=compile_model(source,'conn',[m])
        self.assertEqual(result['compiledSql'],source.replace('FROM {{ costs }}','FROM `example-project.sandbox.costs`'))
        self.assertEqual(result['references'],{'costs':m['id']})
        self.assertEqual(len(result['dependencies']),1)
    def test_stable_binding_survives_display_rename_and_does_not_retarget(self):
        m=model('a','costs');bindings=bind_references('SELECT * FROM {{ costs }}','conn',[m])
        m['draft']['name']='Renamed costs'
        self.assertIn('sandbox.costs',compile_model('SELECT * FROM {{ costs }}','conn',[m],previous=bindings)['compiledSql'])
        replacement=model('b','costs')
        with self.assertRaisesRegex(ValueError,'no longer exists'):compile_model('SELECT * FROM {{ costs }}','conn',[replacement],previous=bindings)
    def test_missing_unpublished_and_wrong_connection(self):
        m=model('a','costs',published=False)
        with self.assertRaisesRegex(ValueError,'Publish costs first'):compile_model('FROM {{ costs }}','conn',[m])
        with self.assertRaisesRegex(ValueError,'Unknown'):compile_model('FROM {{ missing }}','conn',[m])
        with self.assertRaisesRegex(ValueError,'same BigQuery'):compile_model('FROM {{ costs }}','other',[m],previous={'costs':m['id']})
    def test_self_cycle_and_indirect_cycle(self):
        a=model('a','alpha','SELECT * FROM {{ beta }}');b=model('b','beta','SELECT * FROM {{ alpha }}')
        with self.assertRaisesRegex(ValueError,'Circular'):compile_model(a['draft']['sql'],'conn',[a,b],owner=a['id'])
        with self.assertRaisesRegex(ValueError,'alpha → alpha'):compile_model('FROM {{ alpha }}','conn',[a],owner=a['id'])
    def test_unpublished_upstream_edits_cannot_hide_live_cycle(self):
        a=model('a','alpha','SELECT * FROM {{ beta }}');b=model('b','beta','SELECT 1')
        a['draft']['sql']='SELECT 1' # live alpha still points to beta
        with self.assertRaisesRegex(ValueError,'Circular'):compile_model('SELECT * FROM {{ alpha }}','conn',[a,b],owner=b['id'])
    def test_direct_ids_and_dependent_phases(self):
        a=model('a','alpha');b=model('b','beta','FROM {{ alpha }}')
        self.assertIn('sandbox.alpha',compile_model('FROM {{ @'+a['id']+' }}','conn',[a])['compiledSql'])
        self.assertEqual({d['phase'] for d in dependents(a['id'],[a,b])},{'draft','published'})
    def test_partial_references_can_be_saved_but_not_compiled(self):
        for sql in ['FROM {{','FROM {{ bad() }}','FROM }}','FROM {{{ x }}}']:
            with self.assertRaises(ValueError):reference_tokens(sql)
            reference_tokens(sql,tolerant=True)
    def test_repeated_references_and_pending(self):
        a=model('a','alpha')
        result=compile_model('FROM {{ alpha }} a JOIN {{ alpha }} b ON TRUE','conn',[a])
        self.assertEqual(len(result['dependencies']),1)
        a['pending']={'jobId':'unknown'}
        with self.assertRaisesRegex(ValueError,'pending'):compile_model('FROM {{ alpha }}','conn',[a])
