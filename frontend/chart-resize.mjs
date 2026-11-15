// Large charts own their resize lifecycle instead of repainting on every window event.
export function deferChartResize(spec){
 for(const signal of spec.signals||[])if(['width','height'].includes(signal.name)){
  signal.on=(signal.on||[]).filter(handler=>handler.events!=='window:resize');
 }
}
export function observeSettledChartResize(plot,view,tooltip,{delay=250,ResizeObserver=globalThis.ResizeObserver,document=globalThis.document,window=globalThis.window}={}){
 let timer=null,disposed=false,dragging=false,running=false,pending=false;
 let last=[plot.clientWidth,plot.clientHeight];
 const events=new AbortController();
 const finish=()=>{plot.classList.remove('is-resizing-chart');};
 const apply=async()=>{
  timer=null;if(disposed||dragging)return;if(running){pending=true;return;}
  const size=[plot.clientWidth,plot.clientHeight];
  if(size.some(v=>v<=0)||size.every((v,i)=>v===last[i])){finish();return;}
  last=size;running=true;
  try{await view.width(size[0]).height(size[1]).resize().runAsync();}
  finally{running=false;if(!disposed){finish();if(pending){pending=false;schedule();}}}
 };
 const schedule=()=>{
  if(disposed)return;clearTimeout(timer);
  const changed=plot.clientWidth!==last[0]||plot.clientHeight!==last[1];
  if(!changed){finish();return;}
  tooltip.clear();plot.classList.add('is-resizing-chart');
  if(!dragging)timer=setTimeout(()=>{apply().catch(error=>{if(!disposed)console.error('Chart resize failed',error);});},delay);
 };
 const observer=new ResizeObserver(schedule);observer.observe(plot);
 window.addEventListener('resize',schedule,{signal:events.signal});
 document.addEventListener('pointerdown',e=>{if(e.target.closest?.('#splitter, #explorerResize, #helpResize, .ui-resizable-handle, .cell-resize-handle')){dragging=true;clearTimeout(timer);}},{capture:true,signal:events.signal});
 const released=()=>{if(dragging){dragging=false;schedule();}};
 for(const type of ['pointerup','pointercancel'])document.addEventListener(type,released,{capture:true,signal:events.signal});
 window.addEventListener('blur',released,{signal:events.signal});
 const finalize=view.finalize.bind(view);view.finalize=()=>{disposed=true;clearTimeout(timer);observer.disconnect();events.abort();finish();return finalize();};
}
