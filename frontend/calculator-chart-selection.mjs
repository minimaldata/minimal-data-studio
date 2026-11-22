// Transient observation selection; calculator values are immutable snapshots.
export function mountChartSelection({view,plot,config,data,pins,enabled,onChange,onStart}){
 const events=new AbortController(),chosen=new Map();let drag=null,frame=0,disposed=false;
 const scatter=config.type==='scatter',line=config.type==='line';
 const key=r=>scatter?String(r.rowNumber):JSON.stringify([r.xk,r.series]);
 const rows=new Map(data.values.map(r=>[key(r),r]));
 const groups=new Map();if(!scatter)for(const r of data.values){if(!groups.has(r.xk))groups.set(r.xk,[]);groups.get(r.xk).push(r);}
 const box=()=>{const surface=plot.querySelector('.studioPanSurface path')?.getBoundingClientRect();if(surface)return surface;const el=plot.querySelector('svg,canvas');if(!el)return null;const b=el.getBoundingClientRect(),o=view.origin();return {left:b.left+o[0],top:b.top+o[1],width:view.width(),height:view.height(),right:b.left+o[0]+view.width(),bottom:b.top+o[1]+view.height()};};
 const overlay=document.createElement('canvas');overlay.className='calculator-chart-selection';overlay.setAttribute('aria-hidden','true');plot.append(overlay);
 const rubber=document.createElement('div');rubber.className='calculator-chart-box';rubber.hidden=true;plot.append(rubber);
 const controls=document.createElement('div');controls.className='calculator-chart-selection-controls';controls.hidden=true;controls.setAttribute('role','group');controls.setAttribute('aria-label','Selected chart values');const count=document.createElement('span'),clear=document.createElement('button');clear.type='button';clear.textContent='Clear selection';controls.append(count,clear);plot.after(controls);
 function observations(selectedOnly=false){
  const b=box();if(!b)return [];const selectedSeries=pins(),allowed=r=>!line||!selectedSeries.size||selectedSeries.has(r.series),visible=p=>p.x>=b.left&&p.x<=b.right&&p.y>=b.top&&p.y<=b.bottom;
  if(line||scatter){const xs=view.scale('x'),ys=view.scale('y');let swarm={};try{swarm=view.signal('studioSwarm')||{};}catch{}
   return (selectedOnly?[...chosen.values()]:data.values).filter(r=>allowed(r)&&(!scatter||config.boxPoints!=='none'&&(config.boxPoints!=='outliers'||r.boxOutlier))).map(r=>({row:r,x:b.left+(xs(scatter?r.x:data.time&&!data.overlay?r.x:r.xk)+(scatter?(swarm[r.rowNumber]||0):(xs.bandwidth?.()||0)/2))*b.width/view.width(),y:b.top+ys(scatter?r.y:r.value)*b.height/view.height()})).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&visible(p));
  }
  // Rendered bar geometry includes stacks, normalization and horizontal layouts.
  return [...plot.querySelectorAll('.mark-rect.role-mark path')].flatMap(el=>{const datum=el.__data__?.datum,row=datum&&rows.get(key(datum));if(!row)return [];const r=el.getBoundingClientRect(),p={row,x:r.left+r.width/2,y:r.top+r.height/2,width:r.width,height:r.height};return visible(p)?[p]:[];});
 }
 function values(){return [...chosen.values()].map(r=>{let value=scatter?r.y:r.value;if(config.type==='percent'){const group=groups.get(r.xk)||[],total=group.reduce((n,r)=>n+r.value,0);if(total<=0||group.some(r=>r.value<0))return null;value/=total;}return Number.isFinite(value)?{value,raw:value,label:[r.series,r.xl??r.xCategory??r.label??(scatter?`Row ${r.rowNumber}`:r.xk)].filter(v=>v!=null).join(' · ')}:null;}).filter(Boolean);}
 function draw(){frame=0;if(disposed)return;const p=plot.getBoundingClientRect(),ratio=devicePixelRatio||1;overlay.width=Math.round(p.width*ratio);overlay.height=Math.round(p.height*ratio);overlay.style.width=p.width+'px';overlay.style.height=p.height+'px';const ctx=overlay.getContext('2d');ctx.scale(ratio,ratio);ctx.strokeStyle=getComputedStyle(plot).getPropertyValue('--accent').trim()||'#3275db';ctx.lineWidth=2.5;
  for(const item of chosen.size?observations(true):[]){if(!chosen.has(key(item.row)))continue;const x=item.x-p.left,y=item.y-p.top;if(item.width)ctx.strokeRect(x-item.width/2+1,y-item.height/2+1,Math.max(1,item.width-2),Math.max(1,item.height-2));else{ctx.beginPath();ctx.arc(x,y,7,0,Math.PI*2);ctx.stroke();}}
  count.textContent=`${chosen.size} selected`;controls.hidden=!chosen.size;
 }
 const redraw=()=>{if(!frame)frame=requestAnimationFrame(draw);};
 const commit=()=>{onChange(values());redraw();};
 const reset=(notify=true)=>{chosen.clear();if(notify)commit();else redraw();};clear.onclick=()=>reset();
 function toggle(row){if(!row)return;const id=key(row),original=rows.get(id);if(!original)return;if(chosen.has(id))chosen.delete(id);else chosen.set(id,original);commit();}
 plot.addEventListener('pointerdown',e=>{if(!enabled()||!e.shiftKey||e.button!==0)return;const b=box();if(!b||e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)return;e.preventDefault();e.stopImmediatePropagation();onStart();Object.assign(rubber.style,{width:"0px",height:"0px"});drag={id:e.pointerId,x:e.clientX,y:e.clientY,box:b,add:e.metaKey||e.ctrlKey};plot.setPointerCapture(e.pointerId);plot.classList.add('calculator-box-selecting');rubber.hidden=false;},{capture:true,signal:events.signal});
 plot.addEventListener('pointermove',e=>{if(!drag)return;e.preventDefault();const b=drag.box,p=plot.getBoundingClientRect(),x=Math.max(b.left,Math.min(b.right,e.clientX)),y=Math.max(b.top,Math.min(b.bottom,e.clientY));Object.assign(rubber.style,{left:Math.min(drag.x,x)-p.left+'px',top:Math.min(drag.y,y)-p.top+'px',width:Math.abs(x-drag.x)+'px',height:Math.abs(y-drag.y)+'px'});},{capture:true,signal:events.signal});
 function finish(e,cancel=false){if(!drag)return;const d=drag;drag=null;rubber.hidden=true;plot.classList.remove('calculator-box-selecting');if(plot.hasPointerCapture(d.id))plot.releasePointerCapture(d.id);if(cancel)return;if(Math.hypot(e.clientX-d.x,e.clientY-d.y)<4)return;
  const left=Math.min(d.x,e.clientX),right=Math.max(d.x,e.clientX),top=Math.min(d.y,e.clientY),bottom=Math.max(d.y,e.clientY);if(!d.add)chosen.clear();for(const p of observations())if(p.x>=left&&p.x<=right&&p.y>=top&&p.y<=bottom)chosen.set(key(p.row),p.row);commit();
 }
 document.addEventListener('pointerup',e=>finish(e),{capture:true,signal:events.signal});plot.addEventListener('pointercancel',e=>finish(e,true),{signal:events.signal});window.addEventListener('blur',e=>finish(e,true),{signal:events.signal});
 const available=view.getState({signals:()=>true}).signals;for(const name of ['studioXDomain','studioYDomain','studioSwarm','pinnedSeries'])if(Object.hasOwn(available,name))view.addSignalListener(name,redraw);
 const resize=new ResizeObserver(redraw);resize.observe(plot);
 document.addEventListener('calculator-mode-change',()=>{if(!enabled())finish({},true);},{signal:events.signal});
 return {toggle,reset,redraw,has:row=>!!row&&chosen.has(key(row)),get selecting(){return !!drag;},dispose(){disposed=true;cancelAnimationFrame(frame);events.abort();resize.disconnect();overlay.remove();rubber.remove();controls.remove();}};
}
