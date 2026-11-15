import {isStackedChart} from './stacked-interaction.mjs';
const viewports=new WeakMap();
// Zoom the band scale's range, never its data/domain: normalization uses every segment.
export function applyStackedViewport(spec,c,d){
 if((!isStackedChart(c)&&c.type!=='bar')||!d.values.length)return null;
 // Keep layout independent of offscreen band positions while panning/zooming.
 spec.autosize={type:"none",contains:"padding"};
 spec.padding={left:c.horizontal?110:64,right:16,top:12,bottom:54};
 const horizontal=!!c.horizontal,category=horizontal?'y':'x',value=horizontal?'x':'y';
 const scale=spec.scales.find(s=>s.name===category),measure=spec.scales.find(s=>s.name===value);if(!scale||!measure)return null;
 let cache=viewports.get(d.res);if(!cache){cache=new Map();viewports.set(d.res,cache);}
 const count=new Set(d.values.map(r=>r.xk)).size,key=JSON.stringify([c.type,c.x,c.y,c.series,c.horizontal,c.sort,d.grain,d.series,!!d.cum]);
 let state=cache.get(key);if(!state){const initial=horizontal?[null,[0,count]]:[[0,count],null];state={initial,domains:initial.map(a=>a&&[...a])};cache.set(key,state);}
 spec.signals.push({name:'studioXDomain',value:state.domains[0]},{name:'studioYDomain',value:state.domains[1]},{name:'studioHovered',value:null},{name:'studioPanAnchor',value:null});
 const signal=horizontal?'studioYDomain':'studioXDomain',span=`(${signal}[1]-${signal}[0])`;
 scale.range={signal:horizontal?`[height*(${signal}[1]-${count})/${span},height*${signal}[1]/${span}]`:`[-width*${signal}[0]/${span},width*(${count}-${signal}[0])/${span}]`};
 measure.domainRaw={signal:horizontal?'studioXDomain':'studioYDomain'};
 for(const axis of spec.axes||[])if(axis.scale===category){axis.domain=false;axis.encode||={};axis.encode.labels||={};axis.encode.labels.update||={};axis.encode.labels.update.opacity={signal:`scale('${category}',datum.value) >= 0 && scale('${category}',datum.value) <= ${horizontal?'height':'width'} ? 1 : 0`};axis.encode.ticks||={};axis.encode.ticks.update||={};axis.encode.ticks.update.opacity=axis.encode.labels.update.opacity;
 // Invisible out-of-window ticks must also stay inside the plot bounds, or
 // Vega's autosize can reserve their offscreen extent (notably in Firefox).
 const position={signal:`clamp(scale('${category}',datum.value)+bandwidth('${category}')/2,0,${horizontal?'height':'width'})`};
 axis.encode.labels.update[category]=position;axis.encode.ticks.update[category]=position;}
 const clip=marks=>{for(const m of marks||[]){m.clip=true;clip(m.marks);}};clip(spec.marks);
 spec.marks.unshift({name:'studioPanSurface',type:'rect',encode:{update:{x:{value:0},y:{value:0},width:{signal:'width'},height:{signal:'height'},fill:{value:'transparent'}}}});
 return state;
}
