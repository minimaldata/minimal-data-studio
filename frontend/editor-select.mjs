/** Anchored, keyboard-accessible dropdown shared by editors and notebook cells. */
let closeEditorSelect = null;
export function anchorEditorSelect(select){
  if(select.dataset.anchored==='true')return;select.dataset.anchored='true';
  const button=document.createElement('button');button.type='button';button.className='editor-select';
  button.setAttribute('aria-label',select.getAttribute('aria-label')||select.title||'Choose option');button.setAttribute('aria-haspopup','listbox');button.setAttribute('aria-expanded','false');
  const sync=()=>{button.textContent=select.selectedOptions[0]?.textContent||'';button.disabled=select.disabled;};sync();
  select.hidden=true;select.after(button);
  new MutationObserver(()=>{sync();if(button.getAttribute('aria-expanded')==='true')closeEditorSelect?.();}).observe(select,{attributes:true,childList:true,subtree:true,characterData:true});
  button.ondblclick=e=>e.stopPropagation();
  button.onclick=e=>{e.stopPropagation();if(button.getAttribute('aria-expanded')==='true'){closeEditorSelect?.();return;}openMenu();};
  button.onkeydown=e=>{if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();e.stopPropagation();openMenu(e.key);}};
  function openMenu(key){
    if(button.disabled)return;closeEditorSelect?.();
    const menu=document.createElement('div');menu.className='editor-select-menu';menu.setAttribute('role','listbox');menu.setAttribute('aria-label',button.getAttribute('aria-label'));menu.id='editor-select-options';
    button.setAttribute('aria-controls',menu.id);button.setAttribute('aria-expanded','true');
    const options=[...select.options].filter(o=>!o.disabled),items=[];
    function close(restore=false){menu.remove();button.setAttribute('aria-expanded','false');button.removeAttribute('aria-controls');document.removeEventListener('pointerdown',outside,true);window.removeEventListener('resize',reposition);document.removeEventListener('scroll',reposition,true);closeEditorSelect=null;if(restore&&button.isConnected)button.focus();}
    function outside(e){if(!menu.contains(e.target)&&e.target!==button)close();}
    function reposition(){if(!button.isConnected){close();return;}const r=button.getBoundingClientRect();menu.style.minWidth=r.width+'px';const width=menu.offsetWidth,height=menu.offsetHeight;menu.style.left=Math.max(6,Math.min(r.left,innerWidth-width-6))+'px';menu.style.top=Math.max(6,r.bottom+height+4<=innerHeight?r.bottom+4:r.top-height-4)+'px';}
    closeEditorSelect=close;
    options.forEach(option=>{const item=Object.assign(document.createElement('div'),{className:'editor-select-option',textContent:option.textContent,tabIndex:-1});item.setAttribute('role','option');item.setAttribute('aria-selected',String(option.selected));
      item.onclick=e=>{e.stopPropagation();select.value=option.value;sync();close(true);select.dispatchEvent(new Event('change',{bubbles:true}));};items.push(item);menu.append(item);
    });
    menu.onkeydown=e=>{const i=items.indexOf(document.activeElement);let next=i;if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close(true);return;}if(e.key==='Tab'){close(true);return;}if(e.key==='ArrowDown')next=(i+1)%items.length;else if(e.key==='ArrowUp')next=(i-1+items.length)%items.length;else if(e.key==='Home')next=0;else if(e.key==='End')next=items.length-1;else if(e.key==='Enter'||e.key===' '){e.preventDefault();items[i]?.click();return;}else return;e.preventDefault();items[next]?.focus();items[next]?.scrollIntoView({block:'nearest'});};
    (button.closest('dialog')||document.body).append(menu);reposition();document.addEventListener('pointerdown',outside,true);window.addEventListener('resize',reposition);document.addEventListener('scroll',reposition,true);
    const index=key==='Home'?0:key==='End'?items.length-1:Math.max(0,options.findIndex(o=>o.selected));items[index]?.focus();
  }
}

export function closeEditorMenu() { closeEditorSelect?.(); }
