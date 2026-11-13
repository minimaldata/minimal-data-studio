import {referenceHints} from './model-reference-hints.mjs';
// SQL model lifecycle UI; editor and transport are injected by the connector.
const el=(tag,text,cls)=>Object.assign(document.createElement(tag),{textContent:text||'',className:cls||''});
export function setupRemoteModels({request,dialog,getTab,getCode,setCode,openQuery,changed,wait,connections}) {
  let models=[],busy=false;
  const bar=el('div','','remote-model-bar');bar.hidden=true;
  document.getElementById('editorWrap').before(bar);
  const button=(text,fn)=>{const b=el('button',text);b.type='button';b.onclick=fn;return b;};
  const diffBlock=text=>{const pre=el('pre','','model-diff');for(const line of text.split('\n')){pre.append(el('span',line+'\n',line.startsWith('+')?'model-diff-add':line.startsWith('-')?'model-diff-remove':''));}return pre;};
  const current=()=>models.find(m=>m.id===getTab()?.remoteModel);
  async function load(){models=(await request('models')).models;}
  function adopt(model){models=models.filter(m=>m.id!==model.id).concat(model);const tab=getTab();if(tab?.remoteModel===model.id){tab.modelRevision=String(model.revision);tab.name=model.draft.name;}changed();}
  async function save(tab=getTab()){
    const m=models.find(m=>m.id===tab?.remoteModel);if(!m)throw Error('Reopen this model from the explorer.');
    const model=await request('model-save',{id:m.id,revision:Number(tab.modelRevision),...m.draft,sql:tab===getTab()?getCode():tab.sql});tab.modelRevision=String(model.revision);tab.name=model.draft.name;adopt(model);return model;
  }
  async function settings(connection,existing=null){
    const {d,form,error,close,field}=dialog(existing?'Model settings':'Save as BigQuery model');
    const c=connections().find(c=>c.id===connection);if(!c)return;
    if(!existing&&!getCode().trim()){form.append(el('p','Write your query first, then choose Save as model.'),close);d.showModal();return;}
    form.append(el('p',c.name+' · '+c.project,'remote-note'));
    if(existing)form.append(el('p','Permanent reference: {{ '+existing.reference+' }}','model-destination'));
    const name=field('Model name',existing?.draft.name||''),dataset=field('Destination dataset',existing?.draft.dataset||''),table=field('Destination name',existing?.draft.table||'');
    const label=el('label','Materialization'),kind=el('select');kind.add(new Option('View — saved SQL','view'));kind.add(new Option('Table — stored results','table'));kind.value=existing?.draft.kind||'view';label.append(kind);form.append(label);
    if(existing?.published){dataset.disabled=table.disabled=kind.disabled=true;form.append(el('p','Published destinations and materialization stay fixed in this preview.','remote-note'));}
    for(const f of [name,dataset,table])f.required=true;
    form.append(el('p','Saved locally as a draft. Nothing is created in BigQuery until you publish.','remote-note'));
    const submit=el('button','Save draft','primary');form.append(error,close,submit);
    form.onsubmit=async e=>{e.preventDefault();submit.disabled=true;try{
      const sql=existing?getCode():(getTab()?.connection===connection?getCode():'');
      const m=await request('model-save',{...(existing?{id:existing.id,revision:Number(getTab().modelRevision)}:{}),name:name.value,connection,dataset:dataset.value,table:table.value,kind:kind.value,sql});
      models=models.filter(x=>x.id!==m.id).concat(m);if(existing)adopt(m);d.close();openQuery(connection,m.draft.name,m.draft.sql,m);changed();
    }catch(e){error.textContent=e.message;}finally{submit.disabled=false;}};
    d.showModal();name.focus();
  }
  function dependencyList(form,result){
    form.append(el('h4','Uses published models'));
    if(!result.dependencies?.length)form.append(el('p','No managed references. Literal warehouse names are not tracked.','remote-note'));
    for(const item of result.dependencies||[])form.append(el('p',item.reference+' → '+item.destination,'model-destination'));
    if(result.dependents?.length){form.append(el('h4','Used by'));for(const item of result.dependents)form.append(el('p',item.name+' · '+item.phase,'remote-note'));}
  }
  async function compiled(){
    const tab=getTab(),source=getCode(),{d,form,error,close}=dialog('Compiled SQL & dependencies');
    form.append(el('p','References resolve to published outputs. This does not run SQL or contact Google.','remote-note'),error,close);d.showModal();
    try{
      const result=await request('model-compile',{id:tab.remoteModel,connection:tab.connection,sql:source});
      const pre=el('pre',result.compiledSql);form.insertBefore(pre,error);
      const dependencies=el('div');dependencyList(dependencies,result);form.insertBefore(dependencies,error);
    }catch(e){error.textContent=e.message;}
  }
  async function publish(){
    const {d,form,error,close}=dialog('Review publication');form.append(el('p','Saving and checking the draft…','remote-note'),error,close);d.showModal();
    busy=true;
    try{
      const m=await save(),plan=await request('model-prepare',{id:m.id,revision:m.revision});
      form.replaceChildren(el('h3',plan.replacing?'Publish changes':'Publish model'));
      form.append(el('p',plan.destination,'remote-target'),el('p',`Materialization: ${plan.kind} · Estimated query scan: ${Number(plan.estimatedBytes).toLocaleString()} bytes`,'remote-note'));
      form.append(el('p',plan.replacing?'This replaces the published definition'+(plan.kind==='table'?' and rebuilds its stored data.':' in BigQuery.'):'This creates a new '+plan.kind+' in BigQuery.'));
      form.append(el('p',plan.kind==='table'?'The full query runs in BigQuery. This table will not refresh automatically.':'This view runs its SQL when queried.','remote-note'));
      dependencyList(form,plan);
      const code=el('details');code.append(el('summary','What’s happening under the hood'),el('pre',plan.sql));form.append(code);
      const diff=diffBlock(plan.diff);form.append(el('h4','SQL changes'),diff);
      const submit=el('button',plan.replacing?'Publish changes':'Publish model','primary');form.append(error,close,submit);
      form.onsubmit=async e=>{e.preventDefault();submit.disabled=close.disabled=true;d.oncancel=e=>e.preventDefault();busy=true;
        try{const job=await request('start',{action:'model_publish',connection:m.draft.connection,token:plan.token,confirmed:true});error.textContent='Publishing in BigQuery…';await wait(job.id);await load();adopt(models.find(x=>x.id===m.id));d.close();}
        catch(e){error.textContent=e.message;await load();changed();submit.hidden=true;}
        finally{busy=false;close.disabled=false;d.oncancel=null;}
      };
    }catch(e){error.textContent=e.message;}finally{busy=false;}
  }
  function history(){
    const m=current(),{d,form,error,close}=dialog('Published SQL history');
    form.append(el('p','Restoring a version only changes your draft. Publish separately to change BigQuery. Historical table data is not restored.','remote-note'));
    if(!m.versions.length)form.append(el('p','No published versions yet.'));
    [...m.versions].reverse().forEach((v,i)=>{
      const detail=el('details');detail.append(el('summary',new Date(v.at).toLocaleString()+' · '+v.kind));
      detail.append(diffBlock(v.sqlDiff||v.sql));const source=el('details');source.append(el('summary','Full SQL'),el('pre',v.sql));detail.append(source);if(v.compiledSql){const compiled=el('details');compiled.append(el('summary','Published compiled SQL'),el('pre',v.compiledSql));detail.append(compiled);}
      detail.append(button('Restore SQL to draft',()=>{if(getCode()!==m.draft.sql&&!confirm('Replace the current editor text with this version?'))return;setCode(v.sql);changed();d.close();}));form.append(detail);
    });
    form.append(error,close);d.showModal();
  }
  function sync(visible){
    bar.replaceChildren();bar.hidden=!visible||!getTab()?.connection||(connections().find(c=>c.id===getTab()?.connection)?.provider||'bigquery')!=='bigquery';
    if(bar.hidden)return;
    const m=current();
    if(!getTab()?.remoteModel){bar.append(button('Save as model…',()=>settings(getTab().connection)),button('Compiled SQL & dependencies',compiled),el('span','Type {{ to reference a Studio model','remote-note'));return;}
    if(!m){bar.append(el('span','Model unavailable. Reopen it from BigQuery.'));return;}
    bar.append(el('span',m.draft.destination,'model-destination'),el('code','{{ '+m.reference+' }}','model-reference-key'),el('span',m.published?'Published · editing draft':'Local draft','model-state'));
    const status=el('span','','remote-error');status.setAttribute('role','status');
    const act=fn=>async()=>{try{busy=true;await fn();}catch(e){status.textContent=e.message;}finally{busy=false;}};
    if(m.pending){bar.append(button('Check publication status',act(async()=>{adopt(await request('model-reconcile',{id:m.id}));})));}
    else {bar.append(button('Save draft',act(save)),button('Settings',()=>settings(m.draft.connection,m)),button('Review & publish…',publish));}
    bar.append(button('Compiled SQL & dependencies',compiled),button('SQL history',history),button('Reload saved draft',act(async()=>{if(getCode()!==m.draft.sql&&!confirm('Replace the editor text with the latest saved draft?'))return;await load();const latest=current();setCode(latest.draft.sql);adopt(latest);})),status);
  }
  function render(connection,host){
    const group=(label,items)=>{const section=el('details');section.open=true;section.append(el('summary',label));for(const m of items){const b=button(m.draft.name,()=>openQuery(connection,m.draft.name,m.draft.sql,m));b.className='remote-table';b.title='{{ '+m.reference+' }} · '+m.draft.destination+' · '+m.draft.kind;section.append(b);}if(!items.length)section.append(el('p','None yet','remote-note'));host.append(section);};
    const own=models.filter(m=>m.draft.connection===connection);
    group('Published · Studio-managed',own.filter(m=>m.published));group('Local drafts',own.filter(m=>!m.published));
  }
  return {hints:(sql,cursor)=>referenceHints(sql,cursor,models,getTab()?.connection,getTab()?.remoteModel),dirty:tab=>{const m=models.find(m=>m.id===tab.remoteModel);return !!m&&tab.sql!==m.draft.sql;},load,sync,render,settings,save,get busy(){return busy;},managed:ref=>models.some(m=>m.published?.destination===ref)};
}
