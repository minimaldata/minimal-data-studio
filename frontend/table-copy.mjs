// Raw values are separate from display formatting and calculator coercion.
const values=new WeakMap();
export function registerCopyCell(cell,value,numeric=false){values.set(cell,{value,numeric});}
export function copyCellValue(cell){return values.has(cell)?values.get(cell).value:cell.classList.contains('null')?null:cell.textContent;}
export function sqlLiteral(value,numeric=false){
 if(value===null||value===undefined)return 'NULL';
 if(typeof value==='boolean')return value?'TRUE':'FALSE';
 const text=String(value);
 if((numeric||typeof value==='number'||typeof value==='bigint')&&/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text))return text;
 return "'"+text.replaceAll("'","''")+"'";
}
export function sqlValues(rows,{distinct=false,headers=null}={}){
 let literals=rows.map(row=>row.map(cell=>sqlLiteral(cell?.value,cell?.numeric)));
 if(distinct){const seen=new Set();literals=literals.filter(row=>{const key=JSON.stringify(row);if(seen.has(key))return false;seen.add(key);return true;});}
 if(headers?.length)literals.unshift(headers.map(name=>sqlLiteral(String(name))));
 return literals.every(row=>row.length===1)?literals.map(row=>row[0]).join(', '):literals.map(row=>'('+row.join(', ')+')').join(',\n');
}
export function copySelectionAsSql(selected,options={}){
 const table=selected[0]?.closest('table');if(!table)return '';
 const cells=selected.filter(cell=>cell.closest('table')===table),chosen=new Set(cells);
 const columns=[...new Set(cells.map(cell=>cell.cellIndex))].sort((a,b)=>a-b);
 const rows=[...new Set(cells.map(cell=>cell.parentElement))].sort((a,b)=>a.rowIndex-b.rowIndex);
 return sqlValues(rows.map(row=>columns.map(column=>{
  const cell=row.cells[column];
  if(!chosen.has(cell))return {value:null};
  return values.get(cell)||{value:cell.classList.contains('null')?null:cell.textContent};
 })),options);
}
