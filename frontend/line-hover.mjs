import {tooltipOptions} from './line-appearance.mjs';
// Shared observation lookup keeps missing values missing and series order stable.
export function lineHoverIndex(values){
 const at=new Map();for(const row of values){if(!Number.isFinite(row.x))continue;if(!at.has(row.x))at.set(row.x,new Map());at.get(row.x).set(row.series,row);}
 return {at,times:[...at.keys()].sort((a,b)=>a-b)};
}
export function nearestObservation(times,x,min=-Infinity,max=Infinity){
 let lo=0,hi=times.length;while(lo<hi){const m=(lo+hi)>>1;if(times[m]<x)lo=m+1;else hi=m;}
 const choices=[times[lo-1],times[lo]].filter(t=>t!==undefined&&t>=min&&t<=max);
 return choices.sort((a,b)=>Math.abs(a-x)-Math.abs(b-x))[0];
}
// Place values beside their dots, keeping stable series order and actual text sizes.
export function placeHoverLabels(points,bounds,obstacles=[]){
 const occupied=[...obstacles,...points.map(p=>({x:p.x-6,y:p.y-6,width:12,height:12}))];
 const overlaps=(a,b)=>a.x<b.x+b.width+3&&a.x+a.width+3>b.x&&a.y<b.y+b.height+3&&a.y+a.height+3>b.y;
 return points.map(p=>{
  const y=Math.max(bounds.y,Math.min(p.y-p.height/2,bounds.y+bounds.height-p.height));
  for(const x of [p.x+10,p.x-10-p.width]){
   const box={x,y,width:p.width,height:p.height};
   if(x<bounds.x||x+p.width>bounds.x+bounds.width||y<bounds.y||y+p.height>bounds.y+bounds.height||occupied.some(b=>overlaps(box,b)))continue;
   occupied.push(box);return box;
  }
  return null;
 });
}
export function mountLineHover(plot,view,d,pins,colors,format,label,config={}){
 const options=tooltipOptions(config),valueText=v=>options.prefix+(options.decimals===null?format(v):v.toLocaleString(undefined,{minimumFractionDigits:options.decimals,maximumFractionDigits:options.decimals}))+options.suffix;
 const temporal=d.time&&!d.overlay,categories=temporal?[]:view.scale('x').domain(),categoryIndex=new Map(categories.map((s,i)=>[s,i]));
 const index=lineHoverIndex(temporal?d.values:d.values.map(r=>({...r,x:categoryIndex.get(r.xk)}))),events=new AbortController();let frame=0,lastEvent=null,disposed=false;
 const overlay=document.createElementNS('http://www.w3.org/2000/svg','svg');overlay.classList.add('line-hover-overlay');overlay.setAttribute('aria-hidden','true');plot.append(overlay);
 const tip=document.createElement('div');tip.className='scatter-tooltip line-comparison-tooltip';tip.setAttribute('role','tooltip');tip.hidden=true;document.body.append(tip);
 const clear=()=>{cancelAnimationFrame(frame);frame=0;lastEvent=null;overlay.replaceChildren();tip.hidden=true;};
 function draw(){frame=0;if(disposed||!lastEvent||!pins.size||plot.classList.contains('is-panning')||plot.classList.contains('is-box-zoom')){clear();return;}
  const e=lastEvent,p=plot.getBoundingClientRect(),surface=plot.querySelector('.studioPanSurface path')?.getBoundingClientRect(),svg=plot.querySelector('svg')?.getBoundingClientRect(),origin=view.origin(),b=surface||(svg?{left:svg.left+origin[0],top:svg.top+origin[1],right:svg.left+origin[0]+view.width(),bottom:svg.top+origin[1]+view.height(),width:view.width(),height:view.height()}:null);if(!b||e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom){clear();return;}
  const xs=view.scale('x'),ys=view.scale('y'),domain=xs.domain().map(Number),cursor=(e.clientX-b.left)*view.width()/b.width,position=t=>temporal?xs(t):xs(categories[t])+(xs.bandwidth?.()||0)/2,t=temporal?nearestObservation(index.times,Number(xs.invert(cursor)),Math.min(...domain),Math.max(...domain)):index.times.reduce((best,t)=>best===undefined||Math.abs(position(t)-cursor)<Math.abs(position(best)-cursor)?t:best,undefined);if(t===undefined){clear();return;}
  const rows=index.at.get(t),px=b.left-p.left+position(t)*b.width/view.width();overlay.replaceChildren();
  const add=(name,attrs)=>{const n=document.createElementNS(overlay.namespaceURI,name);for(const [key,value] of Object.entries(attrs))n.setAttribute(key,value);overlay.append(n);return n;};
  if(options.guide)add('line',{x1:px,x2:px,y1:b.top-p.top,y2:b.bottom-p.top,stroke:'var(--muted)','stroke-width':1,'stroke-dasharray':'3 3'});
  const dateText=temporal?label(t):String(rows.values().next().value?.xl??categories[t]);
  if(options.guide){
   const background=add('rect',{class:'line-hover-date-background',fill:'var(--panel)',rx:3});
   const date=add('text',{class:'line-hover-date','font-size':11,'font-weight':600,fill:'var(--text)'});date.textContent=dateText;
   const size=date.getBBox(),x=Math.max(5,Math.min(px-size.width/2,p.width-size.width-5)),y=b.bottom-p.top+8;
   date.setAttribute('x',x-size.x);date.setAttribute('y',y-size.y);
   for(const [key,value] of Object.entries({x:x-4,y:y-3,width:size.width+8,height:size.height+6}))background.setAttribute(key,value);
  }
  tip.replaceChildren();const heading=document.createElement('strong');heading.textContent=dateText;if(options.title)heading.textContent=options.title+' · '+heading.textContent;tip.append(heading);if(options.valueLabel){const subtitle=document.createElement('small');subtitle.textContent=options.valueLabel;tip.append(subtitle);}
  const points=[];
  d.series.forEach((s,i)=>{if(!pins.has(s))return;const row=rows.get(s),value=row?.value;
   const entry=document.createElement('div'),name=document.createElement('span'),swatch=document.createElement('span');swatch.className='line-hover-swatch';swatch.style.background=colors[i];name.append(swatch,document.createTextNode(Object.hasOwn(options.seriesLabels,s)?String(options.seriesLabels[s]):s));const amount=document.createElement('strong');amount.textContent=Number.isFinite(value)?valueText(value):'— No observation';entry.append(name,amount);tip.append(entry);
   for(const field of options.fields){const extra=document.createElement('div');extra.className='line-tooltip-extra';const name=document.createElement('span');name.textContent=field.label||field.column;const detail=row?.details?.[field.column];const val=document.createElement('span');val.textContent=!row?'— No observation':detail?.mixed?'Multiple values':detail?.value==null?'—':String(detail.value);extra.append(name,val);tip.append(extra);}

   if(Number.isFinite(value)){const py=b.top-p.top+ys(value)*b.height/view.height();if(py>=b.top-p.top&&py<=b.bottom-p.top){if(options.dots)add('circle',{cx:px,cy:py,r:4.5,fill:colors[i],stroke:'var(--panel)','stroke-width':2});points.push({x:px,y:py,text:valueText(value)});}}
  });
  tip.hidden=!options.show;const box=tip.getBoundingClientRect(),left=options.position==='corner'?b.right-box.width-8:e.clientX+16,top=options.position==='corner'?b.top+8:e.clientY+16;tip.style.left=Math.max(8,Math.min(left,innerWidth-box.width-8))+'px';tip.style.top=Math.max(8,Math.min(top,innerHeight-box.height-8))+'px';
  const labels=(options.labels?points:[]).map(point=>{const node=add('text',{class:'line-hover-value','font-size':11,'font-weight':600,fill:'var(--text)',stroke:'var(--panel)','stroke-width':3,'paint-order':'stroke','stroke-linejoin':'round',visibility:'hidden'});node.textContent=point.text;const rect=node.getBBox();return {...point,width:rect.width,height:rect.height,node,bbox:rect};});
  const screenBox=node=>{const r=node.getBoundingClientRect();return {x:r.left-p.left,y:r.top-p.top,width:r.width,height:r.height};};
  const obstacles=[...(options.show?[screenBox(tip)]:[]),...Array.from(plot.querySelectorAll('.mark-text.role-mark text'),screenBox)];
  const placements=placeHoverLabels(labels,{x:b.left-p.left+2,y:b.top-p.top+2,width:b.width-4,height:b.height-4},obstacles);
  labels.forEach((label,i)=>{const at=placements[i];if(!at){label.node.remove();return;}label.node.setAttribute('x',at.x-label.bbox.x);label.node.setAttribute('y',at.y-label.bbox.y);label.node.removeAttribute('visibility');});

 }
 plot.addEventListener('pointermove',e=>{if(e.buttons){clear();return;}lastEvent={clientX:e.clientX,clientY:e.clientY};if(!frame)frame=requestAnimationFrame(draw);},{signal:events.signal});
 plot.addEventListener('pointerleave',clear,{signal:events.signal});
 for(const type of ['pointerdown','scroll'])document.addEventListener(type,clear,{capture:true,signal:events.signal});
 // Screenshot shortcuts and transient OS focus changes should retain the hover.
 document.addEventListener('keydown',e=>{if(e.key==='Escape')clear();},{capture:true,signal:events.signal});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)clear();},{signal:events.signal});
 const signals=view.getState({signals:()=>true}).signals;for(const signal of ['studioXDomain','studioYDomain','studioPanAnchor','pinnedSeries'])if(Object.hasOwn(signals,signal))view.addSignalListener(signal,clear);
 const finalize=view.finalize.bind(view);view.finalize=()=>{disposed=true;clear();events.abort();tip.remove();overlay.remove();return finalize();};
 return {clear};
}
