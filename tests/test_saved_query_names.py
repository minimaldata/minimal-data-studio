import unittest
from saved_query_names import validate_query_names, unique_copy_name

class QueryNamesTests(unittest.TestCase):
    def test_new_collision_rejected(self):
        a = dict(id='a', name='Revenue', folder='Reports')
        with self.assertRaisesRegex(ValueError, 'Saved queries / Reports'):
            validate_query_names([a], [a, dict(id='b', name=' revenue ')])

    def test_legacy_duplicates_can_be_saved_or_resolved(self):
        old = [dict(id='a', name='New'), dict(id='b', name='new')]
        validate_query_names(old, old)
        validate_query_names(old, [old[0], dict(id='b', name='Different')])
        with self.assertRaises(ValueError):
            validate_query_names(old, old + [dict(id='c', name='NEW')])

    def test_recovery_copy_names(self):
        self.assertEqual(unique_copy_name([dict(name='New (copy)'), dict(name='new (copy) 2')], 'New'), 'New (copy) 3')
