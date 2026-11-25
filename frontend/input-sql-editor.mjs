import {inputProgress} from './input-progress.mjs';
/** Drafts are held by the bindings controller so collapse/navigation cannot discard edits. */
export function mountInputSqlEditor(host,{CodeMirror,draft,doc,binding,canEdit,post,onSaved,onRefresh,getParameters=()=>({}),onDraftChanged=()=>{}}){
 host.innerHTML='<div class="source-preview-tools"><small>SQL source · saves to the app folder</small><span class="spacer"></span><button data-run class="primary">Run SQL</button><button data-save>Save SQL</button><button data-refresh>Save & refresh</button></div><div class="source-code"></div><p class="sql-edit-status" role="status"></p><details class="sql-results"><summary>Query results</summary><div></div></details>';
 const editor=CodeMirror(host.querySelector('.source-code'),{value:draft.text,mode:'text/x-sql',readOnly:!canEdit(),lineNumbers:true,lineWrapping:false,viewportMargin:15});
 const status=host.querySelector('.sql-edit-status'),save=host.querySelector('[data-save]'),refresh=host.querySelector('[data-refresh]'),runSQL=host.querySelector('[data-run]');let busy=false,preview=null;
 function update(){runSQL.disabled=busy||!canEdit();save.disabled=busy||!canEdit()||draft.text===draft.base;refresh.disabled=busy||!canEdit();}
 editor.on('change',()=>{draft.text=editor.getValue();onDraftChanged();status.textContent=draft.text===draft.base?'':'Unsaved SQL changes · Run SQL to preview them.';results();update();});
 function results(){
  const target=host.querySelector('.sql-results > div');target.replaceChildren();
  const data=preview?preview.inputs[binding.name]:doc.inputs[binding.name],meta=preview?preview.metadata[binding.name]:doc.inputMetadata?.[binding.name];
  host.querySelector('.sql-results summary').textContent=preview?'SQL preview results':'App input snapshot';
  const note=document.createElement('p');note.textContent=meta?`${meta.rows.toLocaleString()} rows · ${preview?(preview.sql===editor.getValue()?'Preview only — not applied to app':'Previous preview — SQL has changed'):'Snapshot used by app — not a preview of your edits'} · ${new Date(meta.refreshedAt).toLocaleString()}`:'No input snapshot yet. Run SQL to preview your query, or Save & refresh to update the app.';target.append(note);
  if(!Array.isArray(data)||!meta)return;
  const table=document.createElement('table'),head=document.createElement('tr');
  for(const column of meta.columns){const th=document.createElement('th');th.textContent=column;head.append(th);}table.append(head);
  for(const record of data.slice(0,100)){const row=document.createElement('tr');for(const column of meta.columns){const td=document.createElement('td');const value=record[column];td.textContent=value===null?'NULL':typeof value==='object'?JSON.stringify(value):String(value??'');row.append(td);}table.append(row);}target.append(table);
  if(data.length>100){const more=document.createElement('p');more.textContent='Showing the first 100 rows of the complete snapshot.';target.append(more);}
 }
 async function commit(run){
  if(busy||!canEdit())return;busy=true;draft.busy=true;update();status.textContent='Saving SQL…';
  try{
   const text=editor.getValue();await post('/interactive-sql/save',{folder:doc.folder,source:binding.source,expected:draft.base,content:text});draft.base=text;await onSaved(text);
   status.textContent='SQL saved. Inputs have not been refreshed.';
   if(run){const endProgress=inputProgress(status,'SQL saved · Refreshing inputs');try{await onRefresh();}finally{endProgress();}preview=null;results();host.querySelector('.sql-results').open=true;status.textContent='SQL saved and inputs refreshed. Reload app, then rerun the scenario to update its results. Save document to retain changes.';}
  }catch(e){status.textContent=e.message+' Previous input results were kept.';}
  finally{busy=false;draft.busy=false;update();}
 }
 runSQL.onclick=async()=>{
  if(busy||!canEdit())return;busy=true;draft.busy=true;update();const sql=editor.getValue();const endProgress=inputProgress(status,'Running SQL');
  try{const value=await post('/interactive-sql/run',{folder:doc.folder,name:binding.name,content:sql,parameters:getParameters()});endProgress();preview={...value,sql};results();host.querySelector('.sql-results').open=true;status.textContent='Query complete. Preview only; SQL and app inputs have not been saved. Use Save & refresh to apply.';}
  catch(e){endProgress();status.textContent=e.message+' App inputs are unchanged.';}
  finally{endProgress();busy=false;draft.busy=false;update();}
 };
 save.onclick=()=>commit(false);refresh.onclick=()=>commit(true);results();update();requestAnimationFrame(()=>editor.refresh());
}
