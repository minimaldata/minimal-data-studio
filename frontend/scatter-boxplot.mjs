// Summaries use the loaded observations, never the current zoom window.
export function boxSettings(c={}){
 const raw=c.boxStatistics||{},range=(a,b,defaults)=>{
  // Each bound can be edited independently; an absent sibling uses its default.
  a=a??defaults[0];b=b??defaults[1];
  return Number.isFinite(a)&&Number.isFinite(b)&&a>=0&&b<=100&&a<b?[a,b]:defaults;
 };
 const box=range(raw.boxLow,raw.boxHigh,[25,75]);
 const whiskers=range(raw.whiskerLow,raw.whiskerHigh,[5,95]);
 return {box,center:raw.center==='mean'?'mean':'median',whiskers:['range','percentile'].includes(raw.whiskers)?raw.whiskers:'iqr',percentiles:[Math.min(whiskers[0],box[0]),Math.max(whiskers[1],box[1])]};
}
export function boxDescription(c){const s=boxSettings(c);return `Box: P${s.box[0]}–P${s.box[1]} · Center: ${s.center} · Whiskers: ${s.whiskers==='range'?'min/max':s.whiskers==='percentile'?`P${s.percentiles[0]}–P${s.percentiles[1]}`:s.box[0]===25&&s.box[1]===75?'1.5×IQR':'1.5× box range'}`;}
export function boxSummaries(points,c={}){
 const settings=boxSettings(c);
 const groups=new Map();
 for(const p of points){if(!Number.isFinite(p.y))continue;if(!groups.has(p.xCategory))groups.set(p.xCategory,[]);groups.get(p.xCategory).push(p.y);}
 const quantile=(a,p)=>{const i=(a.length-1)*p,k=Math.floor(i);return a[k]+(a[Math.min(k+1,a.length-1)]-a[k])*(i-k);};
 return [...groups].map(([category,a])=>{
  a.sort((a,b)=>a-b);
  const q1=quantile(a,.25),median=quantile(a,.5),q3=quantile(a,.75),mean=a.reduce((sum,v)=>sum+v/a.length,0);
  const boxLow=quantile(a,settings.box[0]/100),boxHigh=quantile(a,settings.box[1]/100),span=boxHigh-boxLow;
  let lower=boxLow-1.5*span,upper=boxHigh+1.5*span,low=a.find(v=>v>=lower),high=a.findLast(v=>v<=upper);
  if(settings.whiskers==='range'){lower=low=a[0];upper=high=a.at(-1);}
  if(settings.whiskers==='percentile'){lower=low=quantile(a,settings.percentiles[0]/100);upper=high=quantile(a,settings.percentiles[1]/100);}
  return {category,n:a.length,q1,median,q3,mean,boxLow,boxHigh,center:settings.center==='mean'?mean:median,lower,upper,low,high,outliers:a.filter(v=>v<lower||v>upper).length};
 });
}
export function applyBoxplot(spec,c,d){
 if(!d.categorical||(!c.boxOverlay&&!c.violinOverlay))return spec;
 const color=spec.config?.axis?.titleColor||'#888';
 spec.data.push({name:'studioBoxes',values:d.boxes});
 if(['outliers','none'].includes(c.boxPoints)){
  for(const m of spec.marks.filter(m=>m.type==='symbol')){
   const name='studioOutliers';if(!spec.data.some(s=>s.name===name))spec.data.push({name,source:m.from.data,transform:[{type:'filter',expr:c.boxPoints==='none'?'false':'datum.boxOutlier'}]});m.from={data:name};
  }
 }
 if(c.boxPoints==='none')spec.legends=[];
 const x=delta=>({signal:`scale('x',datum.x + (${delta}))`}),y=field=>({scale:'y',field});
 const settings=boxSettings(c);
 const labels={Category:'category',Observations:'n',[settings.center==='mean'?'Mean':'Median']:'center',[`Box lower (P${settings.box[0]})`]:'boxLow',[`Box upper (P${settings.box[1]})`]:'boxHigh','Lower whisker':'low','Upper whisker':'high',Outliers:'outliers'};
 const tooltip={signal:'{'+Object.entries(labels).map(([label,field])=>JSON.stringify(label)+':datum.'+field).join(',')+','+JSON.stringify('Definition')+':'+JSON.stringify(boxDescription(c))+'}'};
 const mark=(name,type,update)=>({name,type,from:{data:'studioBoxes'},clip:true,encode:{update:{stroke:{value:color},strokeWidth:{value:1.5},tooltip,...update}}});
 const marks=c.boxOverlay?(c.violinOverlay? [
 mark('studioBoxWhiskers','rule',{x:x(0),y:y('low'),y2:y('high'),strokeWidth:{value:1}}),
 mark('studioBoxInner','rule',{x:x(0),y:y('boxLow'),y2:y('boxHigh'),strokeWidth:{value:6},strokeCap:{value:'round'}}),
 // A rounded rect keeps the summary dot separate from individual-point interactions.
 mark('studioBoxCenter','rect',{x:{signal:"scale('x',datum.x)-3"},y:{signal:"scale('y',datum.center)-3"},width:{value:6},height:{value:6},cornerRadius:{value:3},fill:{value:spec.background||'#fff'},strokeWidth:{value:1}})
 ]:[mark('studioBoxWhiskers','rule',{x:x(0),y:y('low'),y2:y('high')}),
 mark('studioBoxLower','rule',{x:x(-.12),x2:x(.12),y:y('low')}),mark('studioBoxUpper','rule',{x:x(-.12),x2:x(.12),y:y('high')}),
 mark('studioBoxBody','rect',{x:x(-.22),x2:x(.22),y:y('boxHigh'),y2:y('boxLow'),fill:{value:color},fillOpacity:{value:.12}}),
 mark('studioBoxMedian','rule',{x:x(-.22),x2:x(.22),y:y('center'),strokeWidth:{value:3}})]):[];
 if(c.boxCounts!==false)marks.push(mark('studioBoxCounts','text',{x:x(0),y:{value:5},text:{signal:"'n=' + datum.n"},align:{value:'center'},baseline:{value:'top'},fill:{value:color},stroke:{value:null},fontSize:{value:11}}));
 // Draw summaries over observations so dense point clouds cannot obscure them.
 spec.marks.push(...marks);return spec;
}

