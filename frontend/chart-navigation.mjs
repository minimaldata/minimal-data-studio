import {calculatorPicking,calculatorSelecting} from './calculator.mjs';
import {mountChartScrollbar} from './chart-scrollbar.mjs';
// Per-chart navigation rules; rendering and saved chart formats stay separate.
export function chartNavigationPolicy(type,{horizontal=false}={}){
 if(type==='scatter')return {bounded:true,ariaLabel:'Scatterplot navigation'};
 if(type==='line')return {bounded:true,horizontalScroll:true,showAxisChoice:true,roundTime:true,defaultAxes:'x',ariaLabel:'Time navigation'};
 if(['bar','stacked','percent'].includes(type))return {bounded:true,horizontalScroll:!horizontal,snapScroll:!horizontal,showAxisChoice:true,defaultAxes:horizontal?'y':'x',axisLabels:horizontal?['Values only','Categories only']:['Categories only','Values only']};
 throw new Error(`No navigation policy for ${type}`);
}
export function zoomDomain(domain,factor){const center=domain[0]/2+domain[1]/2,half=(domain[1]-domain[0])*factor/2;return [center-half,center+half];}
export function clampDomain(domain,bounds){
  const span=domain[1]-domain[0],full=bounds[1]-bounds[0];
  if(span>=full*(1-1e-12))return [...bounds];
  const start=Math.max(bounds[0],Math.min(domain[0],bounds[1]-span));
  return [start,start+span];
}
export function horizontalWheelDelta(event,width){
 if(event.ctrlKey||event.metaKey)return 0; // Preserve browser pinch/zoom gestures.
 const delta=event.shiftKey&&!event.deltaX?event.deltaY:event.deltaX;
 if(!event.shiftKey&&Math.abs(delta)<=Math.abs(event.deltaY))return 0;
 return delta*(event.deltaMode===1?16:event.deltaMode===2?width:1);
}
export function zoomAt(domain,bounds,factor,position,minSpan=0){
 const span=domain[1]-domain[0],full=bounds[1]-bounds[0];
 const next=Math.max(Math.min(full,Math.max(full/1024,minSpan)),Math.min(full,span*factor));
 const fraction=Math.max(0,Math.min(1,position)),anchor=domain[0]+span*fraction;
 return clampDomain([anchor-next*fraction,anchor+next*(1-fraction)],bounds);
}
export function rectangleDomains(domains,start,end,width,height){
  const clamp=(v,max)=>Math.max(0,Math.min(max,v));
  const x=[clamp(start[0],width),clamp(end[0],width)].sort((a,b)=>a-b);
  const y=[clamp(start[1],height),clamp(end[1],height)].sort((a,b)=>a-b);
  if(x[1]-x[0]<5||y[1]-y[0]<5)return null;
  const [xd,yd]=domains;
  return [x.map(v=>xd[0]+v/width*(xd[1]-xd[0])),[y[1],y[0]].map(v=>yd[1]-v/height*(yd[1]-yd[0]))];
}
export function mountChartNavigation(host,plot,view,state,tooltip,{horizontalScroll=false,snapScroll=false,showAxisChoice=false,roundTime=false,defaultAxes='both',axisLabels=null,bounded=false,ariaLabel='Chart navigation'}={}){
  if(!state)return;
  for(const [i,scale] of ['x','y'].entries())if(!state.initial[i]){state.initial[i]=[...view.scale(scale).domain()];state.domains[i]=[...state.initial[i]];view.signal(i?'studioYDomain':'studioXDomain',state.domains[i]);}
  let axes=state.zoomAxes||defaultAxes;
  const enabled=i=>axes==='both'||axes===(i?'y':'x');
  const controls=document.createElement('span');controls.className='scatter-navigation';controls.setAttribute('role','group');controls.setAttribute('aria-label',ariaLabel);host.append(controls);
  const buttons=[];let scrollbar=null;let pending=Promise.resolve(),disposed=false;
  const remember=()=>{state.domains=['studioXDomain','studioYDomain'].map(n=>[...view.signal(n)]);};
  const apply=fn=>{tooltip.clear();pending=pending.then(async()=>{if(disposed)return;let domains=fn();if(bounded)domains=domains.map((d,i)=>clampDomain(d,state.initial[i]));if(roundTime)domains[0]=domains[0].map(Math.round);if(domains.some(d=>d.some(v=>!Number.isFinite(v))||d[0]>=d[1]))return;view.signal('studioXDomain',domains[0]).signal('studioYDomain',domains[1]).signal('studioHovered',null);await view.runAsync();remember();update();});};
  const ratios=()=>state.domains.map((d,i)=>(d[1]-d[0])/(state.initial[i][1]-state.initial[i][0])).filter((_,i)=>enabled(i));
  const canPan=()=>!bounded||ratios().some(r=>r<1-1e-9);
  const update=()=>{scrollbar?.update();plot.classList.toggle('pan-locked',bounded&&!canPan());if(!zoomMode)hint.textContent=canPan()?'Drag to pan':'Zoom in to pan';buttons[0].disabled=ratios().some(r=>r<=1/1024)||(roundTime&&enabled(0)&&state.domains[0][1]-state.domains[0][0]<=2);buttons[1].disabled=bounded?ratios().every(r=>r>=1-1e-9):ratios().some(r=>r>=64);};
  for(const [label,text,fn] of [['Zoom in','+',()=>state.domains.map((d,i)=>!enabled(i)?d:zoomDomain(d,.5))],['Zoom out','−',()=>state.domains.map((d,i)=>!enabled(i)?d:zoomDomain(d,2))],['Reset zoom','Reset',()=>state.initial.map(d=>[...d])]]){
    const b=document.createElement('button');b.type='button';b.textContent=text;b.title=label;b.setAttribute('aria-label',label);b.onclick=()=>{if(bounded&&label==='Reset zoom'){axes=defaultAxes;state.zoomAxes=axes;axisChoice.value=axes;setZoomMode(false);}apply(fn);};controls.append(b);buttons.push(b);
  }
  if(horizontalScroll)scrollbar=mountChartScrollbar(host,state,domain=>apply(()=>[domain,state.domains[1]]),{snap:snapScroll});
  const events=new AbortController();let drag=null,zoomMode=false;
  const plotBounds=()=>{
   const svg=plot.querySelector('.studioPanSurface path');if(svg)return svg.getBoundingClientRect();
   const canvas=plot.querySelector('canvas');if(!canvas)return null;
   const rect=canvas.getBoundingClientRect(),origin=view.origin(),width=view.width(),height=view.height();
   const left=rect.left+origin[0],top=rect.top+origin[1];return {left,top,width,height,right:left+width,bottom:top+height};
  };
  const pinchPosition=e=>{const b=plotBounds();if(!b||!b.width||!b.height||e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)return null;return [(e.clientX-b.left)/b.width,1-(e.clientY-b.top)/b.height];};
  const pinch=(factor,position)=>apply(()=>state.domains.map((d,i)=>enabled(i)?zoomAt(d,state.initial[i],factor,position[i],roundTime&&i===0?2:0):d));
  // Chromium/Firefox expose trackpad pinch as Ctrl+wheel. WebKit uses
  // cumulative GestureEvent.scale. Handle each only within the plot itself.
  let gesture=null;
  plot.addEventListener('wheel',e=>{
   if(!e.ctrlKey||e.metaKey||drag)return;const position=pinchPosition(e);if(!position)return;
   e.preventDefault();e.stopPropagation();if(gesture)return;
   const pixels=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?view.height():1);
   pinch(Math.exp(Math.max(-1,Math.min(1,pixels*.01))),position);
  },{passive:false,signal:events.signal});
  plot.addEventListener('gesturestart',e=>{
   if(drag)return;const position=pinchPosition(e);if(!position)return;e.preventDefault();gesture={scale:1,position};tooltip.clear();
  },{passive:false,signal:events.signal});
  plot.addEventListener('gesturechange',e=>{
   if(!gesture)return;e.preventDefault();if(!Number.isFinite(e.scale)||e.scale<=0)return;
   pinch(gesture.scale/e.scale,pinchPosition(e)||gesture.position);gesture.scale=e.scale;
  },{passive:false,signal:events.signal});
  plot.addEventListener('gestureend',e=>{if(gesture)e.preventDefault();gesture=null;},{passive:false,signal:events.signal});
  window.addEventListener('blur',()=>{gesture=null;},{signal:events.signal});

  const wheel=e=>{
   if(!horizontalScroll||drag)return;
   const [lo,hi]=state.initial[0],[a,b]=state.domains[0];
   if(b-a>=hi-lo-1e-9)return;
   const width=Math.max(1,view.width()),pixels=horizontalWheelDelta(e,width);
   if(!pixels)return;
   // Do not swallow ordinary vertical page scrolling or scrolling at an edge.
   if((pixels<0&&a<=lo)||(pixels>0&&b>=hi))return;
   e.preventDefault();
   const offset=pixels/width*(b-a);
   apply(()=>[state.domains[0].map(v=>v+offset),state.domains[1]]);
  };
  plot.addEventListener('wheel',wheel,{passive:false,signal:events.signal});
  host.addEventListener('wheel',wheel,{passive:false,signal:events.signal});

  const selection=document.createElement('div');selection.className='scatter-zoom-selection';selection.hidden=true;plot.append(selection);
  const mode=document.createElement('button');mode.type='button';mode.title='Drag to zoom';mode.setAttribute('aria-label','Drag to zoom');mode.setAttribute('aria-pressed','false');
  mode.innerHTML='<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="10" cy="10" r="6.5"/><path d="m15 15 6 6M7 10h6M10 7v6"/></svg>';
  controls.prepend(mode);
  const axisChoice=document.createElement('select');axisChoice.setAttribute('aria-label','Zoom axes');axisChoice.hidden=true;
  for(const [value,label] of [['x',axisLabels?.[0]||'Time only'],['y',axisLabels?.[1]||'Value only'],['both','Both axes']])axisChoice.append(Object.assign(document.createElement('option'),{value,textContent:label,selected:axes===value}));
  if(showAxisChoice)mode.after(axisChoice);
  axisChoice.onchange=()=>{axes=axisChoice.value;state.zoomAxes=axes;update();setZoomMode(zoomMode);};
  const setZoomMode=value=>{zoomMode=value;mode.setAttribute('aria-pressed',String(zoomMode));plot.classList.toggle('is-box-zoom',zoomMode);hint.textContent=zoomMode?(axes==='x'?(axisLabels?'Drag an X range':'Drag a time range'):axes==='y'?'Drag a Y range':'Drag a box to zoom'):canPan()?'Drag to pan':'Zoom in to pan';axisChoice.hidden=!zoomMode;tooltip.clear();};
  mode.onclick=()=>setZoomMode(!zoomMode);
  const drawSelection=e=>{
    const b=drag.box,p=plot.getBoundingClientRect(),x=Math.max(b.left,Math.min(b.right,e.clientX)),y=Math.max(b.top,Math.min(b.bottom,e.clientY));
    Object.assign(selection.style,{left:((drag.axes==='y'?b.left:Math.min(drag.x,x))-p.left)+'px',top:((drag.axes==='x'?b.top:Math.min(drag.y,y))-p.top)+'px',width:(drag.axes==='y'?b.width:Math.abs(x-drag.x))+'px',height:(drag.axes==='x'?b.height:Math.abs(y-drag.y))+'px'});selection.hidden=false;
  };
  plot.addEventListener('pointerdown',e=>{
    if(e.button!==0||calculatorSelecting()&&(e.shiftKey||e.metaKey||e.ctrlKey)||(!zoomMode&&!canPan()))return;
    const box=plotBounds();
    if(!box||e.clientX<box.left||e.clientX>box.right||e.clientY<box.top||e.clientY>box.bottom)return;
    e.preventDefault();drag={x:e.clientX,y:e.clientY,box,domains:state.domains.map(d=>[...d]),zoom:zoomMode,axes};
    if(drag.zoom)drawSelection(e);
    if(!calculatorPicking())plot.setPointerCapture(e.pointerId);tooltip.clear();view.signal('studioPanAnchor',true).runAsync();
  },{signal:events.signal});
  let panFrame=0,nextPan=null;
  const flushPan=()=>{panFrame=0;if(nextPan){apply(nextPan);nextPan=null;}};
  plot.addEventListener('pointermove',e=>{
    if(!drag)return;if(calculatorPicking()&&!plot.hasPointerCapture(e.pointerId)){if(Math.hypot(e.clientX-drag.x,e.clientY-drag.y)<4)return;plot.setPointerCapture(e.pointerId);}e.preventDefault();if(drag.zoom){drawSelection(e);return;}const anchor=drag,dx=(e.clientX-anchor.x)/Math.max(1,anchor.box.width),dy=(e.clientY-anchor.y)/Math.max(1,anchor.box.height);
    nextPan=()=>anchor.domains.map((d,i)=>{const offset=(i?(anchor.axes==='x'?0:dy):(anchor.axes==='y'?0:-dx))*(d[1]-d[0]);return d.map(v=>v+offset);});
    if(!panFrame)panFrame=requestAnimationFrame(flushPan);
  },{signal:events.signal});
  const endDrag=e=>{
    if(!drag)return;if(panFrame){cancelAnimationFrame(panFrame);flushPan();}const anchor=drag;drag=null;selection.hidden=true;
    if(anchor.zoom&&e?.type==='pointerup'){
      const b=anchor.box,domains=rectangleDomains(anchor.domains,[anchor.axes==='y'?0:anchor.x-b.left,anchor.axes==='x'?0:anchor.y-b.top],[anchor.axes==='y'?b.width:e.clientX-b.left,anchor.axes==='x'?b.height:e.clientY-b.top],b.width,b.height);
      if(domains){apply(()=>domains);setZoomMode(false);}
    }
    view.signal('studioPanAnchor',null).runAsync();
  };
  for(const type of ['pointerup','pointercancel','lostpointercapture'])plot.addEventListener(type,endDrag,{signal:events.signal});
  window.addEventListener('blur',endDrag,{signal:events.signal});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')endDrag(e);},{signal:events.signal});
  const hint=document.createElement('span');hint.textContent='Drag to pan';controls.append(hint);
  view.addSignalListener('studioXDomain',remember);view.addSignalListener('studioYDomain',remember);
  view.addSignalListener('studioPanAnchor',(_,anchor)=>{plot.classList.toggle('is-panning',!!anchor);if(anchor)tooltip.clear();});
  const finalize=view.finalize.bind(view);view.finalize=()=>{disposed=true;cancelAnimationFrame(panFrame);events.abort();scrollbar?.dispose();selection.remove();controls.remove();return finalize();};
  update();
}
