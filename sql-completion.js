// Lightweight clause/scope awareness; schema metadata remains the source of names.
const identifier=t=>!!t && /^(?:"(?:""|[^"])*"|[A-Za-z_][\w$]*)$/.test(t.text);
const identifierName=t=>t.text.startsWith('"')?t.text.slice(1,-1).replaceAll('""','"'):t.text;
const keyword=(t,w)=>t?.text.toUpperCase()===w;
const lookupName=(tables,name)=>Object.keys(tables).find(n=>n.toLowerCase()===name.toLowerCase());
function projectionColumns(tokens, tables, level=0) {
  if(level>20)return [];
  tables=withCtes(tokens,Infinity,tables,level+1).tables;
  const depth=tokens.reduce((depth,t)=>Math.min(depth,t.depth),Infinity);
  const flat=tokens.filter(t=>t.depth===depth);
  const start=flat.findIndex(t=>keyword(t,'SELECT'));if(start<0)return [];
  const stop=flat.findIndex((t,i)=>i>start&&['FROM','UNION','EXCEPT','INTERSECT'].includes(t.text.toUpperCase()));
  const projection=flat.slice(start+1,stop<0?undefined:stop);
  if(keyword(projection[0],'DISTINCT')||keyword(projection[0],'ALL'))projection.shift();
  const sources=[];
  for(let i=0;i<flat.length;i++)if(keyword(flat[i],'FROM')||keyword(flat[i],'JOIN')) {
    let j=i+1;if(!identifier(flat[j]))continue;
    let name=identifierName(flat[j]);if(flat[j+1]?.text==='.'&&identifier(flat[j+2])){j+=2;name=identifierName(flat[j]);}
    const key=lookupName(tables,name);if(!key)continue;
    let a=flat[j+1];if(keyword(a,'AS'))a=flat[j+2];
    const alias=identifier(a)&&!['WHERE','JOIN','ON','GROUP','ORDER','LIMIT','LEFT','RIGHT','FULL','INNER','CROSS','HAVING','QUALIFY'].includes(a.text.toUpperCase())?identifierName(a):name;
    sources.push({name,alias,columns:tables[key]});
  }
  const groups=[[]];for(const t of projection){if(t.text===',')groups.push([]);else groups.at(-1).push(t);}
  const columns=[];
  for(const part of groups){
    const as=part.findLastIndex(t=>keyword(t,'AS'));
    if(as>=0&&identifier(part[as+1])){columns.push(identifierName(part[as+1]));continue;}
    if(part.length===1&&part[0].text==='*'){columns.push(...sources.flatMap(s=>s.columns));continue;}
    if(part.length===3&&part[1].text==='.'&&part[2].text==='*'){columns.push(...sources.filter(s=>s.alias.toLowerCase()===identifierName(part[0]).toLowerCase()).flatMap(s=>s.columns));continue;}
    if(part.length===1&&identifier(part[0])){columns.push(identifierName(part[0]));continue;}
    if(part.length===3&&part[1].text==='.'&&identifier(part[2])){columns.push(identifierName(part[2]));continue;}
    // A whitespace-separated final identifier is an implicit output alias.
    const last=part.at(-1),prev=part.at(-2);
    if(identifier(last)&&prev&&last.start>prev.end&&!['+','-','*','/','.','||'].includes(prev.text)&&!keyword(prev,'COLLATE'))columns.push(identifierName(last));
  }
  return [...new Set(columns)];
}
function withCtes(tokens,cursor,original,level=0){
  const tables={...original},names=new Set();if(level>20)return {tables,names};
  for(let i=0;i<tokens.length;i++){
    const w=tokens[i];if(!keyword(w,'WITH')||w.start>=cursor)continue;
    const scopeEnd=tokens.find(t=>t.start>w.start&&t.depth<w.depth)?.start??Infinity;
    if(cursor>scopeEnd)continue;
    let j=i+1;const recursive=keyword(tokens[j],'RECURSIVE');if(recursive)j++;
    while(identifier(tokens[j])){
      const name=identifierName(tokens[j++]);let explicit=null;
      if(tokens[j]?.text==='('){const close=tokens.findIndex((t,k)=>k>j&&t.text===')'&&t.depth===tokens[j].depth);if(close<0)break;explicit=tokens.slice(j+1,close).filter(identifier).map(identifierName);j=close+1;}
      if(!keyword(tokens[j],'AS'))break;j++;
      if(keyword(tokens[j],'NOT'))j++;if(keyword(tokens[j],'MATERIALIZED'))j++;
      if(tokens[j]?.text!=='(')break;
      const open=j,close=tokens.findIndex((t,k)=>k>open&&t.text===')'&&t.depth===tokens[open].depth);
      const bodyEnd=close<0?Infinity:tokens[close].start;
      const key=lookupName(tables,name);const set=(cols)=>{if(key)delete tables[key];tables[name]=cols;names.add(name.toLowerCase());};
      if(cursor<=bodyEnd){if(recursive&&explicit)set(explicit);break;}
      set(explicit||projectionColumns(tokens.slice(open+1,close),tables,level+1));
      j=close+1;if(tokens[j]?.text!==',')break;j++;
    }
  }
  return {tables,names};
}
export function shouldTriggerSqlHint(change){
  return change.origin === '+input' && /^[\w.]$/.test(change.text.join(''));
}
export function sqlAutoPrefixAllowed(beforeCursor) {
  const match=beforeCursor.match(/(?:([A-Za-z_][\w$]*|"(?:""|[^"])+")\.)?([A-Za-z_][\w$]*)?$/);
  if(!match)return false;
  const prefix=match[2]||'';
  if(match[1])return true; // An explicit alias. is a useful request for columns.
  if(prefix.length<2)return false;
  return !new Set(['SELECT','FROM','JOIN','WHERE','WITH','AS','AND','OR','ON','IN','IS','NOT','NULL','GROUP','ORDER','BY','HAVING','QUALIFY','LIMIT','OFFSET','UNION','ALL','DISTINCT','LEFT','RIGHT','INNER','OUTER','FULL','CROSS','CASE','WHEN','THEN','ELSE','END','ASC','DESC']).has(prefix.toUpperCase());
}
export function sqlContextHints(sql, cursor, tables) {
  const tokens=[];
  const re=/--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|'(?:''|[^'])*(?:'|$)|"(?:""|[^"])*"|[A-Za-z_][\w$]*|[().,;]|\S/g;
  let depth=0;
  for(const m of sql.matchAll(re)) {
    const text=m[0]; if(/^(--|\/\*|')/.test(text))continue;
    if(text===')')depth=Math.max(0,depth-1);
    tokens.push({text,start:m.index,end:m.index+text.length,depth});
    if(text==='(')depth++;
  }
  const before=tokens.filter(t=>t.start<cursor);
  const boundary=before.filter(t=>t.text===';').at(-1)?.end||0;
  const end=tokens.find(t=>t.start>=cursor&&t.text===';')?.start??sql.length;
  const statement=tokens.filter(t=>t.start>=boundary&&t.start<end);
  const ctes=withCtes(statement,cursor,tables);tables=ctes.tables;
  // Find the nearest SELECT whose parentheses still contain the cursor.
  const selects=statement.filter(t=>t.text.toUpperCase()==='SELECT'&&t.end<=cursor&&
    !statement.some(x=>x.start>t.start&&x.start<cursor&&x.depth<t.depth));
  const select=selects.at(-1); if(!select)return null;
  const scopeEnd=statement.find(t=>t.start>select.start&&t.depth<select.depth)?.start??end;
  const scope=statement.filter(t=>t.start>=select.start&&t.start<scopeEnd&&t.depth===select.depth);
  const clauses=new Set(['SELECT','FROM','JOIN','WHERE','ON','HAVING','GROUP','ORDER','QUALIFY','LIMIT','OFFSET','UNION','EXCEPT','INTERSECT']);
  const clause=scope.filter(t=>t.end<=cursor&&clauses.has(t.text.toUpperCase())).at(-1)?.text.toUpperCase();
  if(!clause||['LIMIT','OFFSET','UNION','EXCEPT','INTERSECT'].includes(clause))return null;
  const tail=sql.slice(0,cursor).match(/(?:("(?:""|[^"])+"|[A-Za-z_][\w$]*)\.)?([A-Za-z_][\w$]*)?$/);
  const prefix=tail?.[2]||'', qualifier=tail?.[1], from=cursor-(tail?.[0].length||0);
  const unquote=s=>s?.startsWith('"')?s.slice(1,-1).replaceAll('""','"'):s;
  const quote=s=>/^[A-Za-z_][\w$]*$/.test(s)?s:'"'+s.replaceAll('"','""')+'"';
  const lookup=s=>Object.keys(tables).find(n=>n.toLowerCase()===unquote(s)?.toLowerCase());
  const sources=[];let inFrom=false;
  const reserved=new Set([...clauses,'AS','LEFT','RIGHT','FULL','INNER','OUTER','CROSS','NATURAL','USING','BY','ASC','DESC']);
  for(let i=0;i<scope.length;i++) {
    const word=scope[i].text.toUpperCase();
    if(clauses.has(word))inFrom=word==='FROM'||word==='JOIN';
    if(word!=='FROM'&&word!=='JOIN'&&!(word===','&&inFrom))continue;
    let j=i+1, token=scope[j];if(!token||token.text==='(')continue;
    let table=lookup(token.text);
    if(scope[j+1]?.text==='.') {j+=2;table=lookup(scope[j]?.text);}
    if(!table)continue;
    let alias=scope[j+1];if(alias?.text.toUpperCase()==='AS')alias=scope[j+2];
    const name=alias&&!reserved.has(alias.text.toUpperCase())&&/^("|[A-Za-z_])/.test(alias.text)?unquote(alias.text):table;
    sources.push({table,alias:name});
  }
  const tableContext=clause==='FROM'||clause==='JOIN';
  if(tableContext)return {from,items:Object.keys(tables).filter(n=>n.toLowerCase().startsWith(prefix.toLowerCase())).map(n=>({text:quote(n),name:n,kind:ctes.names.has(n.toLowerCase())?'cte':'relation'}))};
  const selected=qualifier?sources.filter(s=>s.alias.toLowerCase()===unquote(qualifier).toLowerCase()):sources;
  // Before a FROM clause exists, offer known columns; never mix table names into expressions.
  const candidates=selected.length?selected:qualifier?[]:sources.length?[]:Object.keys(tables).map(table=>({table,alias:table}));
  const counts=new Map();for(const s of candidates)for(const col of tables[s.table])counts.set(col.toLowerCase(),(counts.get(col.toLowerCase())||0)+1);
  const items=[];
  for(const s of candidates)for(const col of tables[s.table]) {
    if(!col.toLowerCase().startsWith(prefix.toLowerCase()))continue;
    const text=qualifier?qualifier+'.'+quote(col):counts.get(col.toLowerCase())>1&&sources.length?quote(s.alias)+'.'+quote(col):quote(col);
    if(!items.some(i=>i.text===text))items.push({text,kind:'column'});
  }
  return {from,items};
}
