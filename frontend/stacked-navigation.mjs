import {isStackedChart} from './stacked-interaction.mjs';
const viewports=new WeakMap();
// Zoom the band scale's range, never its data/domain: normalization uses every segment.
export function applyStackedViewport(spec,c,d){
 if((!isStackedChart(c)&&c.type!=='bar')||!d.values.length)return null;
 // Keep layout independent of offscreen band positions while panning/zooming.
 spec.autosize={type:"none",contains:"padding"};
 spec.padding={left:c.horizontal?110:64,right:16,top:Math.max(12, Number(spec.padding?.top)||0),bottom:54};
 const horizontal=!!c.horizontal,category=horizontal?'y':'x',value=horizontal?'x':'y';
 const scale=spec.scales.find(s=>s.name===category),measure=spec.scales.find(s=>s.name===value);if(!scale||!measure)return null;
 let cache=viewports.get(d.res);if(!cache){cache=new Map();viewports.set(d.res,cache);}
 const count=new Set(d.values.map(r=>r.xk)).size,key=JSON.stringify([c.type,c.x,c.y,c.series,c.horizontal,c.sort,d.grain,d.series,!!d.cum]);
 let state=cache.get(key);if(!state){const initial=horizontal?[null,[0,count]]:[[0,count],null];state={initial,domains:initial.map(a=>a&&[...a])};cache.set(key,state);}
 (spec.signals ||= []).push({name:'studioXDomain',value:state.domains[0]},{name:'studioYDomain',value:state.domains[1]},{name:'studioHovered',value:null},{name:'studioPanAnchor',value:null});
 const signal=horizontal?'studioYDomain':'studioXDomain',span=`(${signal}[1]-${signal}[0])`;
 scale.range={signal:horizontal?`[height*(${signal}[1]-${count})/${span},height*${signal}[1]/${span}]`:`[-width*${signal}[0]/${span},width*(${count}-${signal}[0])/${span}]`};
 measure.domainRaw={signal:horizontal?'studioXDomain':'studioYDomain'};
 // Generate ticks only for visible categories. Clamping every offscreen tick to
 // an edge confuses Vega's overlap layout and piles date labels at that edge.
 for(const axis of spec.axes||[])if(axis.scale===category){
  axis.domain=false;
  axis.values={signal:`slice(domain('${category}'), max(0,ceil(${signal}[0]-.5)), min(${count},ceil(${signal}[1]-.5)))`};
  axis.labelOverlap='greedy';
  if(d.time){
   const labels=Object.fromEntries(d.values.map(r=>[r.xk,r.xl]));
   axis.encode||={};axis.encode.labels||={};axis.encode.labels.update||={};
   axis.encode.labels.update.text={signal:`${JSON.stringify(labels)}[datum.value] || datum.label`};
  }
 }
 const clip=marks=>{for(const m of marks||[]){m.clip=true;clip(m.marks);}};clip(spec.marks);
 spec.marks.unshift({name:'studioPanSurface',type:'rect',encode:{update:{x:{value:0},y:{value:0},width:{signal:'width'},height:{signal:'height'},fill:{value:'transparent'}}}});
 return state;
}
