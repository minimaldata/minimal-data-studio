export const SHAPES=['circle','square','triangle-up','diamond','cross','triangle-down','triangle-right','triangle-left'];
const hex=v=>/^#[0-9a-f]{6}$/i.test(v||'');
export function categoryMapping(c,d,key,palette){
  const domain=[...new Set(d.values.map(p=>p[key]))].sort();
  const overrides=c.categoryStyles?.[key]?.[c[key]]||{};
  return {domain,range:domain.map((value,i)=>{const custom=Object.hasOwn(overrides,value)?overrides[value]:null;return key==='color'?(hex(custom)?custom:palette[i%palette.length]):(SHAPES.includes(custom)?custom:SHAPES[i%SHAPES.length]);})};
}
export function mappingRule(c,key){
 const r=c.scatterRules?.[key];return r?.field===c[key]?r:null;
}
export function resolveMapping(c,d,key){
 let lo=Infinity,hi=-Infinity;for(const p of d.values)if(Number.isFinite(p[key])){lo=Math.min(lo,p[key]);hi=Math.max(hi,p[key]);}
 if(lo===Infinity){lo=0;hi=1;}if(key==='size')lo=0;
 const r=mappingRule(c,key)||{},min=Number.isFinite(r.inputMin)?r.inputMin:lo,max=Number.isFinite(r.inputMax)?r.inputMax:hi;
 const outMin=Number.isFinite(r.outputMin)?r.outputMin:(key==='size'?20:28),outMax=Number.isFinite(r.outputMax)?r.outputMax:(key==='size'?700:72);
 const valid=min<=max&&outMin>=0&&outMax>outMin&&outMax<=(key==='size'?4000:100);
 return {domain:valid?[min,max]:[lo,hi],range:valid?(r.reverse?[outMax,outMin]:[outMin,outMax]):(key==='size'?[20,700]:[28,72])};
}
export function lightnessPreview(color,min,max,reverse=false){
 if(!hex(color)||!Number.isFinite(min)||!Number.isFinite(max)||min<0||max>100||min>=max)return null;
 const rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255),hi=Math.max(...rgb),lo=Math.min(...rgb),delta=hi-lo,light=(hi+lo)/2;
 let hue=0;if(delta){const [r,g,b]=rgb;hue=(hi===r?(g-b)/delta+(g<b?6:0):hi===g?(b-r)/delta+2:(r-g)/delta+4)*60;}
 const saturation=delta?delta/(1-Math.abs(2*light-1))*100:0,range=reverse?[max,min]:[min,max];
 return {range,background:`linear-gradient(to right, hsl(${hue}, ${saturation}%, ${range[0]}%), hsl(${hue}, ${saturation}%, ${range[1]}%))`};
}
export function mappingControls(menu,c,d,palette,onChange){
 const group=title=>{const det=document.createElement('details'),summary=document.createElement('summary');summary.textContent=title;det.append(summary);menu.append(det);return det;};
 for(const key of ['color','shape']){
  if(!c[key]||(key==='color'&&d.numericColor))continue;
  const det=group(key==='color'?'Category colors':'Category shapes'),map=categoryMapping(c,d,key,palette),draft=Object.assign(Object.create(null),c.categoryStyles?.[key]?.[c[key]]||{});
  const search=document.createElement('input');search.type='search';search.placeholder='Find a category';search.setAttribute('aria-label',key+' category search');det.append(search);
  const rows=document.createElement('div'),note=document.createElement('small');det.append(rows,note);
  const render=()=>{rows.replaceChildren();const matches=map.domain.filter(v=>String(v).toLowerCase().includes(search.value.toLowerCase()));
   for(const value of matches.slice(0,40)){
    const label=document.createElement('label'),name=document.createElement('span');name.textContent=value;name.title=value;label.append(name);
    const input=document.createElement(key==='color'?'input':'select');input.setAttribute('aria-label',`${key} for ${value}`);
    if(key==='color'){input.type='color';input.value=draft[value]||map.range[map.domain.indexOf(value)];}
    else for(const shape of SHAPES)input.append(Object.assign(document.createElement('option'),{value:shape,textContent:shape,selected:shape===(draft[value]||map.range[map.domain.indexOf(value)])}));
    input.onchange=()=>{draft[value]=input.value;};label.append(input);rows.append(label);
   }note.textContent=matches.length>40?`Showing 40 of ${matches.length} categories. Search to find others.`:'';
  };search.oninput=render;render();
  const apply=document.createElement('button');apply.type='button';apply.textContent=key==='color'?'Apply category colors':'Apply category shapes';apply.onclick=()=>{
   c.categoryStyles={...c.categoryStyles,[key]:{...c.categoryStyles?.[key],[c[key]]:{...draft}}};onChange();
  };const reset=document.createElement('button');reset.type='button';reset.textContent='Reset '+key+' categories';reset.onclick=()=>{if(c.categoryStyles?.[key])delete c.categoryStyles[key][c[key]];onChange();};det.append(apply,reset);
 }
 for(const key of ['size','brightness']){
  if(!c[key])continue;
  const title=key==='size'?'Size mapping':'Brightness mapping',det=group(title),r=mappingRule(c,key)||{},resolved=resolveMapping(c,d,key),inputs={};
  const hint=document.createElement('p');hint.className='muted';hint.textContent=key==='size'?'Map values to point area (px²). Values outside the input range are clamped.':'Map values to lightness (%). Values outside the input range are clamped; missing values stay at 50%.';det.append(hint);
  for(const [name,label,placeholder] of [['inputMin','Input minimum',resolved.domain[0]],['inputMax','Input maximum',resolved.domain[1]],['outputMin',key==='size'?'Minimum area':'Minimum lightness',key==='size'?20:28],['outputMax',key==='size'?'Maximum area':'Maximum lightness',key==='size'?700:72]]){
   const row=document.createElement('label');row.append(Object.assign(document.createElement('span'),{textContent:label}));const input=document.createElement('input');input.type='number';input.step='any';input.placeholder=String(placeholder);input.value=r[name]??'';input.setAttribute('aria-label',title+' '+label.toLowerCase());row.append(input);det.append(row);inputs[name]=input;
  }
  const reverseRow=document.createElement('label'),reverse=document.createElement('input');reverse.type='checkbox';reverse.checked=!!r.reverse;reverseRow.append(document.createTextNode('Reverse mapping'),reverse);det.append(reverseRow);
  if(key==='brightness'){
   let color=c.scatterStyle?.color||palette[0],example='Point color';
   if(c.color&&d.numericColor){color='#21918c';example='Example color from the numeric scale';}
   else if(c.color){const colors=categoryMapping(c,d,'color',palette);color=colors.range[0]||palette[0];example='Example: '+(colors.domain[0]??c.color);}
   const preview=document.createElement('div');preview.className='lightness-preview';
   const caption=document.createElement('small');caption.textContent=example+' · full opacity';
   const ramp=document.createElement('div');ramp.className='lightness-ramp';ramp.setAttribute('role','img');
   const endpoints=document.createElement('div');endpoints.className='lightness-endpoints';
   const left=document.createElement('span'),right=document.createElement('span');endpoints.append(left,right);
   const invalid=document.createElement('small');invalid.textContent='Enter an increasing lightness range between 0% and 100%.';invalid.hidden=true;
   preview.append(caption,ramp,endpoints,invalid);det.append(preview);
   const redraw=()=>{
    const read=(name,fallback)=>inputs[name].validity.valid?(inputs[name].value.trim()===''?fallback:Number(inputs[name].value)):NaN;
    const value=lightnessPreview(color,read('outputMin',28),read('outputMax',72),reverse.checked);
    ramp.hidden=endpoints.hidden=!value;invalid.hidden=!!value;
    if(value){ramp.style.background=value.background;left.textContent=`Low values · ${value.range[0]}%`;right.textContent=`High values · ${value.range[1]}%`;ramp.setAttribute('aria-label',`Lightness preview: low values ${value.range[0]}%, high values ${value.range[1]}%`);}
   };
   inputs.outputMin.addEventListener('input',redraw);inputs.outputMax.addEventListener('input',redraw);reverse.addEventListener('change',redraw);redraw();
  }
  const error=document.createElement('div');error.className='error';error.hidden=true;error.setAttribute('role','alert');det.append(error);
  const apply=document.createElement('button');apply.type='button';apply.textContent='Apply '+key+' mapping';apply.onclick=()=>{
   const next={field:c[key],reverse:reverse.checked};for(const [name,input] of Object.entries(inputs))if(input.value.trim()!=='')next[name]=Number(input.value);
   const a=next.inputMin??resolved.domain[0],b=next.inputMax??resolved.domain[1],low=next.outputMin??(key==='size'?20:28),high=next.outputMax??(key==='size'?700:72);
   if(Object.values(inputs).some(i=>!i.validity.valid)||!Number.isFinite(a)||!Number.isFinite(b)||a>b||low<0||high<=low||high>(key==='size'?4000:100)){
    error.textContent=`Use an ordered input range and an increasing output range from 0 to ${key==='size'?'4,000 px²':'100%'}.`;error.hidden=false;return;
   }
   c.scatterRules={...c.scatterRules,[key]:next};onChange();
  };const reset=document.createElement('button');reset.type='button';reset.textContent='Reset '+key+' mapping';reset.onclick=()=>{if(c.scatterRules)delete c.scatterRules[key];onChange();};det.append(apply,reset);
 }
}
