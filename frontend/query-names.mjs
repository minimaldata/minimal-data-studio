export const queryNameKey=name=>String(name||'').trim().toLowerCase();
export function validateQueryName(queries,name,id){
 const clean=String(name||'').trim();if(!clean)throw Error('Enter a query name.');
 const existing=queries.find(q=>q.id!==id&&queryNameKey(q.name)===queryNameKey(clean));
 if(existing)throw Error(`“${existing.name}” already exists in Saved queries / ${existing.folder||'(root)'}. Choose a different name.`);
 return clean;
}
export function copiedQueryName(queries,name){
 const base=name+' copy';let candidate=base,n=2;
 while(queries.some(q=>queryNameKey(q.name)===queryNameKey(candidate)))candidate=base+' '+n++;
 return candidate;
}
