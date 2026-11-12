import {setupTaskSchedule} from './task-schedule.mjs';
import {jsonRequest} from './api.mjs';

/** File-backed task editors; each open tab retains its own unsaved buffer. */
export function setupTasks({activate, redraw}) {
  const list=document.getElementById('taskList'), panels=new Map();
  const host=document.createElement('section');host.id='taskViewer';host.hidden=true;
  document.querySelector('.work').append(host);
  let state={tasks:[],runs:[],revision:0}, activeKey=null;
  const text=(tag,value)=>Object.assign(document.createElement(tag),{textContent:value});
  async function refresh(){
    try{state=await jsonRequest('/tasks');list.replaceChildren();
      for(const task of state.tasks){const row=text('button',task.name);row.className='saved task-row';row.append(text('small',state.runs.find(r=>r.taskId===task.id)?.status||'Not run'));row.onclick=()=>open(task);list.append(row);}
      if(!state.tasks.length)list.append(text('p','Write a Python script to create your first task.'));
      for(const tab of panels.values())renderRun(tab);
    }catch(e){list.textContent=e.message;}
  }
  const bindingsFor=tab=>[...tab.el('credentials').children].filter(row=>row.querySelector('input').checked).map(row=>({id:row.querySelector('input').dataset.id,env:row.querySelectorAll('input')[1].value.trim()}));
  const requiredFor=tab=>tab.el('required').value.split(/[\s,]+/).filter(Boolean);
  function credentialStatus(tab){
    const bindings=bindingsFor(tab), available=new Set((tab.available||[]).map(c=>c.id));
    const missing=requiredFor(tab).filter(env=>!bindings.some(b=>b.env===env&&available.has(b.id)));
    const disconnected=bindings.some(b=>!available.has(b.id));
    const button=tab.el('credential-status');
    button.className='task-credential-status'+(missing.length||disconnected?' missing':bindings.length?' connected':'');
    button.textContent=missing.length?'Required credential missing':disconnected?'Credential disconnected':bindings.length?`${bindings.length} credential${bindings.length===1?'':'s'} connected`:'Credentials: none selected';
    button.title=missing.length?'Connect '+missing.join(', '):'Open credential settings';
    tab.el('missing').textContent=missing.length?'Required: '+missing.join(', ')+'. Select a connected key below, or open Manage credentials.':disconnected?'A selected key is disconnected. Manage credentials, then check again.':'';
    return missing.length>0||disconnected;
  }
  async function loadCredentials(tab,bindings=bindingsFor(tab)){
    const result=await jsonRequest('/tasks/credentials',{});tab.available=result.credentials||[];
    tab.el('credentials').replaceChildren();
    const choices=[...tab.available,...bindings.filter(b=>!tab.available.some(c=>c.id===b.id)).map(b=>({id:b.id,name:'Unavailable credential — reconnect or deselect'}))];
    for(const credential of choices){const binding=bindings.find(b=>b.id===credential.id),row=document.createElement('label');row.className='task-credential';const check=document.createElement('input');check.type='checkbox';check.dataset.id=credential.id;check.checked=!!binding;const env=document.createElement('input');env.value=binding?.env||credential.name.toUpperCase().replace(/[^A-Z0-9_]/g,'_');env.setAttribute('aria-label','Environment variable for '+credential.name);check.onchange=env.oninput=()=>dirty(tab);row.append(check,text('span',credential.name),env);tab.el('credentials').append(row);}
    tab.el('note').textContent=result.error||'Select only the keys this script needs. Native approval is required before a changed script can use them.';
    renderRun(tab);
  }
  function dirty(tab){tab.dirty=true;redraw();renderRun(tab);}
  function renderRun(tab){
    const runs=state.runs.filter(r=>r.taskId===tab.task?.id), running=runs.find(r=>['starting','running','stopping'].includes(r.status));
    const el=tab.el;tab.editor?.setOption('readOnly',tab.busy||tab.loading);for(const field of tab.pane.querySelectorAll('input, [data-existing] select'))field.disabled=tab.busy||tab.loading;el('run').disabled=tab.busy||!!running||tab.loading||credentialStatus(tab);el('save').disabled=tab.busy||!!running||tab.loading;el('stop').disabled=tab.busy||!running;
    el('run').textContent=tab.dirty||!tab.task?'Save and run':'Run';
    el('status').textContent=running?.status||(tab.dirty?'Unsaved changes':runs[0]?.status||'Not run');
    el('runs').replaceChildren();for(const run of runs){const option=text('option',`${new Date(run.started*1000).toLocaleString()} · ${run.trigger==='schedule'?'Scheduled · ':''}${run.status}`);option.value=run.id;el('runs').append(option);}
    if(!runs.some(r=>r.id===tab.run))tab.run=runs[0]?.id;
    if(tab.run)el('runs').value=tab.run;
    const run=runs.find(r=>r.id===tab.run),log=el('log'),bottom=log.scrollHeight-log.scrollTop-log.clientHeight<30;
    log.textContent=run?.log||'No output yet.';if(bottom)log.scrollTop=log.scrollHeight;
    tab.schedule?.render();
    el('info').textContent=run?`${run.script} · ${Math.round(((run.ended||Date.now()/1000)-run.started)*10)/10}s${run.exitCode!==undefined?' · exit '+run.exitCode:''}${run.truncated?' · last 100,000 characters':''}`:'';
  }
  async function save(tab){
    if(tab.loading)throw Error('Wait for the script to load.');
    const bindings=bindingsFor(tab);
    const script=tab.el('path').value.trim(),code=tab.editor.getValue();
    const result=await jsonRequest('/tasks/save',{revision:tab.revision,task:{...(tab.task?{id:tab.task.id}:{}),name:tab.el('name').value,script,credentials:bindings,requiredCredentials:requiredFor(tab)},code,scriptHash:tab.hash});
    tab.task=result.tasks.find(t=>t.id===tab.task?.id)||result.tasks.at(-1);tab.revision=result.revision;
    // Hash the bytes we saved, not a subsequent external file edit.
    tab.hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(code))),v=>v.toString(16).padStart(2,'0')).join('');
    tab.dirty=false;tab.el('path').readOnly=true;state=result;await refresh();redraw();
  }
  async function open(task=null){
    const existing=[...panels].find(([,tab])=>task&&tab.task?.id===task.id);
    if(existing){activate('task:'+existing[0]);return;}
    await refresh();
    const key=crypto.randomUUID(),pane=document.createElement('section');pane.className='task-pane';
    pane.innerHTML=`<div class="task-actions"><button data-save>Save script</button><button data-run class="primary">Save and run</button><button data-credential-status aria-expanded="false">Credentials: none selected</button><button data-stop>Stop</button><span data-status role="status"></span></div>
      <details class="task-settings"><summary>Task settings · file and credentials</summary><div class="task-fields"><label>Name<input data-name maxlength="100"></label><label>Python file<input data-path placeholder="scripts/my_task.py"></label></div><div data-existing></div><p data-runtime class="task-note"></p><h3>Credentials</h3><button data-manage class="task-manage">Manage credentials…</button> <button data-check>Check credentials</button><label class="task-required">Required environment names<input data-required placeholder="e.g. CFBD_API_KEY"></label><p class="task-note">Comma-separated. These must have connected keys selected below before Run.</p><p data-missing role="status"></p><div data-credentials></div><p data-note class="task-note"></p></details>
      <p data-error role="alert"></p><div data-editor class="task-code"></div><section class="task-output"><header><strong>Logs</strong><select data-runs aria-label="Task run"></select></header><p data-info class="task-note"></p><pre data-log tabindex="0" aria-label="Task output"></pre></section>`;
    host.append(pane);const el=name=>pane.querySelector(`[data-${name}]`);
    const tab={key,pane,el,task,hash:null,revision:state.revision,dirty:!task,loading:true,busy:false};panels.set(key,tab);
    el('required').value=(task?.requiredCredentials||[]).join(', ');el('required').oninput=()=>dirty(tab);
    el('credential-status').onclick=()=>{pane.querySelector('details').open=true;el('credential-status').setAttribute('aria-expanded','true');el('required').focus();};
    pane.querySelector('details').ontoggle=()=>el('credential-status').setAttribute('aria-expanded',String(pane.querySelector('details').open));
    el('manage').onclick=async()=>{try{await jsonRequest('/tasks/manage-credentials',{});el('note').textContent='Connect the key in the Mac window, then return here and click Check credentials.';}catch(e){el('error').textContent=e.message;}};
    el('check').onclick=async()=>{try{await loadCredentials(tab);}catch(e){el('error').textContent=e.message;}};
    el('name').value=task?.name||'';el('path').value=task?.script||'';el('path').readOnly=!!task;
    const editor=window.CodeMirror(el('editor'),{value:'',mode:'python',lineNumbers:true,indentUnit:4,extraKeys:{'Cmd-S':()=>perform(tab,'save'),'Ctrl-S':()=>perform(tab,'save'),'Cmd-Enter':()=>perform(tab,'run'),'Ctrl-Enter':()=>perform(tab,'run')}});tab.editor=editor;
    editor.on('change',()=>{if(!tab.loading)dirty(tab);});
    el('path').oninput=()=>{tab.customPath=true;dirty(tab);};
    el('name').oninput=()=>{if(!tab.task&&!tab.customPath&&!el('path').readOnly){el('path').value='scripts/'+(el('name').value.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'')||'task')+'.py';}dirty(tab);};
    el('runtime').textContent=`Python: ${state.runtime||'Project environment'} · Fresh process, project working directory.`;
    if(!task){pane.querySelector('details').open=true;const picker=document.createElement('select');picker.setAttribute('aria-label','Use existing Python file');picker.append(text('option','Or choose an existing script…'));for(const script of state.scripts||[]){const option=text('option',script);option.value=script;picker.append(option);}el('existing').append(picker);
      picker.onchange=async()=>{if(picker.selectedIndex<1)return;if(tab.dirty&&editor.getValue()&&!confirm('Replace this unsaved script with the selected file?'))return;try{const result=await jsonRequest('/tasks/script',{script:picker.value});tab.loading=true;editor.setValue(result.code);tab.hash=result.hash;el('path').value=picker.value;el('path').readOnly=true;tab.loading=false;dirty(tab);}catch(e){el('error').textContent=e.message;}};
    }
    for(const action of ['save','run','stop'])el(action).onclick=()=>perform(tab,action);
    el('runs').onchange=()=>{tab.run=el('runs').value;renderRun(tab);};
    tab.schedule=setupTaskSchedule(tab,{getState:()=>state,refresh,run:()=>perform(tab,'run')});
    activate('task:'+key);
    try{
      if(task){const result=await jsonRequest('/tasks/script',{script:task.script});editor.setValue(result.code);tab.hash=result.hash;}
      await loadCredentials(tab,task?.credentials||[]);
      tab.loading=false;
    }catch(e){el('error').textContent=e.message;/* Never permit saving a failed load over the original file. */}
    renderRun(tab);editor.refresh();
  }
  async function perform(tab,action){
    if(tab.busy)return;tab.busy=true;tab.el('error').textContent='';renderRun(tab);
    try{if(action==='run'){await loadCredentials(tab);if(credentialStatus(tab))throw Error('Connect the missing credentials in Task settings before running.');}
      if(action==='save'||action==='run'&&(tab.dirty||!tab.task))await save(tab);
      if(action!=='save'){await jsonRequest('/tasks/'+action,{id:tab.task.id});if(action==='run')tab.run=null;await refresh();}
    }catch(e){tab.el('error').textContent=e.message;}finally{tab.busy=false;renderRun(tab);}
  }
  document.getElementById('newTask').onclick=()=>open();
  window.addEventListener('beforeunload',e=>{if([...panels.values()].some(t=>t.dirty||t.schedule?.unsaved)){e.preventDefault();e.returnValue='';}});
  refresh();setInterval(()=>{if(activeKey||!document.getElementById('explorerTasks').hidden)refresh();},1500);
  return {get unsaved(){return [...panels.values()].some(t=>t.dirty||t.busy||t.schedule?.unsaved);},renderTabs(container,active){activeKey=active?.startsWith('task:')?active.slice(5):null;host.hidden=!activeKey;
    for(const [key,tab] of panels){tab.pane.hidden=activeKey!==key;const button=text('div',(tab.task?.name||tab.el('name').value||'New task')+(tab.dirty?' •':''));button.className='tab'+(activeKey===key?' active':'');button.append(text('small','Python task'));const close=text('button','×');close.setAttribute('aria-label','Close task '+(tab.task?.name||'New task'));close.onclick=e=>{e.stopPropagation();if((tab.dirty||tab.schedule?.unsaved)&&!confirm('Close without saving this task’s script or schedule changes?'))return;panels.delete(key);tab.pane.remove();activate(activeKey===key?null:active);};button.append(close);button.onclick=()=>activate('task:'+key);container.append(button);if(activeKey===key)requestAnimationFrame(()=>tab.editor.refresh());}
  }};
}