export function boxStatisticControls(bar,c,select,onChange){
 const s=boxSettings(c),set=(key,value)=>{(c.boxStatistics||={})[key]=value;};
 select(c.violinOverlay?'Center dot':'Center line',s.center,[['median','Median'],['mean','Mean']],v=>set('center',v));
 select('Whiskers',s.whiskers,[['iqr',s.box[0]===25&&s.box[1]===75?'1.5× IQR':'1.5× box range'],['range','Minimum / maximum'],['percentile','Percentiles']],v=>set('whiskers',v));
 const field=(title,key,value,min,max)=>{
  const label=document.createElement('label'),input=document.createElement('input');label.append(document.createTextNode(title));
  input.type='number';input.min=String(min);input.max=String(max);input.step='0.1';input.value=String(value);input.style.width='90px';
  input.onchange=()=>{if(!input.checkValidity()||input.value===''){input.reportValidity();return;}set(key,Number(input.value));onChange();};label.append(input);bar.append(label);
 };
 field('Box lower percentile','boxLow',s.box[0],0,s.box[1]-.1);
 field('Box upper percentile','boxHigh',s.box[1],s.box[0]+.1,100);
 if(s.whiskers==='percentile'){
  field('Whisker lower percentile','whiskerLow',s.percentiles[0],0,Math.min(s.box[0],s.percentiles[1]-.1));
  field('Whisker upper percentile','whiskerHigh',s.percentiles[1],Math.max(s.box[1],s.percentiles[0]+.1),100);
 }
}
