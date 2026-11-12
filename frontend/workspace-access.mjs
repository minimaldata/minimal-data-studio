/** Cooperative single-writer lease. No credentials or document contents travel in heartbeats. */
export async function setupWorkspaceAccess({notice, transport=window.fetch.bind(window), interval=3000}) {
  const client=crypto.randomUUID(), ticketKey='studio-edit-ticket:'+location.origin, requestKey='studio-edit-request:'+location.origin;
  let writer=false, supported=true, paused=false, initialized=false, lost=false, polling=false, waiting=false;
  let baseline=null, hooks={}, lastMessage='', busyRequests=0, intent=0, reloadingForEdit=false;
  const message=document.createElement('span'), edit=document.createElement('button');edit.textContent='Edit here';
  const cancel=document.createElement('button');cancel.textContent='Cancel request';
  notice.replaceChildren(message,edit,cancel);notice.style.display='flex';notice.style.gap='12px';notice.style.alignItems='center';
  function display(text='') {
    notice.hidden=writer&&!text;message.textContent=text||'Open elsewhere · Viewing only. Saved changes appear automatically.';
    edit.hidden=writer||waiting;cancel.hidden=!waiting;document.documentElement.classList.toggle('workspace-viewing',!writer||paused);
    for(const el of document.querySelectorAll('.CodeMirror'))el.CodeMirror?.setOption('readOnly',!writer||paused);
  }
  async function request(action,extra={}) {
    const response=await transport('/workspace-access',{method:'POST',headers:{'Content-Type':'application/json','X-Client':client},body:JSON.stringify({action,...extra}),signal:AbortSignal.timeout(6000)});
    if(response.status===404){supported=false;return {writer:true};}
    const result=await response.json();if(!response.ok)throw Error(result.error||'Could not contact the project.');if(result.ticket)sessionStorage.setItem(ticketKey,result.ticket);return result;
  }
  // Tag every local API request, including calls from feature modules and unload saves.
  window.fetch=async(input,options={})=>{
    const url=new URL(typeof input==='string'?input:input.url,location.href);
    if(url.origin!==location.origin)return transport(input,options);
    const headers=new Headers(options.headers||(input instanceof Request?input.headers:undefined));headers.set('X-Client',client);
    const method=(options.method||(input instanceof Request?input.method:'GET')).toUpperCase();
    if(method!=='GET')busyRequests++;
    try{return await transport(input,{...options,headers});}
    finally{if(method!=='GET')busyRequests--;}
  };
  // New tabs can inherit sessionStorage from their opener. Only a genuine reload may use a reload ticket.
  let ticket=performance.getEntriesByType('navigation')[0]?.type==='reload'?sessionStorage.getItem(ticketKey):null;sessionStorage.removeItem(ticketKey);
  try{const info=await request('hello',{ticket});writer=info.writer;baseline=signature(info);if(sessionStorage.getItem(requestKey)){const requested=await request('request');waiting=requested.waiting;writer=requested.writer;if(writer)sessionStorage.removeItem(requestKey);}}
  catch(e){paused=true;lastMessage='Could not connect. Editing is paused; your work stays in this tab.';}
  display(lastMessage);
  function signature(info){return JSON.stringify([info.savedVersion,info.editorRevision,info.changes]);}
  async function enterEditor(){
    if(hooks.unsaved?.()){display('This tab has unsaved work. Copy it or save it before switching editors.');return;}
    const info=await request('ticket');sessionStorage.setItem(ticketKey,info.ticket);sessionStorage.removeItem(requestKey);reloadingForEdit=true;location.reload();
  }
  async function poll(){
    if(!supported||polling||!initialized)return;polling=true;const started=intent;
    try{
      const info=await request('heartbeat');if(started!==intent)return;
      if(writer&&!info.writer){writer=false;lost=true;paused=true;}
      waiting=info.waiting;
      if(!writer&&info.writer){await enterEditor();return;}
      if(writer&&info.requested){
        const reason=hooks.blocker?.();
        if(reason){display('Another tab wants to edit. '+reason);return;}
        paused=true;display('Saving before moving editing to the other tab…');
        try{
          if(busyRequests)return;
          await hooks.flush?.();
          if(hooks.unsaved?.()||busyRequests)throw Error('Some changes are not saved yet.');
          const yielded=await request('yield');writer=yielded.writer;lost=!writer;paused=!writer;
          baseline=signature(info);display(writer?'':'Editing moved to the other tab. This tab is now viewing only.');
        }catch(e){paused=false;display('Could not transfer editing. '+e.message+' Save your work here, then try again.');}
        return;
      }
      if(writer){paused=false;display();baseline=signature(info);return;}
      if(lost&&hooks.unsaved?.()){display('Editing is paused. Unsaved work is still here—copy it before reloading.');return;}
      paused=false;
      display(waiting?'Waiting for the other tab to finish saving…':info.available?'The other editing tab has closed. You can edit here.':'');
      const next=signature(info);
      if(!waiting&&next!==baseline){baseline=next;if(!hooks.unsaved?.())location.reload();}
    }catch(e){paused=true;display('Connection lost. Editing is paused; work stays in this tab. Reconnecting…');}
    finally{polling=false;}
  }
  edit.onclick=async()=>{
    if(hooks.unsaved?.()){display('Unsaved work is still here. Copy it before reloading and taking over.');return;}
    intent++;sessionStorage.setItem(requestKey,'1');edit.disabled=true;
    try{const info=await request('request');waiting=info.waiting;if(info.writer)await enterEditor();else display('Waiting for the other tab to finish saving…');}
    catch(e){display(e.message);}finally{edit.disabled=false;}
  };
  cancel.onclick=async()=>{intent++;sessionStorage.removeItem(requestKey);await request('cancel');waiting=false;display();};
  // Viewing tabs can scroll/select/copy, navigate existing analysis tabs and expand side panels.
  const navigation='[data-analysis], #nbList .saved .nm, #dashList .saved .nm, [role="tab"], .panel-heading, .panel h2, .panel-rail, #closeExplorer, #closeHelp';
  function guard(event){
    if(writer&&!paused||notice.contains(event.target))return;
    if(event.type==='click' && event.target.closest('a[href]'))return;
    const tab=event.target.closest('#tabs .tab');
    if(event.type==='click' && !event.target.closest('button,.acts,.x') && (event.target.closest(navigation)||(tab&&tab.textContent.trim()!=='+')))return;
    if(event.type==='keydown'){
      if((event.metaKey||event.ctrlKey)&&['c','a','f','r','l','w','t','+','-','0'].includes(event.key.toLowerCase()))return;
      if(event.target.matches('select,input[type=number],input[type=date]')&&['ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();event.stopImmediatePropagation();return;}
      if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','PageUp','PageDown','Home','End','Tab','Escape','Shift','Meta','Control','Alt'].includes(event.key))return;
    }
    event.preventDefault();event.stopImmediatePropagation();
  }
  for(const event of ['click','dblclick','beforeinput','input','change','paste','cut','drop','submit','keydown'])document.addEventListener(event,guard,true);
  new MutationObserver(()=>{if(!writer||paused)for(const el of document.querySelectorAll('.CodeMirror')){if(el.CodeMirror&&!el.CodeMirror.getOption('readOnly'))el.CodeMirror.setOption('readOnly',true);}}).observe(document.body,{childList:true,subtree:true});
  addEventListener('pagehide',()=>{if(reloadingForEdit||hooks.unsaved?.()||busyRequests)return;transport('/workspace-access',{method:'POST',keepalive:true,headers:{'Content-Type':'application/json','X-Client':client},body:JSON.stringify({action:'release'})}).catch(()=>{});});
  setInterval(poll,interval);
  return {client,get canEdit(){return writer&&!paused;},get canSave(){return writer;},get supported(){return supported;},start(callbacks){hooks=callbacks;initialized=true;display(lastMessage);},poll};
}
