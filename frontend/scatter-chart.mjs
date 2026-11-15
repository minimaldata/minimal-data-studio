import {categoryMapping,mappingRule,resolveMapping,mappingControls} from './scatter-mappings.mjs';
const openStyles=new WeakSet();
export function scatterStyle(c){
  const raw=c.scatterStyle||{},bounded=(v,fallback,min,max)=>Number.isFinite(v)?Math.max(min,Math.min(max,v)):fallback;
  return {size:bounded(raw.size,1,.25,4),opacity:bounded(raw.opacity,c.brightness?1:.75,.05,1),outline:raw.outline===true,grid:raw.grid!==false,legend:raw.legend!==false,color:/^#[0-9a-f]{6}$/i.test(raw.color||'')?raw.color:null};
}
export function scatterLegendVisible(c,key){return scatterStyle(c).legend && c.scatterStyle?.legends?.[key]!==false;}
export function numericExtent(values,key){let low=Infinity,high=-Infinity;for(const row of values){const v=row[key];if(Number.isFinite(v)){low=Math.min(low,v);high=Math.max(high,v);}}return low===Infinity?[0,1]:[low,high];}
// Scatterplots retain individual rows; never aggregate coincident observations.
export function scatterData(c, res, isNumeric, format = value => String(value)) {
  const index = key => res.cols.indexOf(c[key]);
  const xi=index('x'), yi=res.cols.indexOf(c.y?.[0]), size=index('size'), color=index('color'), shape=index('shape'), brightness=index('brightness'), label=index('label');
  const numericColor=color>=0 && isNumeric(res.types[color]);
  const number=(row,i)=>row[i]==null?NaN:Number(format(row[i],res.types[i]));
  const category=(row,i)=>row[i]==null?'(missing)':String(format(row[i],res.types[i]));
  const values=[];let skipped=0;
  for(const [rowIndex,row] of res.rows.entries()){
    const x=number(row,xi),y=number(row,yi),s=size>=0?number(row,size):null;
    if(!Number.isFinite(x)||!Number.isFinite(y)||(size>=0&&(!Number.isFinite(s)||s<0))){skipped++;continue;}
    const point={x,y,rowNumber:rowIndex+1};
    if(label>=0)point.label=category(row,label);
    if(brightness>=0)point.brightness=Number.isFinite(number(row,brightness))?number(row,brightness):null;
    if(size>=0)point.size=s;
    if(color>=0)point.color=numericColor?(Number.isFinite(number(row,color))?number(row,color):null):category(row,color);
    if(shape>=0)point.shape=category(row,shape);
    values.push(point);
  }
  return {values,series:[],time:false,folded:0,res,skipped,numericColor};
}
export function scatterSpec(c,d,theme={}){
  const {text='#222',muted='#666',border='#ddd',background='#fff',palette=['#3275db']}=theme;
  const style=scatterStyle(c);
  const domain=key=>{if(!d.values.length)return {};const [low,high]=numericExtent(d.values,key),pad=(high-low||Math.abs(low)||1)*.08;return {domain:[low-pad,high+pad]};};
  const encoding={x:{field:'x',type:'quantitative',title:c.x,scale:{zero:false,...domain('x')}},y:{field:'y',type:'quantitative',title:c.y[0],scale:{zero:false,...domain('y')}}};
  const tooltip=[{field:"rowNumber",type:"ordinal",title:"Result row"},...(c.label?[{field:"label",type:"nominal",title:c.label}]:[]),{field:'x',type:'quantitative',title:c.x},{field:'y',type:'quantitative',title:c.y[0]}];
  if(c.size){encoding.size={field:'size',type:'quantitative',title:c.size,scale:{zero:true,range:[20*style.size,700*style.size]}};tooltip.push({field:'size',type:'quantitative',title:c.size});}
  if(c.size&&mappingRule(c,'size')){const m=resolveMapping(c,d,'size');encoding.size.scale={zero:false,clamp:true,domain:m.domain,range:m.range.map(v=>v*style.size)};}
  if(c.color){encoding.color={field:'color',type:d.numericColor?'quantitative':'nominal',title:c.color,scale:d.numericColor?{scheme:'viridis'}:categoryMapping(c,d,'color',palette)};tooltip.push({field:'color',type:d.numericColor?'quantitative':'nominal',title:c.color});}
  if(c.shape){encoding.shape={field:'shape',type:'nominal',title:c.shape,scale:categoryMapping(c,d,'shape',palette)};tooltip.push({field:'shape',type:'nominal',title:c.shape});}
  if(c.brightness)tooltip.push({field:'brightness',type:'quantitative',title:c.brightness+' (brightness)'});
  encoding.tooltip=tooltip;
  for(const key of ['size','shape','color'])if(encoding[key]&&!scatterLegendVisible(c,key))encoding[key].legend=null;
  return {$schema:'https://vega.github.io/schema/vega-lite/v5.json',width:'container',height:'container',autosize:{type:'fit',contains:'padding'},background,
    ...(c.title?{title:{text:c.title,subtitle:c.subtitle||undefined,color:text,subtitleColor:muted,anchor:'start'}}:{}),
    data:{values:d.values},mark:{type:'point',filled:true,size:75*style.size,opacity:style.opacity,color:style.color||palette[0],stroke:style.outline?text:'transparent',strokeWidth:style.outline?1:0},encoding,
    config:{view:{stroke:null},axis:{labelColor:muted,titleColor:text,gridColor:border,grid:style.grid,domain:false},legend:{labelColor:text,titleColor:text,orient:'top',direction:'horizontal',labelLimit:100,symbolLimit:12}}};
}
export function scatterControls(bar,c,res,select,onChange,isNumeric,format=String,palette=['#3275db']){
  const numbers=res.cols.filter((_,i)=>isNumeric(res.types[i])).map(n=>[n,n]);
  select('X',c.x,numbers,v=>{c.x=v;});
  select('Y',c.y[0],numbers,v=>{c.y=[v];});
  select('Size',c.size||'',[['','— uniform —'],...numbers],v=>{c.size=v;});
  select('Shape',c.shape||'',[['','— uniform —'],...res.cols.map(n=>[n,n])],v=>{c.shape=v;});
  select('Color',c.color||'',[['','— uniform —'],...res.cols.map(n=>[n,n])],v=>{c.color=v;});
  select('Label',c.label||'',[['','— row number —'],...res.cols.map(n=>[n,n])],v=>{c.label=v;});
  select('Brightness',c.brightness||'',[['','— uniform —'],...numbers],v=>{c.brightness=v;});
  const style=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Style';style.append(summary);const menu=document.createElement('div');menu.className='menu stylemenu';menu.addEventListener('click',event=>event.stopPropagation());style.append(menu);bar.append(style);style.open=openStyles.has(c);style.addEventListener('toggle',()=>{if(style.open){openStyles.add(c);const rect=summary.getBoundingClientRect(),top=Math.max(8,Math.min(rect.bottom+4,innerHeight*.25));Object.assign(menu.style,{position:'fixed',right:'auto',maxHeight:Math.max(120,innerHeight-top-12)+'px',overflowY:'auto',zIndex:100,left:Math.max(8,Math.min(rect.left,innerWidth-menu.offsetWidth-8))+'px',top:top+'px'});}else openStyles.delete(c);});
  for(const key of ['title','subtitle']){
    const label=document.createElement('label');label.textContent=key==='title'?'Title':'Subtitle';const input=document.createElement('input');input.value=c[key]||'';input.placeholder='Optional';input.onchange=()=>{c[key]=input.value;onChange();};label.append(input);menu.append(label);
  }
  const settings=scatterStyle(c);
  const set=(key,value)=>{(c.scatterStyle||={})[key]=value;openStyles.add(c);onChange();};
  for(const [key,title,options] of [
    ['size','Point size',[[.25,'Tiny'],[.5,'Small'],[1,'Medium'],[2,'Large'],[4,'Extra large']]],
    ['opacity','Opacity',[[.1,'10%'],[.25,'25%'],[.5,'50%'],[.75,'75%'],[1,'100%']]]
  ]){
    const label=document.createElement('label');label.append(Object.assign(document.createElement('span'),{textContent:title}));
    const input=document.createElement('select');for(const [value,text] of options)input.append(Object.assign(document.createElement('option'),{value:String(value),textContent:text,selected:settings[key]===value}));
    input.onchange=()=>set(key,Number(input.value));label.append(input);menu.append(label);
  }
  const colorLabel=document.createElement('label');colorLabel.append(Object.assign(document.createElement('span'),{textContent:'Point color'}));
  const color=document.createElement('input');color.type='color';color.value=settings.color||'#3275db';color.disabled=!!c.color;color.title=c.color?'Colors are controlled by the selected data column':'Color for all points';color.onchange=()=>set('color',color.value);colorLabel.append(color);menu.append(colorLabel);
  for(const [key,title] of [['outline','Point outlines'],['grid','Gridlines'],['legend','Show legends']]){
    const label=document.createElement('label');label.append(Object.assign(document.createElement('span'),{textContent:title}));const input=document.createElement('input');input.type='checkbox';input.checked=settings[key];input.onchange=()=>set(key,input.checked);label.append(input);menu.append(label);
  }
  const legends=document.createElement('fieldset'),legendTitle=document.createElement('legend');legendTitle.textContent='Individual legends';legends.append(legendTitle);
  for(const key of ['color','shape','size','brightness']){
    if(!c[key])continue;
    const label=document.createElement('label'),input=document.createElement('input');
    label.append(Object.assign(document.createElement('span'),{textContent:key[0].toUpperCase()+key.slice(1)+' legend'}));
    input.type='checkbox';input.checked=c.scatterStyle?.legends?.[key]!==false;input.disabled=!settings.legend;
    input.onchange=()=>set('legends',{...c.scatterStyle?.legends,[key]:input.checked});label.append(input);legends.append(label);
  }
  if(legends.children.length>1)menu.append(legends);
  mappingControls(menu,c,scatterData(c,res,isNumeric,format),palette,()=>{openStyles.add(c);onChange();});
  const reset=document.createElement('button');reset.type='button';reset.textContent='Reset appearance';reset.onclick=()=>{delete c.scatterStyle;openStyles.add(c);onChange();};menu.append(reset);
  // Group field pickers without changing their labels or event handlers.
  const fields=[...bar.children].filter(node=>node.tagName==='LABEL');
  bar.classList.add('scatter-settings-fields');
  for(const [title,items] of [['Axes',fields.slice(0,3)],['Point encoding',fields.slice(3)]]){
    const group=document.createElement('section');group.className='scatter-setting-group';
    const heading=document.createElement('div');heading.className='scatter-setting-heading';heading.textContent=title;group.append(heading);
    const grid=document.createElement('div');grid.className='scatter-setting-grid';grid.append(...items);group.append(grid);bar.append(group);
  }
  const appearance=document.createElement('div');appearance.className='scatter-setting-appearance';appearance.append(style);bar.append(appearance);


}

// Vega-Lite has no independent lightness channel. Apply it to the compiled point
// fill, keeping the color scale (hue), shape and size mappings intact.
export function applyScatterBrightness(spec,c,d){
  if(c.type!=='scatter'||!c.brightness)return spec;
  const values=d.values.map(r=>r.brightness).filter(Number.isFinite);
  const m=resolveMapping(c,d,'brightness'),[low,high]=m.domain,[a,b]=m.range.map(v=>v/100);
  const light=high===low?String((a+b)/2):`${a} + (${b-a}) * clamp((datum.brightness - (${low})) / (${high-low}), 0, 1)`;
  function patch(marks){for(const mark of marks||[]){
    if(mark.type==='symbol'&&mark.encode?.update?.fill){
      const fill=mark.encode.update.fill;
      const base=fill.signal|| (fill.scale?`scale(${JSON.stringify(fill.scale)}, datum[${JSON.stringify(fill.field)}])`:JSON.stringify(fill.value));
      const hsl=`hsl(${base})`;
      mark.encode.update.fill={signal:`hsl(isFinite(${hsl}.h) ? ${hsl}.h : 0, isFinite(${hsl}.s) ? ${hsl}.s : 0, isValid(datum.brightness) ? (${light}) : 0.5)`};
      // Brightness defaults to opaque; an explicit appearance opacity remains respected.
      mark.encode.update.opacity={value:scatterStyle(c).opacity};
    }
    patch(mark.marks);
  }}
  patch(spec.marks);
  if(values.length&&scatterLegendVisible(c,'brightness')){
    spec.scales||=[];spec.scales.push({name:'studioBrightness',type:'linear',domain:[low,high],range:m.range.map(v=>{const hex=Math.round(v/100*255).toString(16).padStart(2,'0');return '#'+hex.repeat(3);}),zero:false});
    spec.legends||=[];spec.legends.push({fill:'studioBrightness',type:'gradient',title:c.brightness+' · Brightness',orient:'top',direction:'horizontal'});
  }
  return spec;
}

// Hover decoration is screen-only: exported charts retain their normal appearance.
export function applyScatterInteraction(spec,outline){
  const events=[];
  function patch(marks){for(const mark of marks||[]){
    if(mark.type==='symbol'&&mark.interactive!==false&&mark.name&&mark.encode?.update){
      events.push({events:`@${mark.name}:pointerover`,update:spec.signals?.some(s=>s.name==='studioPanAnchor')?'studioPanAnchor ? null : datum':'datum'},{events:`@${mark.name}:pointerout`,update:'null'});
      const update=mark.encode.update,normal=update.opacity?.value??.75;
      const normalStroke=update.stroke?.value||'transparent',normalWidth=update.strokeWidth?.value||0;
      const selected='studioHovered && datum.rowNumber === studioHovered.rowNumber';
      update.stroke={signal:`${selected} ? ${JSON.stringify(outline||'#222')} : ${JSON.stringify(normalStroke)}`};
      update.strokeWidth={signal:`${selected} ? ${Math.max(3,normalWidth+2)} : ${normalWidth}`};
      update.opacity={signal:`!studioHovered || (${selected}) ? ${normal} : ${Math.min(normal,.22)}`};
      update.zindex={signal:`${selected} ? 1 : 0`};
    }
    patch(mark.marks);
  }}
  patch(spec.marks);spec.signals||=[];spec.signals.push({name:'studioHovered',value:null,on:events});return spec;
}
