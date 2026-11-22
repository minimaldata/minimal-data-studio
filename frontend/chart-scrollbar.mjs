// A viewport control, not a scrollable chart: axes and controls stay in place.
export function scrollDomain(domain,bounds,start,snap=false){
 const span=domain[1]-domain[0];
 const left=Math.max(bounds[0],Math.min(snap&&start>bounds[0]&&start<bounds[1]-span?Math.round(start):start,bounds[1]-span));
 return [left,left+span];
}
export function mountChartScrollbar(host,state,move,{snap=false}={}){
 const track=document.createElement('div');track.className='chart-scrollbar';track.tabIndex=0;
 track.setAttribute('role','scrollbar');track.setAttribute('aria-label','Horizontal chart position');track.setAttribute('aria-orientation','horizontal');
 const thumb=document.createElement('div');thumb.className='chart-scrollbar-thumb';track.append(thumb);host.prepend(track);
 const events=new AbortController();let drag=null;
 const update=()=>{const [lo,hi]=state.initial[0],[a,b]=state.domains[0],full=hi-lo,span=b-a;
  track.hidden=span>=full*(1-1e-9);thumb.style.width=`${100*span/full}%`;thumb.style.left=`${100*(a-lo)/full}%`;
  track.setAttribute('aria-valuemin',String(lo));track.setAttribute('aria-valuemax',String(hi-span));track.setAttribute('aria-valuenow',String(a));
  track.setAttribute('aria-valuetext',`${Math.round(100*(a-lo)/full)}–${Math.round(100*(b-lo)/full)}% of full range`);
 };
 const go=start=>move(scrollDomain(state.domains[0],state.initial[0],start,snap));
 track.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();track.focus();
  if(e.target===thumb){drag={x:e.clientX,start:state.domains[0][0],width:track.getBoundingClientRect().width};track.setPointerCapture(e.pointerId);}
  else{const box=thumb.getBoundingClientRect(),span=state.domains[0][1]-state.domains[0][0];go(state.domains[0][0]+(e.clientX<box.left?-span:span));}
 },{signal:events.signal});
 track.addEventListener('pointermove',e=>{if(drag)go(drag.start+(e.clientX-drag.x)/Math.max(1,drag.width)*(state.initial[0][1]-state.initial[0][0]));},{signal:events.signal});
 for(const type of ['pointerup','pointercancel','lostpointercapture'])track.addEventListener(type,()=>{drag=null;},{signal:events.signal});
 track.addEventListener('keydown',e=>{const [a,b]=state.domains[0],step=snap?1:(b-a)/10;
  const next={ArrowLeft:a-step,ArrowRight:a+step,PageUp:a-(b-a),PageDown:b,Home:state.initial[0][0],End:state.initial[0][1]-(b-a)}[e.key];
  if(next!==undefined){e.preventDefault();go(next);}
 },{signal:events.signal});
 update();return {update,dispose(){events.abort();track.remove();}};
}
