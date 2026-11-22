// Keep the select as the persistence interface; render a themed, keyboard-accessible menu.
export function mountCopyFormatMenu(select,{getIncludeHeaders=()=>true,setIncludeHeaders=()=>{}}={}){
 const host=select.parentElement,button=document.createElement('button');button.type='button';button.className='copy-format-trigger';button.setAttribute('aria-label','Copy as');button.setAttribute('aria-haspopup','menu');button.setAttribute('aria-expanded','false');
 for(const node of [...host.children])if(node!==select)button.append(node);
 select.setAttribute('aria-label','Stored copy format');select.hidden=true;host.append(button);
 const menu=document.createElement('div');menu.className='copy-format-menu';menu.setAttribute('role','menu');menu.setAttribute('aria-label','Copy format');menu.hidden=true;document.body.append(menu);
 for(const option of select.options){
  const item=document.createElement('button');item.type='button';item.setAttribute('role','menuitemradio');item.dataset.value=option.value;
  const check=document.createElement('span');check.className='copy-format-check';check.setAttribute('aria-hidden','true');check.textContent='✓';
  const text=document.createElement('span');text.textContent=option.text;item.append(check,text);menu.append(item);
  item.onclick=()=>{select.value=option.value;select.dispatchEvent(new Event('change',{bubbles:true}));close();button.focus();};
 }
 const headers=document.createElement('button');headers.type='button';headers.className='copy-include-headers';headers.setAttribute('role','menuitemcheckbox');headers.innerHTML='<span class="copy-format-check" aria-hidden="true">✓</span><span>Include column names</span>';menu.append(headers);
 headers.onclick=async()=>{await setIncludeHeaders(!getIncludeHeaders());sync();};
 const sync=()=>{if(button.disabled!==select.disabled)button.disabled=select.disabled;if(button.title!==host.title)button.title=host.title;for(const item of menu.querySelectorAll('[role=menuitemradio]'))item.setAttribute('aria-checked',String(item.dataset.value===select.value));headers.disabled=false;headers.title='Include column names as the first copied row';headers.setAttribute('aria-checked',String(getIncludeHeaders()));};
 const close=()=>{menu.hidden=true;button.setAttribute('aria-expanded','false');};
 button.onclick=()=>{
  if(!menu.hidden){close();return;}sync();menu.hidden=false;button.setAttribute('aria-expanded','true');
  const box=button.getBoundingClientRect();menu.style.left=Math.max(8,Math.min(innerWidth-menu.offsetWidth-8,box.left))+'px';menu.style.top=(box.top>=menu.offsetHeight+8?box.top-menu.offsetHeight-6:box.bottom+6)+'px';
  menu.querySelector('[role=menuitemradio][aria-checked="true"]')?.focus();
 };
 menu.onkeydown=e=>{
  if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();button.focus();}
  else if(e.key==='Tab')close();
  else if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const items=[...menu.querySelectorAll('button:not(:disabled)')],index=items.indexOf(document.activeElement);items[e.key==='Home'?0:e.key==='End'?items.length-1:(index+(e.key==='ArrowDown'?1:-1)+items.length)%items.length].focus();}
 };
 document.addEventListener('pointerdown',e=>{if(!host.contains(e.target)&&!menu.contains(e.target))close();});window.addEventListener('resize',close);document.addEventListener('scroll',close,true);
 new MutationObserver(sync).observe(host,{attributes:true,subtree:true,attributeFilter:['disabled','title']});sync();
}
