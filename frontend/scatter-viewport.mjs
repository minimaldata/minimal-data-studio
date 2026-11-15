// Viewports are session-only and scoped to a result object and its X/Y mapping.
const viewports=new WeakMap();
export function applyScatterViewport(spec,c,d,{interactive=true}={}){
  if(c.type!=='scatter')return null;
  const key=JSON.stringify([c.x,c.y[0]]);let cached=viewports.get(d.res);if(!cached){cached=new Map();viewports.set(d.res,cached);}
  const scales=['x','y'].map(n=>spec.scales.find(s=>s.name===n));
  if(scales.some(s=>!Array.isArray(s?.domain)||s.domain.length!==2))return null;
  let state=cached.get(key);if(!state){state={initial:scales.map(s=>[...s.domain]),domains:scales.map(s=>[...s.domain])};cached.set(key,state);}
  spec.signals||=[];
  scales.forEach((s,i)=>{const name=i?'studioYDomain':'studioXDomain';spec.signals.push({name,value:[...state.domains[i]]});s.domain={signal:name};s.nice=false;});
  function clip(marks){for(const m of marks||[]){if(m.type==='symbol')m.clip=true;clip(m.marks);}}clip(spec.marks);
  if(!interactive)return state;
  // Transparent hit area makes empty plot space draggable in SVG renderers.
  spec.marks.unshift({name:'studioPanSurface',type:'rect',encode:{update:{x:{value:0},y:{value:0},width:{signal:'width'},height:{signal:'height'},fill:{value:'transparent'}}}});
  spec.signals.push({name:'studioPanAnchor',value:null});
  return state;
}
