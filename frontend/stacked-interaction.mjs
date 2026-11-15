import {resolveSeriesKind} from './line-series.mjs';
export const isStackedChart=c=>c.type==='stacked'||c.type==='percent';
// Stack inspection changes emphasis only: never filter rows or recompute stack positions.
export function bindStackedInspection(view,pins,onHover){
 const series=item=>item?.mark?.marktype==='rect'?item.datum?.series:null;
 const hover=s=>{if(pins.size)s=null;view.signal('hl',s).runAsync();onHover(s);};
 view.addEventListener('pointerover',(_,item)=>{const s=series(item);if(s!=null)hover(s);});
 view.addEventListener('pointerout',(_,item)=>{if(series(item)!=null)hover(null);});
 view.signal('pinnedSeries',[...pins]);
}

export function selectedStackSummary(rows,pins){
 const valid=rows.filter(r=>Number.isFinite(r.value)),total=valid.reduce((sum,r)=>sum+r.value,0),selected=valid.filter(r=>pins.has(r.series)).reduce((sum,r)=>sum+r.value,0);
 return {total,selected,share:total>0&&valid.every(r=>r.value>=0)?selected/total:null};
}
export function createStackedTooltip(plot,d,pins,format,config){
 const o=config.stackTooltip||{},number=v=>(o.prefix||'')+(Number.isInteger(o.decimals)?v.toLocaleString(undefined,{minimumFractionDigits:Math.max(0,Math.min(6,o.decimals)),maximumFractionDigits:Math.max(0,Math.min(6,o.decimals))}):format(v))+(o.suffix||'');
 const byX=new Map();for(const row of d.values){if(!byX.has(row.xk))byX.set(row.xk,[]);byX.get(row.xk).push(row);}
 const events=new AbortController(),tip=document.createElement('div');tip.className='scatter-tooltip stacked-tooltip';tip.setAttribute('role','tooltip');tip.hidden=true;document.body.append(tip);
 const overlay=document.createElementNS('http://www.w3.org/2000/svg','svg');overlay.classList.add('line-hover-overlay');plot.style.position='relative';plot.append(overlay);
 const clear=()=>{tip.hidden=true;overlay.replaceChildren();};
 const percent=v=>v===null?'—':(v*100).toLocaleString(undefined,{maximumFractionDigits:1})+'%';
 function handler(_handler,event,item,value){
  clear();if(value==null||!item?.datum||!plot.isConnected||plot.classList.contains('is-panning')||plot.classList.contains('is-box-zoom'))return;
  tip.replaceChildren();
  const add=(name,value)=>{const row=document.createElement('div'),key=document.createElement('strong');key.textContent=name;row.append(key,document.createTextNode(String(value)));tip.append(row);};
  if(!pins.size||config.stackHover==='segment'){if(o.title){const heading=document.createElement('strong');heading.textContent=o.title;tip.append(heading);}for(const [key,val] of Object.entries(value)){const measure=key===(config.y.length===1?config.y[0]:'value');add(measure&&o.valueLabel?o.valueLabel:key,measure?number(item.datum.value):key==='Bar total'?number(item.datum.xtotal):val??'—');}}
  else{
   const rows=byX.get(item.datum.xk)||[],summary=selectedStackSummary(rows,pins);
   const heading=document.createElement('strong');heading.textContent=(o.title?o.title+' · ':'')+(item.datum.xl??item.datum.xk);tip.append(heading);
   add(resolveSeriesKind(config.seriesKind,d.series)==='cohorts'?'Selected cohorts':'Selected series',pins.size);add('Combined '+(o.valueLabel||(config.y.length===1?config.y[0]:'value')),number(summary.selected));add('Share of total',percent(summary.share));add('Bar total',number(summary.total));
   // Use rendered segment bounds, including horizontal charts. Split separated bands.
   const segments=[...plot.querySelectorAll('.mark-rect.role-mark path')].filter(n=>n.__data__?.datum?.xk===item.datum.xk&&pins.has(n.__data__.datum.series)).map(n=>n.getBoundingClientRect());
   const horizontal=!!config.horizontal,start=r=>horizontal?r.left:r.top,end=r=>horizontal?r.right:r.bottom;
   segments.sort((a,b)=>start(a)-start(b));const bands=[];
   for(const r of segments){const last=bands.at(-1);if(last&&start(r)<=last.end+2){last.end=Math.max(last.end,end(r));}else bands.push({start:start(r),end:end(r),rect:r});}
   const band=bands.sort((a,b)=>(b.end-b.start)-(a.end-a.start))[0];
   if(summary.share!==null&&o.labels!==false){
    const p=plot.getBoundingClientRect(),text=document.createElementNS(overlay.namespaceURI,'text');
    for(const [k,v] of Object.entries({class:'stacked-selection-value','text-anchor':'middle','dominant-baseline':'middle','font-size':11,'font-weight':700,fill:'var(--text)',stroke:'var(--panel)','stroke-width':3,'paint-order':'stroke',x:horizontal?p.width/2:band?band.rect.left+band.rect.width/2-p.left:event.clientX-p.left,y:9}))text.setAttribute(k,v);
    text.textContent=(bands.length>1?'Σ ':'')+percent(summary.share);overlay.append(text);const half=text.getBBox().width/2+4;text.setAttribute('x',Math.max(half,Math.min(Number(text.getAttribute('x')),p.width-half)));
   }
  }
  tip.hidden=o.show===false;const box=tip.getBoundingClientRect(),p=plot.getBoundingClientRect(),left=o.position==='corner'?p.right-box.width-8:event.clientX+16,top=o.position==='corner'?p.top+8:event.clientY+16;tip.style.left=Math.max(8,Math.min(left,innerWidth-box.width-8))+'px';tip.style.top=Math.max(8,Math.min(top,innerHeight-box.height-8))+'px';
 }
 plot.addEventListener('pointerleave',clear,{signal:events.signal});
 for(const type of ['pointerdown','scroll'])document.addEventListener(type,clear,{capture:true,signal:events.signal});
 document.addEventListener('keydown',e=>{if(e.key==='Escape')clear();},{signal:events.signal});
 return {handler,clear,attach(view){plot.append(overlay);for(const name of ['pinnedSeries','studioXDomain','studioYDomain','studioPanAnchor'])if(Object.hasOwn(view.getState({signals:()=>true}).signals,name))view.addSignalListener(name,clear);const finalize=view.finalize.bind(view);view.finalize=()=>{events.abort();tip.remove();overlay.remove();return finalize();};},dispose(){events.abort();tip.remove();overlay.remove();}};
}
