import {createOpenTabsMenu} from './open-tabs-menu.mjs';
let openTabsMenu=null;
let lastTabClick=null;
// Viewing state only: saved documents are owned by their existing editors.
export function createPreviewSlot(){
 let current=null;
 return {
  is:key=>current?.key===key,
  keep(key){if(current?.key===key)current=null;},
  async open(entry){
   if(current?.key===entry.key)return;
   const previous=current;current=null;
   if(previous)await previous.close();
   current=entry;
  }
 };
}
export function mountTabTools(host,entries,{isPreview,keep}){
 // A save may redraw unchanged tabs while a context-menu action is being chosen.
 const contextMenu=document.getElementById('openTabMenu');
 const tabKeys=JSON.stringify(entries.map(entry=>entry.key));
 if(!openTabsMenu&&contextMenu?.dataset.tabKeys!==tabKeys)contextMenu?.remove();
 const dismiss=()=>{openTabsMenu?.dismiss();document.getElementById('openTabMenu')?.remove();};
 function menu(anchor){
  dismiss();const box=document.createElement('div');box.id='openTabMenu';box.className='tab-tools-menu';box.tabIndex=-1;
  box.dataset.tabKeys=tabKeys;
  const rect=anchor.getBoundingClientRect();box.style.top=Math.min(rect.bottom+4,innerHeight-250)+'px';box.style.left=Math.max(8,Math.min(rect.left,innerWidth-340))+'px';
  box.addEventListener('keydown',e=>{if(e.key==='Escape'){dismiss();anchor.focus();}});
  box.addEventListener('focusout',()=>setTimeout(()=>{if(!box.contains(document.activeElement))box.remove();},0));
  document.body.append(box);return box;
 }
 function button(box,label,action){const b=document.createElement('button');b.textContent=label;b.onclick=async()=>{dismiss();await action();};box.append(b);return b;}
 for(const entry of entries){
  entry.el.classList.toggle('preview-tab',isPreview(entry.key));
  if(isPreview(entry.key)){
   entry.el.title=(entry.el.title?entry.el.title+' · ':'')+'Preview — opening another item replaces this tab. Keep open to retain it.';
   const retain=document.createElement('button');retain.className='tab-keep-open';retain.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m16 3 5 5-4 1-3 5v4l-8-8h4l5-3Z"/><path d="m10 14-7 7"/></svg>';retain.title='Keep this tab when opening other items';retain.setAttribute('aria-label','Keep '+entry.name+' open');
   retain.onclick=e=>{e.stopPropagation();keep(entry.key);};
   const close=entry.el.querySelector('.x,.file-tab-close');entry.el.insertBefore(retain,close);
  }
  entry.el.addEventListener('click',e=>{
   if(e.target.closest('button,select,input,.x'))return;
   const repeated=lastTabClick?.key===entry.key&&performance.now()-lastTabClick.at<450;
   lastTabClick={key:entry.key,at:performance.now()};
   if(isPreview(entry.key)&&repeated){e.stopImmediatePropagation();keep(entry.key);return;}
   // Activating an already active tab must not replace its DOM between clicks.
   if(entry.el.classList.contains('active'))e.stopImmediatePropagation();
  },true);
  entry.el.addEventListener('dblclick',e=>{if(e.target.closest('button,select,input,.x')||!isPreview(entry.key))return;e.preventDefault();e.stopImmediatePropagation();keep(entry.key);},true);
  entry.el.oncontextmenu=e=>{
   e.preventDefault();const box=menu(entry.el);
   if(isPreview(entry.key))button(box,'Keep open',()=>keep(entry.key));
   button(box,'Close tab',entry.close);
   const closeMany=async items=>{for(const item of items)await item.close();};
   button(box,'Close others',()=>closeMany(entries.filter(x=>x!==entry)));
   button(box,'Close to the right',()=>closeMany(entries.slice(entries.indexOf(entry)+1)));
   box.querySelector('button').focus();
  };
 }
 const opener=document.createElement('button');opener.className='open-tabs-button';opener.title='Search open tabs';opener.setAttribute('aria-label','Search open tabs');opener.textContent='▾';
 opener.setAttribute('aria-expanded',String(!!openTabsMenu));opener.setAttribute('aria-controls','openTabMenu');
 const menuEntries=()=>entries.map(e=>({...e,active:e.el.classList.contains('active'),preview:isPreview(e.key)}));
 opener.onclick=()=>{
  if(openTabsMenu){dismiss();return;}
  dismiss();opener.setAttribute('aria-expanded','true');openTabsMenu=createOpenTabsMenu({anchor:opener,entries:menuEntries(),onDismiss:()=>{openTabsMenu=null;document.querySelector('.open-tabs-button')?.setAttribute('aria-expanded','false');}});
 };host.append(opener);
 openTabsMenu?.update(menuEntries());
}
