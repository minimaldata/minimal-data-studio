import hashlib
from pathlib import Path
import tempfile
import unittest
from openpyxl import Workbook
from excel_files import read_excel
from project_files import ProjectFiles
from workspace_db import Workspace

class ExcelFiles(unittest.TestCase):
    def test_sheet_header_import_and_original_unchanged(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); files = ProjectFiles(root)
            path = root/'data/book.xlsx'
            book = Workbook(); ws = book.active; ws.title='Orders'
            ws.append(['Title']); ws.append(['id','id',None]); ws.append(['001','two',3])
            other = book.create_sheet('Other'); other.append(['name']); other.append(['Ada'])
            book.save(path); book.close()
            original = hashlib.sha256(path.read_bytes()).hexdigest()
            bad = files.preview('data/book.xlsx')
            self.assertEqual(bad['columns'], ['Title','column_2','column_3']); self.assertEqual(bad['sheets'], ['Orders','Other'])
            preview = files.preview('data/book.xlsx', 'Orders', 2)
            self.assertEqual(preview['columns'], ['id','id_2','column_3'])
            self.assertEqual(preview['rows'], [['001','two','3']])
            self.assertEqual(read_excel(path,'Other')['rows'], [['Ada']])
            w = Workspace(root,root/'data',root,False,False)
            session = w.session(w.new_session()['session'])
            imported = w.import_path(session,path,sheet='Orders',header=2)
            self.assertEqual(session['conn'].execute('SELECT * FROM "'+imported['name']+'"').fetchall(), [('001','two','3')])
            w.close()
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),original)

    def test_formula_missing_after_preview_limit_blocks_import(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'formulas.xlsx'; book=Workbook(); ws=book.active
            ws.append(['x'])
            for i in range(105): ws.append([i])
            ws.append(['=SUM(A2:A3)']); book.save(path); book.close()
            preview=read_excel(path,limit=100)
            self.assertTrue(preview['limited']); self.assertEqual(len(preview['rows']),100)
            with self.assertRaisesRegex(ValueError,'Formula results missing'):
                read_excel(path)

    def test_bad_selection(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'book.xlsx'; book=Workbook(); book.save(path); book.close()
            for header in (0,-1,'not a number'):
                with self.assertRaises(ValueError): read_excel(path,header=header)
            with self.assertRaisesRegex(ValueError,'Choose a sheet'): read_excel(path,'Missing')

    def test_late_unnamed_column_and_complete_preview(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); files=ProjectFiles(root); path=root/'data/late.xlsx'
            book=Workbook(); ws=book.active; ws.append(['id'])
            for i in range(1,170):ws.append([i])
            ws.cell(168,3,'late value');book.save(path);book.close()
            result=files.preview('data/late.xlsx')
            self.assertEqual(result['total'],169)
            self.assertEqual(result['columns'],['id','column_2','column_3'])
            self.assertEqual(result['rowNumbers'][166],168)
            self.assertEqual(result['rows'][166],['167',None,'late value'])
            self.assertEqual(result['rows'][0],['1',None,None])
            self.assertTrue(result['checkedAll']);self.assertFalse(result['limited'])
            wsdb=Workspace(root,root/'data',root,False,False)
            try:
                session=wsdb.session(wsdb.new_session()['session'])
                name=wsdb.import_path(session,path)['name']
                self.assertEqual(session['conn'].execute('SELECT column_3 FROM "'+name+'" WHERE id=\'167\'').fetchone()[0],'late value')
            finally:wsdb.close()

    def test_preview_flags_formulas_beyond_first_page(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);files=ProjectFiles(root);path=root/'data/formula.xlsx'
            book=Workbook();ws=book.active;ws.append(['x'])
            for i in range(150):ws.append([i])
            ws.append(['=1+1']);book.save(path);book.close()
            preview=files.preview('data/formula.xlsx')
            self.assertEqual(len(preview['rows']),151)
            self.assertEqual(preview['missingFormulaResults'],1)
            self.assertTrue(any('A152' in warning for warning in preview['warnings']))

    def test_csv_complete_validation_and_rows(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);files=ProjectFiles(root);path=root/'data/long.csv'
            path.write_text('id,label\n'+''.join(f'{i},value\n' for i in range(180)))
            preview=files.preview('data/long.csv')
            self.assertEqual(len(preview['rows']),180);self.assertTrue(preview['checkedAll'])
            with path.open('a') as f:f.write('extra,value,field\n')
            self.assertIn('182',files.preview('data/long.csv')['error'])

    def test_csv_export_selected_sheet_all_rows_and_no_overwrite(self):
        import csv
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); files=ProjectFiles(root); path=root/'data/book.xlsx'
            book=Workbook(); book.active.append(['other'])
            ws=book.create_sheet('Second'); ws.append(['Title']); ws.append(['id','label'])
            for i in range(150): ws.append([i, 'comma, and "quote"\nnewline'])
            book.save(path);book.close()
            original=path.read_bytes()
            result=files.excel_csv('data/book.xlsx','Second',2,'second.csv')
            with (root/result['relative']).open(newline='') as f: rows=list(csv.reader(f))
            self.assertEqual(len(rows),151)
            self.assertEqual(rows[0],['id','label'])
            self.assertEqual(rows[-1],['149','comma, and "quote"\nnewline'])
            with self.assertRaisesRegex(ValueError,'already exists'): files.excel_csv('data/book.xlsx','Second',2,'second.csv')
            with self.assertRaises(ValueError): files.excel_csv('data/book.xlsx','Second',2,'../bad.csv')
            self.assertEqual(path.read_bytes(),original)
