export const COLOR_PRESETS={default:'Cohort spectrum',viridis:'Purple → teal → yellow',blue:'Light → deep blue','blue-orange':'Blue → orange',custom:'Custom endpoints'};
const hex=v=>/^#[0-9a-f]{6}$/i.test(v||'');
export function stripPalette(count,dark=false,config={}){
 const ranges={viridis:['#440154','#21918c','#fde725'],blue:['#a6cee3','#08519c'],'blue-orange':['#2166ac','#f28e2b'],custom:[hex(config.start)?config.start:'#2166ac',hex(config.end)?config.end:'#f28e2b']};
 const stops=ranges[config.palette];
 const colors=Array.from({length:count},(_,i)=>{const t=i/Math.max(1,count-1);if(!stops)return `hsl(${Math.round(240-220*t)}, ${dark?65:70}%, ${dark?65:42}%)`;
  const at=t*(stops.length-1),lo=Math.min(stops.length-2,Math.floor(at)),f=at-lo;
  return '#'+[1,3,5].map(p=>Math.round(parseInt(stops[lo].slice(p,p+2),16)*(1-f)+parseInt(stops[lo+1].slice(p,p+2),16)*f).toString(16).padStart(2,'0')).join('');
 });return config.reverse?colors.reverse():colors;
}
export function tooltipOptions(c){const r=c.lineTooltip||{};return {show:r.show!==false,labels:r.labels!==false,dots:r.dots!==false,guide:r.guide!==false,position:r.position==='corner'?'corner':'cursor',decimals:Number.isInteger(r.decimals)?Math.max(0,Math.min(6,r.decimals)):null,prefix:String(r.prefix||''),suffix:String(r.suffix||''),valueLabel:String(r.valueLabel||''),title:String(r.title||''),seriesLabels:r.seriesLabels&&typeof r.seriesLabels==='object'?r.seriesLabels:{},fields:Array.isArray(r.fields)?r.fields.filter(f=>f&&typeof f.column==='string').slice(0,12):[]};}
// Distinguish actual values from mixed groups (including mixtures of null and non-null).
export function mergeDetails(a={},b={}){const out={...a};for(const [key,value] of Object.entries(b)){const old=Object.hasOwn(out,key)?out[key]:undefined;Object.defineProperty(out,key,{value:old===undefined?value:old.mixed||value.mixed||old.value!==value.value?{mixed:true}:old,enumerable:true,writable:true,configurable:true});}return out;}
function formControls(menu){
 const section=title=>{const det=document.createElement('details'),sum=document.createElement('summary');sum.textContent=title;det.append(sum);menu.append(det);return det;};
 const field=(host,title,type,value)=>{const l=document.createElement('label'),text=document.createElement('span');text.textContent=title;const i=document.createElement('input');i.type=type;if(type==='checkbox')i.checked=value;else i.value=value??'';l.append(text,i);host.append(l);return i;};
 const select=(host,title,options,value)=>{const l=document.createElement('label'),s=document.createElement('select');l.append(document.createTextNode(title),s);for(const [v,t] of Object.entries(options))s.add(new Option(t,v,false,v===value));host.append(l);return s;};
 const button=(host,title,fn)=>{const b=document.createElement('button');b.type='button';b.textContent=title;b.onclick=e=>{e.stopPropagation();fn();};host.append(b);};
 return {section,field,select,button};
}
export function mountLineAppearance(menu,c,res,names,dark,onApply){
 const {section,field,select,button}=formControls(menu);
 const colors=section('Color strip');const raw=c.stripColors||{};
 const preset=select(colors,'Color range',COLOR_PRESETS,raw.palette||'default'),start=field(colors,'Start color','color',raw.start||'#2166ac'),end=field(colors,'End color','color',raw.end||'#f28e2b'),reverse=field(colors,'Reverse colors','checkbox',!!raw.reverse);
 const preview=document.createElement('div');preview.className='lightness-ramp';preview.setAttribute('role','img');preview.setAttribute('aria-label','Cohort color range preview');colors.append(preview);
 const config=()=>({palette:preset.value,start:start.value,end:end.value,reverse:reverse.checked});
 const repaint=()=>{start.disabled=end.disabled=preset.value!=='custom';preview.style.background=`linear-gradient(to right, ${stripPalette(16,dark,config()).join(',')})`;};for(const el of [preset,start,end,reverse])el.oninput=repaint;repaint();
 button(colors,'Apply color range',()=>{c.stripColors=config();onApply();});button(colors,'Reset color range',()=>{delete c.stripColors;onApply();});
}
export function mountLineTooltip(tip,c,res,names,onApply){
 const {field,select,button}=formControls(tip);
 const hint=document.createElement('small');hint.textContent='Applies to Compare selected series. Extra fields describe the source rows for that point.';tip.append(hint);const o=tooltipOptions(c);
 const show=field(tip,'Show tooltip','checkbox',o.show),labels=field(tip,'Show value labels','checkbox',o.labels),dots=field(tip,'Show hover dots','checkbox',o.dots),guide=field(tip,'Show date guide','checkbox',o.guide),position=select(tip,'Tooltip position',{cursor:'Follow cursor',corner:'Top right of plot'},o.position);
 const title=field(tip,'Tooltip heading','text',o.title),valueLabel=field(tip,'Value label','text',o.valueLabel),decimals=field(tip,'Decimal places','number',o.decimals??'');decimals.min=0;decimals.max=6;decimals.step=1;decimals.placeholder='Use chart number format';
 const prefix=field(tip,'Value prefix','text',o.prefix),suffix=field(tip,'Value suffix','text',o.suffix);
 const aliases=sectionIn(tip,'Series labels');const aliasInputs=names.map(name=>[name,field(aliases,name,'text',Object.hasOwn(o.seriesLabels,name)?o.seriesLabels[name]:'')]);
 const extra=sectionIn(tip,'Extra result columns'),extraInputs=res.cols.filter(n=>n!==c.x&&!c.y.includes(n)&&n!==c.series).map(n=>{const old=o.fields.find(f=>f.column===n);return {column:n,enabled:field(extra,'Include '+n,'checkbox',!!old),label:field(extra,'Label for '+n,'text',old?.label||n)};});
 const error=document.createElement('div');error.className='error';error.setAttribute('role','alert');error.hidden=true;tip.append(error);
 button(tip,'Apply tooltip settings',()=>{if(!decimals.checkValidity()||extraInputs.filter(f=>f.enabled.checked).length>12){error.textContent='Use 0–6 decimal places and at most 12 extra columns.';error.hidden=false;return;}c.lineTooltip={show:show.checked,labels:labels.checked,dots:dots.checked,guide:guide.checked,position:position.value,title:title.value,valueLabel:valueLabel.value,decimals:decimals.value===''?null:Number(decimals.value),prefix:prefix.value,suffix:suffix.value,seriesLabels:Object.fromEntries(aliasInputs.filter(([,el])=>el.value.trim()).map(([name,el])=>[name,el.value.trim()])),fields:extraInputs.filter(f=>f.enabled.checked).map(f=>({column:f.column,label:f.label.value.trim()||f.column}))};onApply();});
 button(tip,'Reset tooltip settings',()=>{delete c.lineTooltip;onApply();});
}
function sectionIn(host,title){const det=document.createElement('details'),sum=document.createElement('summary');sum.textContent=title;det.append(sum);host.append(det);return det;}
export function mountStackedTooltip(host,c,onApply){
 const {field,select,button}=formControls(host),o=c.stackTooltip||{};
 const show=field(host,'Show tooltip','checkbox',o.show!==false),labels=field(host,'Show percentage label','checkbox',o.labels!==false);
 const position=select(host,'Tooltip position',{cursor:'Follow cursor',corner:'Top right of plot'},o.position||'cursor');
 const title=field(host,'Tooltip heading','text',o.title||''),valueLabel=field(host,'Value label','text',o.valueLabel||'');
 const decimals=field(host,'Decimal places','number',o.decimals??'');decimals.min=0;decimals.max=6;decimals.step=1;decimals.placeholder='Use chart number format';
 const prefix=field(host,'Value prefix','text',o.prefix||''),suffix=field(host,'Value suffix','text',o.suffix||'');
 button(host,'Apply tooltip settings',()=>{if(!decimals.reportValidity())return;c.stackTooltip={show:show.checked,labels:labels.checked,position:position.value,title:title.value,valueLabel:valueLabel.value,decimals:decimals.value===''?null:Number(decimals.value),prefix:prefix.value,suffix:suffix.value};onApply();});
 button(host,'Reset tooltip settings',()=>{delete c.stackTooltip;onApply();});
}
