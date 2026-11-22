// Pixels per 50 ms tick: gentle inside the edge, faster farther outside it.
export function selectionScrollStep(position, start, end) {
 const zone=Math.min(24,(end-start)/2);
 const direction=position<start+zone?-1:position>end-zone?1:0;
 if(!direction)return 0;
 const distance=direction<0?start-position:position-end;
 return direction*Math.min(90,Math.max(2,Math.round(18+distance*0.6)));
}
// Keep selection moving even while the pointer rests near a scrollable edge.
export function startTableSelectionScroll(table, event, select) {
 let x=event.clientX,y=event.clientY,stopped=false,lastCell=null;
 const ancestors=[];
 for(let el=table.parentElement;el&&el!==document.body;el=el.parentElement){
  const css=getComputedStyle(el);
  if(/auto|scroll/.test(css.overflowX+' '+css.overflowY))ancestors.push(el);
 }
 const tick=()=>{
  if(!table.isConnected){stop();return;}
  let movedX=false,movedY=false;
  for(const el of ancestors){
   const b=el.getBoundingClientRect(),top=Math.max(0,b.top),bottom=Math.min(innerHeight,b.bottom),left=Math.max(0,b.left),right=Math.min(innerWidth,b.right);
   const dx=selectionScrollStep(x,left,right),dy=selectionScrollStep(y,top,bottom);
   const sx=el.scrollLeft,sy=el.scrollTop;
   if(!movedX)el.scrollLeft+=dx;if(!movedY)el.scrollTop+=dy;
   movedX ||= sx!==el.scrollLeft;movedY ||= sy!==el.scrollTop;
  }
  const rows=table.tBodies[0]?.rows;if(!rows?.length)return;
  let row=rows[0];for(const r of rows){if(r.getBoundingClientRect().top>y)break;row=r;}
  const cells=[...row.cells].filter(c=>!c.classList.contains('rn'));let cell=cells[0];
  for(const c of cells){if(c.getBoundingClientRect().left>x)break;cell=c;}
  if(cell&&cell!==lastCell){lastCell=cell;select(cell);}
 };
 const move=e=>{x=e.clientX;y=e.clientY;tick();};
 const stop=()=>{if(stopped)return;stopped=true;clearInterval(timer);window.removeEventListener('pointermove',move);for(const type of ['pointerup','pointercancel','blur'])window.removeEventListener(type,stop);};
 const timer=setInterval(tick,50);
 window.addEventListener('pointermove',move);for(const type of ['pointerup','pointercancel','blur'])window.addEventListener(type,stop);
 return stop;
}
