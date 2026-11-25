import {inputProgress} from './input-progress.mjs';
import {mountInputSqlEditor} from './input-sql-editor.mjs';
/** Host-only data binding controls. The iframe has no access to these endpoints. */
export function mountDataBindings(host,{getDocument,canEdit,request,changed,CodeMirror,onDraftsChanged=()=>{}}) {
 const drafts=new Map();
 let sources=[],pending=false,contract={},files={},hashes={},parameters={},refreshSequence=0,loadSequence=0;
 const title=document.createElement('h3');title.textContent='Data inputs';
 const note=document.createElement('p');note.textContent='Bind local tables, views or saved SQL queries. Refresh copies a complete snapshot; opening the app does not query the database.';
 const rows=document.createElement('div'),form=document.createElement('div'),status=document.createElement('p');status.setAttribute('role','status');form.className='interactive-binding-form';
 const name=document.createElement('input');name.placeholder='Input name, e.g. history';name.setAttribute('aria-label','Data input name');
 const declared=document.createElement('select');declared.setAttribute('aria-label','Required app input');declared.hidden=true;
 const requirements=document.createElement('p');requirements.className='interactive-input-requirements';
 const source=document.createElement('select');source.setAttribute('aria-label','Data input source');
 const add=document.createElement('button');add.textContent='Add input';
 const refresh=document.createElement('button');refresh.textContent='Refresh inputs';refresh.className='primary';
 const reload=document.createElement('button');reload.textContent='Reload source list';
 const parameterForm=document.createElement('div');parameterForm.className='interactive-binding-form';
 form.append(name,declared,source,add);host.append(title,note,requirements,parameterForm,rows,form,refresh,reload,status);
 async function post(path,body={}){const r=await request(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await r.json();if(!r.ok)throw Error(result.error||'Data request failed.');return result;}
 async function load(){try{const sequence=++loadSequence,doc=getDocument();const definition=doc?.folder?await post('/interactive-folder',{folder:doc.folder}):{};if(doc!==getDocument()||sequence!==loadSequence)return;contract=definition.inputs||{};files=definition.files||{};hashes=definition.sqlHashes||{};parameters=definition.parameters||{};sources=(await post('/interactive-inputs/catalog')).sources;if(doc!==getDocument()||sequence!==loadSequence)return;source.replaceChildren(new Option('Choose source…',''));sources.forEach((s,i)=>source.add(new Option(`${s.kind==='query'?'Saved query':s.kind==='view'?'View':'Table'} · ${s.label}`,String(i))));render();}catch(e){status.textContent=e.message;}}
 function inputStatus(doc,b){
  const meta=doc.inputMetadata?.[b.name];
  if(!meta||meta.kind!==b.kind||meta.source!==b.source)return 'Not refreshed';
  const draft=drafts.get(doc.folder+'/'+b.source), reasons=[];
  if(draft&&draft.text!==draft.base)reasons.push('Unsaved SQL');
  if(b.kind==='app-sql'&&hashes[b.source]&&meta.queryHash!==hashes[b.source])reasons.push('SQL changed — refresh needed');
  if(Object.entries(meta.parameters||{}).some(([key,value])=>JSON.stringify(value)!==JSON.stringify(doc.parameters?.[key]??parameters[key]?.default)))reasons.push('Parameters changed — Apply needed');
  return `${meta.rows.toLocaleString()} rows · ${new Date(meta.refreshedAt).toLocaleString()} · ${reasons.join(' · ')||'Snapshot current'}`;
 }
 function render(){
  const doc=getDocument();rows.replaceChildren();if(!doc)return;
  parameterForm.replaceChildren();
  for(const [key,spec]of Object.entries(parameters)){const label=document.createElement('label');label.textContent=spec.label||key;const input=document.createElement('input');input.setAttribute('aria-label',spec.label||key);input.type={date:'date',number:'number',boolean:'checkbox',string:'text'}[spec.type];if(spec.type==='number')input.step='any';const value=doc.parameters?.[key]??spec.default;if(spec.type==='boolean')input.checked=value;else input.value=value;input.disabled=pending||!canEdit();input.oninput=()=>{(doc.parameters||={})[key]=spec.type==='boolean'?input.checked:spec.type==='number'?(input.value===''?null:Number(input.value)):input.value;changed(doc,'Parameters changed · Apply & refresh inputs to query. Current snapshot is unchanged.');for(const node of rows.querySelectorAll('[data-input-status]')){const binding=JSON.parse(node.dataset.inputStatus);node.textContent=inputStatus(doc,binding);}};label.append(input);parameterForm.append(label);}
  refresh.textContent=Object.keys(parameters).length?'Apply & refresh inputs':'Refresh inputs';
  const entries=Object.entries(contract);name.hidden=!!entries.length;declared.hidden=!entries.length;
  requirements.textContent=entries.map(([key,spec])=>`${spec.label||key}${spec.required?' (required)':' (optional)'}: ${Object.entries(spec.columns||{}).map(([col,type])=>col+' · '+type).join(', ')}`).join(' — ');
  const selectable=entries.filter(([,spec])=>!spec.sql);form.hidden=entries.length>0&&!selectable.length;
  declared.replaceChildren(...selectable.map(([key,spec])=>new Option(spec.label||key,key)));
  if(entries.length)add.textContent='Connect source';else add.textContent='Add input';
  const automatic=entries.filter(([,spec])=>spec.sql).map(([name,spec])=>({name,kind:'app-sql',source:spec.sql}));
  const effective=[...(doc.bindings||[]).filter(b=>!contract[b.name]?.sql),...automatic];
  for(const b of effective){const row=document.createElement('div');row.className='interactive-binding-row';const label=document.createElement('strong');label.textContent=contract[b.name]?.label||b.name;
   const meta=doc.inputMetadata?.[b.name];const description=document.createElement('span');description.textContent=b.kind==='app-sql'?`SQL file · ${b.source}`:`${b.kind} · ${meta?.label||b.source}`;
   const info=document.createElement('small');info.dataset.inputStatus=JSON.stringify(b);info.textContent=inputStatus(doc,b);
   const remove=document.createElement('button');remove.textContent='Remove';remove.disabled=pending;remove.onclick=()=>{if(!canEdit()||pending)return;doc.bindings=doc.bindings.filter(x=>x!==b);delete doc.inputs[b.name];if(doc.inputMetadata)delete doc.inputMetadata[b.name];changed(doc,'Input removed. Saved results may be outdated.');render();};row.append(label,description,info);
   if(b.kind==='app-sql'){
    const show=document.createElement('button');show.textContent='Inspect SQL';show.className='inspect-input-sql';show.setAttribute('aria-expanded','false');
    const panel=document.createElement('div');panel.className='source-preview-host input-sql-preview';panel.hidden=true;let sourcePreview;
    show.onclick=()=>{panel.hidden=!panel.hidden;show.setAttribute('aria-expanded',String(!panel.hidden));show.textContent=panel.hidden?'Inspect SQL':'Hide SQL';if(!panel.hidden){if(!sourcePreview){const key=doc.folder+'/'+b.source;let draft=drafts.get(key);if(!draft){draft={text:files[b.source],base:files[b.source]};drafts.set(key,draft);}mountInputSqlEditor(panel,{CodeMirror,draft,doc,binding:b,canEdit,post,getParameters:()=>doc.parameters||{},onDraftChanged:()=>{info.textContent=inputStatus(doc,b);onDraftsChanged();},onSaved:async text=>{files[b.source]=text;hashes[b.source]=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(x=>x.toString(16).padStart(2,'0')).join('');info.textContent=inputStatus(doc,b);onDraftsChanged();},onRefresh:async()=>{await refreshDocument(doc);const meta=doc.inputMetadata[b.name];info.textContent=inputStatus(doc,b);}});sourcePreview=true;}else requestAnimationFrame(()=>panel.querySelector('.CodeMirror').CodeMirror.refresh());}};
    row.append(show,panel);
   }else row.append(remove);
   rows.append(row);
  }
  refresh.disabled=pending||!effective.length;add.disabled=pending;
 }
 add.onclick=()=>{const doc=getDocument();if(!canEdit()||!doc||pending)return;const key=Object.keys(contract).length?declared.value:name.value.trim(),selected=sources[Number(source.value)];if(!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)){status.textContent='Use a name starting with a letter, followed by letters, numbers or underscores.';return;}if(source.value===''||!selected){status.textContent='Choose a source.';return;}if((doc.bindings||[]).some(b=>b.name===key)||Object.hasOwn(doc.inputs,key)){status.textContent='That input is already connected. Remove it before changing its source.';return;}(doc.bindings||=[]).push({name:key,kind:selected.kind,source:selected.source});changed(doc,'Input added · Refresh inputs to load its data.');name.value='';render();};
 async function refreshDocument(doc){
  const sequence=++refreshSequence;const result=await post('/interactive-inputs/refresh',{bindings:doc.bindings,folder:doc.folder,parameters:doc.parameters||{}});if(sequence!==refreshSequence)throw Error('A newer refresh superseded this request.');Object.assign(doc.inputs,result.inputs);doc.inputMetadata=result.metadata;changed(doc,'Inputs refreshed · Save document to keep the snapshot. Reload app to inspect or recalculate outdated results.');
 }
 refresh.onclick=async()=>{
  const doc=getDocument();if(!canEdit()||!doc||pending)return;pending=true;host.setAttribute('aria-busy','true');render();const endProgress=inputProgress(status,'Refreshing inputs');
  try{await refreshDocument(doc);endProgress();status.textContent='Complete snapshot loaded. No source data was changed.';}
  catch(e){endProgress();status.textContent=e.message+' Previous inputs were kept.';}
  finally{endProgress();pending=false;host.setAttribute('aria-busy','false');render();}
 };
 reload.onclick=load;
 return {exportDrafts(){return [...drafts].filter(([,d])=>d.text!==d.base).map(([key,d])=>[key,{text:d.text,base:d.base}]);},restoreDrafts(values){for(const [key,draft]of values)drafts.set(key,draft);},show(){status.textContent='';contract={};render();load();},get busy(){return pending||[...drafts.values()].some(d=>d.busy);},get unsaved(){return [...drafts.values()].some(d=>d.text!==d.base);}};
}
