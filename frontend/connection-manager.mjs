import {setLoading} from './loading.mjs';
// Shared catalog UI. Transport and provider-specific editors stay injected.
export function connectionManager({request,dialog,settings,refresh,projectState,providers}){
 const el=(tag,text)=>Object.assign(document.createElement(tag),{textContent:text??''});
 const button=(label,action)=>{const b=el('button',label);b.type='button';b.onclick=action;return b;};
 const label=c=>providers[c.preset==='supabase'?'supabase':c.provider]||c.provider;
 async function manager(){
  const {d,form,error,close}=dialog('Connections on this Mac');close.textContent='Done';
  form.append(el('p','Configure once, then add connections to your projects. Passwords stay in Keychain.'));
  const search=el('input');search.placeholder='Search connections…';search.setAttribute('aria-label','Search connections');const list=el('div');list.className='shared-connections-list';
  let catalog;async function draw(){try{catalog=await request('connections');list.replaceChildren();
   for(const c of catalog.connections.filter(c=>(c.name+' '+label(c)).toLowerCase().includes(search.value.toLowerCase()))){
    const row=el('article');row.className='shared-connection-row';row.append(el('strong',c.name),el('small',label(c)));
    const used=el('details');used.append(el('summary',c.projects.length?`Used by ${c.projects.length} project${c.projects.length===1?'':'s'}`:'Not added to any project'));
    for(const p of c.projects)used.append(el('p',p.path));row.append(used);
    const actions=el('div');actions.className='remote-actions';
    actions.append(button('Edit',()=>settings(c,c.provider,c.preset,{central:true,after:draw})),button('Duplicate',()=>settings({...c,id:undefined,name:c.name+' copy',projects:[]},c.provider,c.preset,{central:true,after:draw})));
    actions.append(button('Delete',async()=>{const box=dialog('Delete '+c.name+'?');box.form.append(el('p','Remove this connection from this Mac. Its project links will remain unavailable until reconnected. Tables and saved SQL are not deleted.'));for(const p of c.projects)box.form.append(el('p',p.path));box.form.append(box.close,button('Delete connection',async()=>{try{await request('connection-delete',{id:c.id,revision:catalog.revision,confirmed:true});box.d.close();await refresh();await draw();}catch(e){box.error.textContent=e.message;}}));box.d.showModal();}));
    const status=el('p','Not tested');status.className='remote-status';status.setAttribute('role','status');status.dataset.phase='idle';
    const test=button('Test connection',async()=>{
     for(const b of actions.querySelectorAll('button'))b.disabled=true;
     let active=true,polling=false;
     const show=(phase,message)=>{status.dataset.phase=phase;status.textContent=message;setLoading(status,!['connected','error','idle'].includes(phase));};
     const phases={working:'Connecting…',credentials:'Check the Mac app for credential approval or an MFA code prompt.',mfa_push:'Check your authenticator for a push if prompted. Cached approval may skip it.',signing_in:'Complete sign-in in your browser or the Mac app.'};
     show('working',phases.working);
     const timer=setInterval(async()=>{if(polling||!active)return;polling=true;try{const result=await request('connection-test-status',{connection:c.id});if(active&&phases[result.phase])show(result.phase,phases[result.phase]);}catch{}finally{polling=false;}},500);
     try{const result=await request('connection-test',{connection:c.id});show('connected',result.message);}
     catch(e){show('error',e.message);}
     finally{active=false;clearInterval(timer);for(const b of actions.querySelectorAll('button'))b.disabled=false;}
    });actions.prepend(test);
    row.append(actions,status);list.append(row);
   }
   if(!list.children.length)list.append(el('p','No connections found.'));
  }catch(e){error.textContent=e.message;}}
  search.oninput=draw;form.append(search,list,button('New connection…',()=>chooseType({central:true,after:draw})),close);d.showModal();await draw();
 }
 function chooseType(options={}){
  const {d,form,close}=dialog('Add connection'),choices=el('div');choices.className='connection-choices';
  for(const [key,name] of Object.entries(providers))choices.append(button(name,()=>{d.close();settings(null,key==='supabase'?'postgres':key,key==='supabase'?'supabase':'',options);}));
  for(const b of choices.children)b.setAttribute('aria-label','Connect '+b.textContent);form.append(choices,close);d.showModal();
 }
 async function picker(replace=null){
  await refresh();const {d,form,error,close}=dialog(replace?'Reconnect '+replace.name:'Add connection');
  const search=el('input');search.placeholder='Search connections…';search.setAttribute('aria-label','Search connections');const list=el('div');list.className='shared-connections-list';
  let catalog;try{catalog=await request('connections');}catch(e){error.textContent=e.message;catalog={connections:[]};}
  const draw=()=>{list.replaceChildren();for(const c of catalog.connections.filter(c=>c.name.toLowerCase().includes(search.value.toLowerCase())&&(!replace||c.provider===replace.provider))){
   const added=projectState().connections.some(p=>p.sharedId===c.id&&!p.missing),b=button(c.name+' · '+label(c)+(added?' · Added':''),async()=>{
    if(replace&&!confirm('Use '+c.name+' for queries and models linked to '+replace.name+'? Review the account and destination before running them.'))return;
    try{await request('connection-attach',{revision:projectState().revision,connectionId:c.id,replace:replace?.id,confirmed:Boolean(replace)});await refresh();d.close();}catch(e){error.textContent=e.message;}
   });b.disabled=added;list.append(b);
  }if(!list.children.length)list.append(el('p','No saved connections on this Mac.'));};search.oninput=draw;
  form.append(search,list,button('New connection…',()=>{d.close();chooseType();}),button('Manage connections…',async()=>{d.close();try{const result=await request('manage-connections');if(result.opened)return;}catch{}manager();}),close);
  // Keep first-time setup direct while existing connections get a searchable picker.
  if(!catalog.connections.length&&!replace){d.remove();chooseType();return;}
  draw();d.showModal();
 }
 return {manager,picker,chooseType};
}
