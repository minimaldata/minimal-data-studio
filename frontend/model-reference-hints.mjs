// Locate an unfinished reference in SQL code, excluding comments and quoted text.
export function referencePrefix(sql,cursor=sql.length){
  let i=0;
  while(i<cursor){
    if(sql.startsWith('--',i)||sql[i]==='#'){const end=sql.indexOf('\n',i);if(end<0||end>=cursor)return null;i=end+1;}
    else if(sql.startsWith('/*',i)){const end=sql.indexOf('*/',i+2);if(end<0||end+2>cursor)return null;i=end+2;}
    else if("'\"`".includes(sql[i])){
      const q=sql[i],delimiter=q!=='`'&&sql.startsWith(q.repeat(3),i)?q.repeat(3):q;i+=delimiter.length;
      let closed=false;
      while(i<cursor){if(sql[i]==='\\')i+=2;else if(sql.startsWith(delimiter,i)){i+=delimiter.length;if(delimiter.length===1&&sql.startsWith(delimiter,i)){i++;continue;}closed=true;break;}else i++;}
      if(!closed)return null;
    }else if(sql.startsWith('{{',i)){
      const end=sql.indexOf('}}',i+2);
      if(end<0||end>=cursor){const prefix=sql.slice(i+2,cursor);if(!/^\s*[@\w]*$/.test(prefix))return null;return {from:i,to:end>=cursor&& !sql.slice(cursor,end).includes('\n')?end+2:cursor,prefix:prefix.trim()};}
      i=end+2;
    }else i++;
  }
  return null;
}
export function referenceHints(sql,cursor,models,connection,owner){
  const context=referencePrefix(sql,cursor);if(!context)return null;
  const list=models.filter(m=>m.id!==owner&&m.draft.connection===connection&&(context.prefix.startsWith('@')?('@'+m.id).startsWith(context.prefix):m.reference.toLowerCase().startsWith(context.prefix.toLowerCase())))
    .map(m=>({text:'{{ '+(context.prefix.startsWith('@')?'@'+m.id:m.reference)+' }}',displayText:m.reference+' · '+m.draft.name+(m.published?'':' (publish first)')}));
  return {...context,list};
}
