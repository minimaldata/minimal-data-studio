// A tab list is a view over editor-owned close/open actions, never a document store.
export function createOpenTabsMenu({anchor,entries,onDismiss}){
 const box=document.createElement('div');box.id='openTabMenu';box.className='tab-tools-menu';box.setAttribute('aria-label','Open tabs');
 const rect=anchor.getBoundingClientRect();box.style.top=Math.min(rect.bottom+4,innerHeight-250)+'px';box.style.left=Math.max(8,Math.min(rect.left,innerWidth-380))+'px';
 const input=document.createElement('input');input.placeholder='Search open tabs…';input.setAttribute('aria-label','Search open tabs');
 const selectionTools=document.createElement('div');selectionTools.className='tab-menu-selection';
 const selectAll=document.createElement('button');selectAll.textContent='Select all';
 const clearSelection=document.createElement('button');clearSelection.textContent='Clear selection';
 selectionTools.append(selectAll,clearSelection);
 const list=document.createElement('div');list.className='open-tabs-list';
 const footer=document.createElement('div');footer.className='tab-menu-footer';
 const closeSelected=document.createElement('button');closeSelected.textContent='Close selected';
 const selectionNote=document.createElement('span');selectionNote.setAttribute('aria-live','polite');footer.append(selectionNote,closeSelected);
 box.append(input,selectionTools,list,footer);document.body.append(box);
 let selected=new Set(),busy=false,disposed=false,rowStates=[];
 function dismiss(){if(disposed)return;disposed=true;clearInterval(timer);box.remove();onDismiss();}
 function syncStatus(){for(const {entry,status,open} of rowStates){
  const state=entry.status?.()||{};const labels=[];
  if(entry.active)labels.push('Active');if(state.running)labels.push('Running');if(state.dirty)labels.push('Unsaved');if(entry.preview)labels.push('Preview');
  status.textContent=labels.join(' · ');status.classList.toggle('has-unsaved',!!state.dirty);status.classList.toggle('is-running',!!state.running);
  open.setAttribute('aria-label',entry.name+(labels.length?' — '+labels.join(', '):''));
 }}
 function syncSelection(){selectionNote.textContent=selected.size?`${selected.size} selected`:'';closeSelected.disabled=busy||!selected.size;
  selectAll.disabled=busy||!rowStates.some(({entry})=>!selected.has(entry.key));
  selectAll.title=input.value?'Select all matching tabs':'Select all open tabs';
  clearSelection.disabled=busy||!selected.size;
 }
 selectAll.onclick=()=>{for(const {entry} of rowStates)selected.add(entry.key);draw();input.focus();};
 clearSelection.onclick=()=>{selected.clear();draw();input.focus();};
 async function closeEntries(items){
  if(busy)return;busy=true;syncSelection();
  try{for(const item of items){await item.close();}}finally{
   busy=false;if(!disposed){draw();input.focus();}
  }
 }
 function draw(){
  const focus=document.activeElement;const focusKey=focus?.closest?.('[data-tab-key]')?.dataset.tabKey;const focusAction=focus?.dataset.action;
  list.replaceChildren();rowStates=[];
  for(const key of selected)if(!entries.some(e=>e.key===key))selected.delete(key);
  const matching=entries.filter(e=>e.name.toLowerCase().includes(input.value.toLowerCase()));
  for(const group of [...new Set(matching.map(e=>e.group))]){
   const heading=document.createElement('small');heading.textContent=group;heading.className='tab-menu-group';list.append(heading);
   for(const entry of matching.filter(e=>e.group===group)){
    const row=document.createElement('div');row.className='tab-menu-row'+(entry.active?' current':'');row.dataset.tabKey=entry.key;
    const check=document.createElement('input');check.type='checkbox';check.dataset.action='select';check.setAttribute('aria-label','Select '+entry.name);check.checked=selected.has(entry.key);
    check.onchange=()=>{check.checked?selected.add(entry.key):selected.delete(entry.key);syncSelection();};
    const open=document.createElement('button');open.className='tab-menu-open';open.dataset.action='open';if(entry.active)open.setAttribute('aria-current','page');
    const title=document.createElement('span');title.className='tab-menu-title';title.textContent=entry.name;
    const status=document.createElement('span');status.className='tab-menu-status';open.append(title,status);open.onclick=()=>{dismiss();entry.open();};
    const close=document.createElement('button');close.className='tab-menu-close';close.dataset.action='close';close.textContent='×';close.title='Close tab';close.setAttribute('aria-label','Close '+entry.name);close.onclick=()=>closeEntries([entry]);
    row.append(check,open,close);list.append(row);rowStates.push({entry,status,open});
   }
  }
  if(!matching.length){const empty=document.createElement('p');empty.className='tab-menu-empty';empty.textContent='No matching tabs';list.append(empty);}
  syncStatus();syncSelection();
  if(focusKey){const row=[...list.children].find(r=>r.dataset.tabKey===focusKey);(row?.querySelector(`[data-action="${focusAction}"]`)||input).focus();}
 }
 input.oninput=draw;
 closeSelected.onclick=()=>closeEntries(entries.filter(e=>selected.has(e.key)));
 box.addEventListener('keydown',e=>{
  if(e.key==='Escape'){e.preventDefault();dismiss();document.querySelector('.open-tabs-button')?.focus();return;}
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){
   const buttons=rowStates.map(r=>r.open);if(!buttons.length)return;e.preventDefault();
   const row=document.activeElement?.closest?.('[data-tab-key]');const at=buttons.findIndex(b=>b.parentElement===row);
   const next=at<0?(e.key==='ArrowDown'?0:buttons.length-1):(at+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;
   buttons[next].focus();buttons[next].scrollIntoView({block:'nearest'});
  }else if(e.key==='Enter'&&e.target===input){e.preventDefault();rowStates[0]?.open.click();}
 });
 box.addEventListener('focusout',()=>setTimeout(()=>{if(!busy&&!box.contains(document.activeElement)&&!document.activeElement?.matches('.open-tabs-button'))dismiss();},0));
 const timer=setInterval(syncStatus,500);
 draw();input.focus();
 return {dismiss,update(next){entries=next;if(!busy)draw();}};
}
