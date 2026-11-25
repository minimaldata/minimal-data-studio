/** Project-owned recovery checkpoints, kept separate from explicit document saves. */
export function mountInteractiveRecovery(host,{request,canEdit,snapshot,restore,isDirty,isBusy=()=>false}){
 const panel=document.createElement('div');panel.className='interactive-recovery';host.before(panel);
 let timer,queue=Promise.resolve(),offered=null,ready=false,last='',saving=false;
 const notice=document.createElement('small');notice.setAttribute('role','status');panel.append(notice);
 async function post(value){const response=await request('/interactive-recovery',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});if(!response.ok){const value=await response.json();throw Error(value.error||'Recovery checkpoint failed.');}}
 function schedule(){clearTimeout(timer);if(!ready||offered||!canEdit())return;timer=setTimeout(()=>{queue=queue.catch(()=>{}).then(async()=>{if(!canEdit()||offered)return;const value=snapshot(),body=JSON.stringify(value);if(body===last)return;saving=true;try{await post(value);last=body;notice.textContent=value?'Draft backed up in this project · not yet saved':'All interactive work saved';}catch(error){notice.textContent='Draft backup failed: '+error.message+' Keep this window open or save your work.';}finally{saving=false;}});},500);}
 async function load(revision){
  let response;try{response=await request('/interactive-recovery');}catch{notice.textContent='Draft recovery is offline. Saved documents remain available; save before reloading.';return;}if(!response.ok){notice.textContent='Draft recovery unavailable. Save before reloading.';return;}try{offered=await response.json();}catch{notice.textContent='Recovery data could not be read. Saved documents are unchanged.';return;}ready=true;if(!offered)return;
  notice.textContent=offered.revision===revision?'Unsaved interactive work is available to recover.':'A recovery draft belongs to an older saved revision. Download it to inspect without replacing newer work.';
  const recover=document.createElement('button');recover.textContent='Restore draft';recover.disabled=offered.revision!==revision;
  const download=document.createElement('button');download.textContent='Download recovery';download.onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(offered,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='studio-interactive-recovery.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  const discard=document.createElement('button');discard.textContent='Keep saved version';
  recover.onclick=async()=>{if(!canEdit())return; if(isDirty()||isBusy()){notice.textContent='This window has new edits. Save them before restoring an older draft.';return;}const value=offered;try{const response=await request('/interactive-documents');if(!response.ok)throw Error('Could not verify the saved revision. Try again.');const saved=await response.json();if(saved.revision!==value.revision)throw Error('Saved work has changed. Download recovery instead; newer work was not replaced.');offered=null;await restore(value);panel.replaceChildren(notice);notice.textContent='Draft restored · review it, then Save document. SQL drafts still need Save SQL.';schedule();}catch(e){offered=value;notice.textContent=e.message;}};
  discard.onclick=async()=>{if(!canEdit())return;try{await post(null);offered=null;last='null';panel.replaceChildren(notice);notice.textContent='Kept saved version.';schedule();}catch(e){notice.textContent=e.message;}};
  panel.append(recover,download,discard);
 }
 window.addEventListener('beforeunload',event=>{if(isDirty()||isBusy()||saving){event.preventDefault();event.returnValue='';}});
 return {schedule,load};
}
