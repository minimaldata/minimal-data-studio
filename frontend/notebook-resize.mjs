// Cell sizes are presentation preferences; resizing never edits or runs source code.
export function cellHeight(value){return Number.isFinite(value)?Math.max(80,Math.min(1600,Math.round(value))):null;}
export function mountCellResize(target,cell,key,{label,canEdit,apply,onCommit}){
 const handle=document.createElement('div');handle.className='cell-resize-handle '+key;
 handle.tabIndex=0;handle.setAttribute('role','separator');handle.setAttribute('aria-orientation','horizontal');handle.setAttribute('aria-label',`Resize ${label}`);handle.title=`Drag to resize ${label} · Double-click to reset`;
 handle.setAttribute('aria-valuemin','80');handle.setAttribute('aria-valuemax','1600');
 const set=value=>{apply(value);handle.setAttribute('aria-valuenow',String(value??Math.round(target.getBoundingClientRect().height)));};
 const save=value=>{if(value===null)delete cell[key];else cell[key]=value;onCommit();};
 let drag=null;
 const finish=commit=>{if(!drag)return;const old=drag;drag=null;target.classList.remove('notebook-resizing');if(commit&&canEdit())save(old.height);else set(cellHeight(cell[key]));};
 handle.onpointerdown=e=>{if(e.button!==0||!canEdit())return;e.preventDefault();drag={y:e.clientY,start:target.getBoundingClientRect().height,height:cellHeight(cell[key])};target.classList.add('notebook-resizing');handle.setPointerCapture(e.pointerId);};
 handle.onpointermove=e=>{if(!drag)return;e.preventDefault();drag.height=cellHeight(drag.start+e.clientY-drag.y);set(drag.height);};
 handle.onpointerup=()=>finish(true);handle.onpointercancel=()=>finish(false);handle.onlostpointercapture=()=>finish(false);
 handle.ondblclick=()=>{if(!canEdit())return;set(null);save(null);};
 handle.onkeydown=e=>{if(!canEdit())return;if(e.key==='Escape'){finish(false);return;}if(!['ArrowUp','ArrowDown','Home'].includes(e.key))return;e.preventDefault();const height=e.key==='Home'?null:cellHeight(target.getBoundingClientRect().height+(e.key==='ArrowDown'?20:-20));set(height);save(height);};
 set(cellHeight(cell[key]));target.after(handle);return handle;
}
