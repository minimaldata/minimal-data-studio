let activeRename=null;
// Reuse the same input when autosave redraws a name while the user is editing it.
export function editNameInline(root,{locate,value,label,save}){
 if(activeRename?.busy){activeRename.input.focus();return;}
 activeRename?.close();
 const input=document.createElement('input');input.className='inline-name-input';input.value=value;input.setAttribute('aria-label',label);input.title='Enter to save · Escape to cancel';input.autocomplete='off';
 const error=document.createElement('span');error.className='inline-name-error';error.setAttribute('role','alert');error.style.cssText='color:var(--danger,#b42318);font-size:12px;white-space:normal';
 let closed=false;const state={input,busy:false,close};activeRename=state;const hidden=new Set();
 function close(){closed=true;observer.disconnect();input.remove();error.remove();for(const el of hidden)el.hidden=false;if(activeRename===state)activeRename=null;}
 function mount(){if(closed||state.busy||input.isConnected)return;const target=locate();if(!target){close();return;}target.hidden=true;hidden.add(target);target.after(input);if(error.textContent)input.after(error);input.focus();}
 const observer=new MutationObserver(mount);observer.observe(root,{subtree:true,childList:true});
 async function commit(){
  if(closed||state.busy)return;const name=input.value.trim();if(!name||name===value){close();return;}
  state.busy=true;input.readOnly=true;input.removeAttribute('aria-invalid');error.textContent='';error.remove();
  try{await save(name);close();}catch(e){state.busy=false;input.readOnly=false;input.setAttribute('aria-invalid','true');input.title=e.message;error.textContent=e.message;mount();input.after(error);input.focus();}
 }
 input.addEventListener('click',e=>e.stopPropagation());input.addEventListener('dblclick',e=>e.stopPropagation());
 input.onkeydown=e=>{e.stopPropagation();if(e.key==='Escape'&&!state.busy){e.preventDefault();close();}else if(e.key==='Enter'){e.preventDefault();commit();}};
 input.onblur=()=>{if(input.isConnected)commit();};
 mount();input.select();
}
