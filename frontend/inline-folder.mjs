let current=null;
// A temporary tree row; reattach it if autosave redraws the surrounding tree.
export function editFolderInline(panel,{label='New folder',value='',locate,save}){
 if(current?.busy){current.input.focus();return;}
 current?.close();
 const form=document.createElement('form');form.className='inline-folder-form';form.setAttribute('aria-label',label);
 form.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 7V5h6l2 2h10v13H3Z"/></svg>';
 const input=document.createElement('input');input.value=value;input.placeholder='Folder name';input.setAttribute('aria-label',label);input.autocomplete='off';input.title='Enter to save · Escape to cancel';
 const error=document.createElement('div');error.className='inline-folder-error';error.setAttribute('role','alert');
 form.append(input,error);
 const hidden=new Set();let closed=false;
 const state={form,input,busy:false,close};current=state;
 function close(){closed=true;observer.disconnect();form.remove();for(const row of hidden)row.hidden=false;if(current===state)current=null;}
 function mount(){
  if(closed||state.busy||form.isConnected)return;
  const at=locate();if(!at?.host){close();return;}
  if(at.replace){at.replace.hidden=true;hidden.add(at.replace);}
  form.style.paddingLeft=(at.indent||6)+'px';
  at.host.insertBefore(form,at.before||null);input.focus();
 }
 const observer=new MutationObserver(mount);
 observer.observe(panel,{subtree:true,childList:true});
 form.onkeydown=e=>{if(e.key==='Escape'&&!state.busy){e.preventDefault();e.stopPropagation();close();}};
 async function commit(){
  if(state.busy||closed)return;
  if(!input.value.trim()){close();return;}
  state.busy=true;input.readOnly=true;error.textContent='';
  try{await save(input.value);close();}catch(e){error.textContent=e.message;state.busy=false;input.readOnly=false;mount();input.focus();}
 }
 form.onsubmit=e=>{e.preventDefault();commit();};
 input.onblur=()=>{if(form.isConnected&&!closed&&!state.busy)commit();};
 panel.classList.remove('collapsed');mount();input.select();
}
