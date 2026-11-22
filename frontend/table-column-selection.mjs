// Column indices stay in visual order, independently of selection click order.
export function selectColumns(current,index,{shiftKey=false,metaKey=false,ctrlKey=false}={}){
 const additive=metaKey||ctrlKey,columns=new Set(additive?current?.columns||[]:[]);
 const anchor=shiftKey&&current?current.anchor:index;
 if(shiftKey){for(let i=Math.min(anchor,index);i<=Math.max(anchor,index);i++)columns.add(i);}
 else if(additive&&columns.has(index))columns.delete(index);
 else columns.add(index);
 return {anchor,columns:[...columns].sort((a,b)=>a-b)};
}

// Row identity is stable across sorting and paging; ranges follow visible order.
export function selectRows(current,id,order,modifiers={}){
 const indices=current?{anchor:order.indexOf(current.anchor),columns:current.rows.map(row=>order.indexOf(row)).filter(i=>i>=0)}:null;
 const valid=indices?{...indices,anchor:indices.anchor>=0?indices.anchor:order.indexOf(id)}:null;
 const next=selectColumns(valid,order.indexOf(id),modifiers);
 return {anchor:order[next.anchor],rows:next.columns.map(i=>order[i])};
}

export function selectAxis(current,axis,index,order,event={}){
 const next={...current};
 if(axis==='columns'){
  const selected=selectColumns(current?.columns?{columns:current.columns,anchor:current.columnAnchor}:null,index,event);
  next.columns=selected.columns.length?selected.columns:null;next.columnAnchor=selected.anchor;
 }else{
  const selected=selectRows(current?.rows?{rows:current.rows,anchor:current.rowAnchor}:null,index,order,event);
  next.rows=selected.rows.length?selected.rows:null;next.rowAnchor=selected.anchor;
 }
 return next.columns||next.rows?next:null;
}
