import {mountInteractiveRecovery} from './interactive-recovery.mjs';
import {openResultTableDialog} from './interactive-result-table.mjs';
import {mountSourcePreview} from './source-preview.mjs';
import {mountDataBindings} from './interactive-bindings.mjs';
import {renderSourceTree} from './interactive-files.mjs';
import {sandboxSource,validDocumentState} from './interactive-sandbox.mjs';
import {scenarioDocument} from './interactive-example.mjs';

export function mountInteractiveDocuments({host,list,createButton,activate,redraw,canEdit,snapshot,CodeMirror,previewSlot,refreshSchema,databaseFolderAPI,fetch:request=window.fetch.bind(window)}) {
 let documents=[],revision=0,current=null,dirty=false,frame=null,token=null,busy=false,loaded=false,activeParameters={};
 const opened=new Set(), sources=new Map(), expanded=new Set();let selectedSource=null,loading=0;
 host.innerHTML=`<div class="interactive-toolbar"><input aria-label="Interactive document name" maxlength="120"><button data-action="edit">Edit</button><button data-action="preview">Reload app</button><button data-action="stop">Stop preview</button><span class="spacer"></span><button data-action="fullscreen" aria-label="Enter fullscreen" title="Enter fullscreen">⛶</button><button data-action="save" class="primary">Save document</button></div><p class="interactive-status" role="status"></p><div class="interactive-edit"><p>Use <code>studio.inputs</code> for named data, <code>studio.state</code> for saved state, and <code>studio.saveState(object)</code> to stage state for Save. No database or credential access. External resources are blocked.</p><section class="interactive-bindings"></section><details class="interactive-manual-inputs"><summary>Manual input snapshot</summary><div class="interactive-input-tools"><button data-action="snapshot">Use last query result as baseline</button><small>Copies the displayed result snapshot, not a live query. Sample data is included initially.</small></div></details><div class="interactive-fields"></div></div><div class="interactive-preview" hidden></div><section class="interactive-source" hidden><div><strong></strong> <small>Read-only source</small><button data-action="back-app">Open app</button></div><div class="source-preview-host"></div></section>`;
 const status=host.querySelector('[role=status]'),edit=host.querySelector('.interactive-edit'),preview=host.querySelector('.interactive-preview'),name=host.querySelector('input');
 const recoveryExport=document.createElement('button');recoveryExport.textContent='Download app state';recoveryExport.hidden=true;recoveryExport.className='interactive-state-export';status.after(recoveryExport);
 recoveryExport.onclick=()=>{if(!current)return;const url=URL.createObjectURL(new Blob([JSON.stringify(current,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='studio-app-state.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 const diagnostics=document.createElement('details');diagnostics.className='interactive-diagnostics';diagnostics.innerHTML='<summary>App diagnostics</summary><pre></pre>';status.after(diagnostics);diagnostics.hidden=true;const issues=[];
 function reportError(text){const entry=new Date().toISOString()+' · '+(current?.folder||current?.name||'App')+' · '+String(text).slice(0,2000);issues.push(entry);if(issues.length>20)issues.shift();diagnostics.querySelector('pre').textContent=issues.join('\n\n');diagnostics.hidden=false;message(text);}
 const sourcePane=host.querySelector('.interactive-source'),toolbar=host.querySelector('.interactive-toolbar');
 const sourceView=mountSourcePreview(host.querySelector('.source-preview-host'),{CodeMirror});
 const fields={};
 for(const [key,label] of [['html','HTML'],['css','CSS'],['javascript','JavaScript'],['inputs','Named inputs (JSON)']]){
   const wrapper=document.createElement('label');wrapper.textContent=label;
   const textarea=document.createElement('textarea');textarea.setAttribute('aria-label',label);textarea.spellcheck=false;wrapper.append(textarea);if(key==='inputs'){const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Inspect input snapshot (JSON)';details.className='interactive-input-json';details.append(summary,wrapper);host.querySelector('.interactive-fields').after(details);}else host.querySelector('.interactive-fields').append(wrapper);fields[key]=textarea;
   textarea.oninput=()=>{dirty=true;stop();message('Unsaved edits · Preview to run, Save document to keep.');};
 }
 let recovery;
 function message(text){status.textContent=text;recovery?.schedule();}
 const bindings=mountDataBindings(host.querySelector('.interactive-bindings'),{getDocument:()=>current,canEdit,request,CodeMirror,onDraftsChanged:()=>recovery?.schedule(),changed:(doc,text)=>{dirty=true;if(doc===current){fields.inputs.value=JSON.stringify(doc.inputs,null,2);fields.inputs.readOnly=!!doc.bindings?.length;stop();message(text);}}});

 recovery=mountInteractiveRecovery(list,{request,canEdit,isDirty:()=>dirty||bindings.unsaved,isBusy:()=>busy||bindings.busy,
  snapshot(){if(!dirty&&!bindings.unsaved)return null;try{capture();}catch{}return {revision,documents,sqlDrafts:bindings.exportDrafts(),active:current?.id,raw:current?{name:name.value,html:fields.html.value,css:fields.css.value,javascript:fields.javascript.value,inputs:fields.inputs.value}:null};},
  async restore(value){stop();current=null;documents=value.documents;revision=value.revision;bindings.restoreDrafts(value.sqlDrafts);dirty=true;renderList();const doc=documents.find(d=>d.id===value.active)||documents[0];if(doc){open(doc,{preview:false});if(value.raw){name.value=value.raw.name;for(const key of ['html','css','javascript','inputs'])fields[key].value=value.raw[key];}try{await run();}catch(e){reportError('Draft restored, but preview could not run: '+e.message);edit.hidden=false;preview.hidden=true;}}redraw();}
 });
 const fullscreen=host.querySelector('[data-action=fullscreen]');
 function syncFullscreen(){const active=document.fullscreenElement===host||host.classList.contains('interactive-expanded');fullscreen.textContent=active?'Exit fullscreen':'⛶';fullscreen.setAttribute('aria-label',active?'Exit fullscreen':'Enter fullscreen');fullscreen.title=active?'Exit fullscreen (Esc)':'Enter fullscreen';}
 function exitFullscreen(){host.classList.remove('interactive-expanded');if(document.fullscreenElement===host)document.exitFullscreen().catch(()=>{});syncFullscreen();}
 fullscreen.onclick=async()=>{if(document.fullscreenElement===host||host.classList.contains('interactive-expanded'))return exitFullscreen();try{if(!host.requestFullscreen)throw Error('Unavailable');await host.requestFullscreen();}catch{host.classList.add('interactive-expanded');}syncFullscreen();};
 document.addEventListener('fullscreenchange',syncFullscreen);
 document.addEventListener('keydown',event=>{if(event.key==='Escape')exitFullscreen();});
 function stop(){loading++;token=null;frame?.remove();frame=null;}
 function capture(){
   if(!current)return;
   const inputs=JSON.parse(fields.inputs.value);
   if(!inputs||typeof inputs!=='object'||Array.isArray(inputs))throw Error('Named inputs must be a JSON object.');
   Object.assign(current,{name:name.value.trim(),inputs});
   if(!current.folder)Object.assign(current,{html:fields.html.value,css:fields.css.value,javascript:fields.javascript.value});
 }
 async function folderSource(doc){
   const r=await request('/interactive-folder',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({folder:doc.folder})});
   const result=await r.json();if(!r.ok)throw Error(result.error||'Could not read app folder.');return result;
 }
 function embeddedFiles(doc){return {'HTML (saved source)':doc.html,'CSS (saved source)':doc.css,'JavaScript (saved source)':doc.javascript};}
 async function inspect(doc,path,text){
   try{if(current)capture();}catch(e){message(e.message);return;}
   exitFullscreen();stop();const key='interactive:source:'+doc.id+':'+path;
   if(!sources.has(key))await previewSlot.open({key,close:()=>{sources.delete(key);}});
   sources.set(key,{doc,path,text});selectedSource=key;
   toolbar.hidden=true;edit.hidden=true;preview.hidden=true;sourcePane.hidden=false;
   sourcePane.querySelector('strong').textContent=path;sourceView.show(path,text);
   sourcePane.querySelector('[data-action=back-app]').onclick=()=>open(doc);
   message(doc.folder?doc.folder+'/'+path:'Embedded source · saved with this document');activate(key);
 }
 function renderList(){
   list.replaceChildren();
   for(const doc of documents){
     const row=document.createElement('div');row.className='interactive-app-row';
     const button=document.createElement('button');button.className='saved';button.textContent=doc.name;button.onclick=()=>open(doc);
     const toggle=document.createElement('button');toggle.className='sidebar-icon interactive-files-toggle';toggle.innerHTML='<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 7V5h6l2 2h10v13H3Z"/></svg>';toggle.title='Show files';toggle.setAttribute('aria-label','Show files for '+doc.name);toggle.setAttribute('aria-expanded',String(expanded.has(doc.id)));
     row.append(button,toggle);list.append(row);
     const details=document.createElement('details');details.className='interactive-files';const summary=document.createElement('summary');summary.textContent='Files';const tree=document.createElement('div');tree.className='interactive-source-children';details.append(summary,tree);details.hidden=!expanded.has(doc.id);list.append(details);
     async function loadFiles(){try{const files=doc.folder?(await folderSource(doc)).files:embeddedFiles(doc);renderSourceTree(tree,files,(path,text)=>inspect(doc,path,text));}catch(e){tree.textContent=e.message;}}
     toggle.onclick=()=>{const show=details.hidden;details.hidden=!show;details.open=show;toggle.setAttribute('aria-expanded',String(show));if(show){expanded.add(doc.id);loadFiles();}else expanded.delete(doc.id);};
     if(expanded.has(doc.id)){details.open=true;loadFiles();}
   }
 }
 function open(doc,options={}){
   if(current){try{capture();}catch(e){message(e.message);return;}}
   stop();selectedSource=null;toolbar.hidden=false;sourcePane.hidden=true;current=doc;opened.add(doc.id);name.value=doc.name;
   for(const key of ['html','css','javascript']){fields[key].value=doc[key]||'';fields[key].parentElement.hidden=!!doc.folder;}fields.inputs.value=JSON.stringify(doc.inputs,null,2);fields.inputs.readOnly=!!doc.bindings?.length;
   edit.hidden=false;preview.hidden=true;edit.querySelector(':scope > p').hidden=!!doc.folder;host.querySelector('[data-action=edit]').textContent=doc.folder?'Data inputs':'Edit';message(dirty?'Unsaved changes':doc.folder?'Folder app · Preview loads the current files.':'Saved document · Preview runs its JavaScript.');
   activate('interactive:'+doc.id);
   if(options.preview!==false)run().catch(e=>{recoveryExport.hidden=false;reportError('Could not open app: '+e.message);});
 }
 async function save(){
   if(busy)return false;
   if(!canEdit())throw Error('Choose Edit here before saving.');
   if(bindings.busy)throw Error('Wait for input refresh to finish before saving.');
   capture();busy=true;
   // Disable host edits while serializing; frame messages may still make the next revision dirty.
   const body=JSON.stringify({revision,documents});dirty=false;
   try{const r=await request('/interactive-documents',{method:'POST',headers:{'Content-Type':'application/json'},body});const value=await r.json();if(!r.ok)throw Error(value.error||'Could not save documents.');revision=value.revision;renderList();redraw();message(dirty?'Saved · newer scenario changes are unsaved':bindings.unsaved?'Document saved · SQL drafts are still unsaved':'Saved');return true;}
   catch(e){dirty=true;throw e;}finally{busy=false;}
 }
 async function run(){
   capture();stop();edit.hidden=true;preview.hidden=false;const doc=current,sequence=++loading;message('Loading app…');
   recoveryExport.hidden=true;
   const code=doc.folder?await folderSource(doc):doc;
   const savedVersion=doc.stateVersion??1, requiredVersion=code.stateVersion??1;
   if(savedVersion!==requiredVersion){recoveryExport.hidden=false;throw Error(`Saved state uses version ${savedVersion}; this app requires version ${requiredVersion}. Your work is preserved. Download app state and ask the app author to migrate it or restore compatible code.`);}
   const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(b=>b.toString(16).padStart(2,'0')).join('');
   activeParameters=code.parameters||{};
   const parameters=Object.fromEntries(Object.entries(activeParameters).map(([key,spec])=>[key,doc.parameters?.[key]??spec.default]));
   const context={apiVersion:1,stateVersion:requiredVersion,parameters,codeHash:await digest([code.html,code.css,code.javascript]),inputsHash:await digest([doc.inputs,doc.bindings||[]]),inputMetadata:doc.inputMetadata||{}};
   if(sequence!==loading||current!==doc||selectedSource)return;
   edit.hidden=true;preview.hidden=false;token=crypto.randomUUID();frame=document.createElement('iframe');frame.title='Interactive document preview';frame.setAttribute('sandbox','allow-scripts');frame.referrerPolicy='no-referrer';frame.srcdoc=sandboxSource({...code,inputs:doc.inputs,state:doc.state,context},token);preview.replaceChildren(frame);message('Running isolated preview · Save document to keep scenario changes.');
 }
 window.addEventListener('message',event=>{
   if(!frame || event.source!==frame.contentWindow || event.data?.studioDocument!==token)return;
   if(event.data.kind==='exit-fullscreen')exitFullscreen();
   if(event.data.kind==='error')reportError('Preview error: '+String(event.data.value).slice(0,1000));
   if(event.data.kind==='result-table')openResultTableDialog(event.data.value,{canEdit,request,created:refreshSchema,report:message,folderAPI:databaseFolderAPI});
   if(event.data.kind==='parameters'){
     if(!canEdit())return message('Choose Edit here before changing input parameters.');
     const values=event.data.value;
     if(!values||typeof values!=='object'||Array.isArray(values)||Object.entries(values).some(([key,value])=>!Object.hasOwn(activeParameters,key)||typeof value!==({date:'string',string:'string',number:'number',boolean:'boolean'}[activeParameters[key].type])||(typeof value==='number'&&!Number.isFinite(value))||(typeof value==='string'&&value.length>1000)))return message('Invalid input parameters.');
     current.parameters={...current.parameters,...values};dirty=true;message('Input parameters changed · open Data inputs and Apply & refresh. Previous inputs remain visible.');
   }
   if(event.data.kind==='state'){
     if(!canEdit())return message('Viewing only · scenario changes cannot be saved.');
     if(!validDocumentState(event.data.value))return message('State must be a JSON object under 1 MB.');
     current.state=JSON.parse(JSON.stringify(event.data.value));dirty=true;message('Scenario changes unsaved · Save document to keep assumptions and results.');
   }
 });
 name.oninput=()=>{dirty=true;message('Document name unsaved.');};
 const action=fn=>async()=>{try{await fn();}catch(e){recoveryExport.hidden=false;reportError(e.message);}};
 host.querySelector('[data-action=save]').onclick=action(save);
 host.querySelector('[data-action=preview]').onclick=action(run);
 host.querySelector('[data-action=edit]').onclick=()=>{stop();edit.hidden=false;preview.hidden=true;bindings.show();};
 host.querySelector('[data-action=stop]').onclick=()=>{stop();message('Preview stopped.');};
 host.querySelector('[data-action=snapshot]').onclick=action(()=>{if(!canEdit())throw Error('Choose Edit here first.');if(current?.bindings?.length)throw Error('Remove named bindings before replacing inputs with a manual snapshot.');const rows=snapshot();fields.inputs.value=JSON.stringify({baseline:rows},null,2);dirty=true;stop();message('Input snapshot staged · Save document to keep it.');});
 createButton.onclick=action(()=>{if(!loaded)throw Error('Documents are not loaded yet.');if(!canEdit())throw Error('Choose Edit here first.');const doc=scenarioDocument();documents.push(doc);dirty=true;renderList();open(doc);});
 const attach=document.createElement('details');attach.className='interactive-attach';attach.innerHTML='<summary>Open app folder…</summary><label>Folder inside this project<input placeholder="interactive/my-app" aria-label="App folder path"></label><button>Open folder</button><small role="status"></small>';list.after(attach);
 attach.querySelector('button').onclick=async()=>{try{if(!canEdit())throw Error('Choose Edit here first.');if(current)capture();const folder=attach.querySelector('input').value.trim(),code=await folderSource({folder});let doc=documents.find(d=>d.folder===folder);if(!doc){doc={id:crypto.randomUUID(),name:typeof code.name==='string'?code.name:folder,folder,stateVersion:code.stateVersion??1,inputs:{},state:{}};documents.push(doc);dirty=true;}renderList();open(doc);attach.querySelector('[role=status]').textContent='App attached · Save document to keep it.';}catch(e){attach.querySelector('[role=status]').textContent=e.message;}};
 return {
   get unsaved(){return dirty||busy||bindings.busy||bindings.unsaved;},
   async load(){const r=await request('/interactive-documents');const value=await r.json();if(!r.ok)throw Error(value.error||'Could not load interactive documents.');documents=value.documents;revision=value.revision;loaded=true;renderList();await recovery.load(revision);},
   renderTabs(el,active){for(const id of opened){const doc=documents.find(d=>d.id===id);const tab=document.createElement('div');tab.className='tab'+(active==='interactive:'+id?' active':'');tab.dataset.tabKey='interactive:'+id;tab.dataset.tabName=doc.name;const label=document.createElement('span');label.textContent=doc.name;const close=document.createElement('button');close.className='file-tab-close';close.textContent='×';close.title='Close interactive document';close.onclick=action(async()=>{if(dirty&&!await save())return;opened.delete(id);if(current===doc){stop();current=null;activate(null);}else redraw();});tab.append(label,close);tab.onclick=e=>{if(e.target!==close)open(doc);};el.append(tab);}
     for(const [key,source] of sources){const tab=document.createElement('div');tab.className='tab'+(active===key?' active':'');tab.dataset.tabKey=key;tab.dataset.tabName=source.path;const label=document.createElement('span');label.textContent=source.path.split('/').pop();const close=document.createElement('button');close.className='file-tab-close';close.textContent='×';close.title='Close source preview';close.onclick=()=>{sources.delete(key);if(selectedSource===key)open(source.doc);else redraw();};tab.append(label,close);tab.onclick=e=>{if(e.target!==close)inspect(source.doc,source.path,source.text);};el.append(tab);}
   },
   deactivate(){exitFullscreen();stop();},
   async flush(){if(dirty)await save();}
 };
}
