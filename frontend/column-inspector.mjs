import {profileColumn} from './column-profile.mjs';
import {sqlValues} from './table-copy.mjs';
const element=(tag,className,text)=>{const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;};
const number=value=>value==null?'—':Number.isFinite(value)?value.toLocaleString(undefined,{maximumSignificantDigits:7}):'—';
const percent=(n,total)=>total?(100*n/total).toFixed(1)+'%':'—';
let contextMenu=null,closeMenu=()=>{};
export function wireColumnInspector(header,options){
 header.title=[header.title,'Right-click to inspect column'].filter(Boolean).join(' · ');if(!header.querySelector('button'))header.tabIndex=0;
 const show=e=>{
  e.preventDefault();e.stopPropagation();closeMenu();
  const menu=element('div','column-context-menu');menu.setAttribute('role','menu');menu.setAttribute('aria-label','Column actions');
  const item=element('button','','Inspect column…');item.type='button';item.setAttribute('role','menuitem');menu.append(item);document.body.append(menu);contextMenu=menu;
  const box=header.getBoundingClientRect(),x=e.type==='contextmenu'?e.clientX:box.left,y=e.type==='contextmenu'?e.clientY:box.bottom;
  menu.style.left=Math.max(8,Math.min(innerWidth-menu.offsetWidth-8,x))+'px';menu.style.top=Math.max(8,Math.min(innerHeight-menu.offsetHeight-8,y))+'px';
  const outside=event=>{if(!menu.contains(event.target))closeMenu();};
  closeMenu=()=>{menu.remove();document.removeEventListener('pointerdown',outside,true);if(contextMenu===menu)contextMenu=null;};
  document.addEventListener('pointerdown',outside,true);menu.onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeMenu();header.querySelector('button')?.focus();}if(event.key==='Tab')closeMenu();};
  item.onclick=()=>{closeMenu();openInspector(options);};item.focus();
 };
 header.addEventListener('contextmenu',show);header.addEventListener('keydown',e=>{if(e.key==='ContextMenu'||e.shiftKey&&e.key==='F10')show(e);});
}
function openInspector({name,getValues,kind='text',scope,getCopyFormat=()=> 'standard',getIncludeHeaders=()=>true}){
 const values=getValues(),profile=profileColumn(values,kind),dialog=element('dialog','column-inspector');dialog.setAttribute('aria-label','Inspect column '+name);
 const header=element('header','column-inspector-head'),titles=element('div'),close=element('button','','×');close.type='button';close.setAttribute('aria-label','Close column inspection');close.onclick=()=>dialog.close();titles.append(element('small','',kind==='number'?'NUMERIC COLUMN':kind==='date'?'DATE COLUMN':'TEXT / CATEGORY COLUMN'),element('h2','',name));header.append(titles,close);
 const body=element('div','column-inspector-body');body.append(element('p','column-inspector-scope',typeof scope==='function'?scope():scope));
 const cards=element('div','column-profile-cards');
 for(const [label,value,detail] of [['Rows',number(profile.total),''],['Missing',number(profile.nulls),percent(profile.nulls,profile.total)+' of rows'],['Distinct',number(profile.distinct),'non-null values'],['Uniqueness',profile.uniqueness==null?'—':percent(profile.distinct,profile.present),'distinct ÷ non-null rows']]){const card=element('div');card.append(element('small','',label),element('strong','',value),element('small','',detail));cards.append(card);}body.append(cards);
 const date=value=>value==null?'—':new Date(value).toISOString();
 if(kind!=='text'){
  const metrics=element('dl','column-profile-metrics'),fields=kind==='date'?[['Earliest',profile.min],['Latest',profile.max]]:[['Minimum',profile.min],['Q1',profile.q1],['Median',profile.median],['Q3',profile.q3],['Maximum',profile.max],['Average',profile.mean]];
  for(const [label,value] of fields){const pair=element('div');pair.append(element('dt','',label),element('dd','',kind==='date'?date(value):number(value)));metrics.append(pair);}body.append(metrics);
  body.append(element('h3','',kind==='date'?'Timeline':'Distribution'));
  if(profile.bins.length){
   const chart=element('div','column-profile-histogram');chart.setAttribute('role','img');chart.setAttribute('aria-label',(kind==='date'?'Timeline':'Histogram')+' of '+profile.valid+' values');const max=Math.max(...profile.bins.map(b=>b.count));
   for(const bin of profile.bins){const bar=element('div','column-profile-bin');bar.style.height=Math.max(1,bin.count/max*100)+'%';bar.title=`${kind==='date'?date(bin.start):number(bin.start)} – ${kind==='date'?date(bin.end):number(bin.end)}: ${bin.count} rows`;bar.setAttribute('aria-label',bar.title);bar.tabIndex=0;chart.append(bar);}body.append(chart);
   const axis=element('div','column-profile-axis');axis.append(element('span','',kind==='date'?date(profile.min):number(profile.min)),element('span','',kind==='date'?date(profile.max):number(profile.max)));body.append(axis);
  }else body.append(element('p','column-inspector-scope','No valid values to plot.'));
  if(profile.invalid)body.append(element('p','column-inspector-scope',`${profile.invalid} non-null values could not be interpreted and are excluded from the statistics and chart.`));
 }else{
  const issues=element('div','column-profile-text-quality');issues.append(element('span','',`Empty strings: ${number(profile.empty)}`),element('span','',`Whitespace only: ${number(profile.whitespace)}`),element('span','',`Leading / trailing whitespace: ${number(profile.padded)}`));body.append(issues);
 }
 body.append(element('h3','','Values'));
 const search=element('input');search.type='search';search.placeholder='Find values…';search.setAttribute('aria-label','Find column values');body.append(search);
 const table=element('table','column-profile-values'),thead=table.createTHead(),tr=thead.insertRow();for(const name of ['Select','Value','Count','% of rows'])tr.append(element('th','',name));const tbody=table.createTBody();body.append(table);
 const more=element('button','','Show more values');more.type='button';body.append(more);
 const footer=element('footer','column-inspector-footer'),selected=new Map(),summary=element('span','','No values selected'),copy=element('button','','Copy selected values'),status=element('span');status.setAttribute('role','status');copy.type='button';copy.disabled=true;footer.append(summary,status,copy);
 let limit=50;
 const render=()=>{tbody.replaceChildren();const matches=profile.frequencies.filter(item=>String(item.value??'NULL').toLowerCase().includes(search.value.toLowerCase()));
  for(const item of matches.slice(0,limit)){
   const row=tbody.insertRow(),checkbox=element('input');checkbox.type='checkbox';checkbox.checked=selected.has(item.key);checkbox.setAttribute('aria-label','Select value '+String(item.value??'NULL'));row.insertCell().append(checkbox);
   const display=item.value===null?'NULL':item.value===''?'(empty string)':typeof item.value==='string'&&!item.value.trim()?JSON.stringify(item.value):String(item.value);const cell=row.insertCell();cell.textContent=display;cell.title=String(item.value??'NULL');row.insertCell().textContent=number(item.count);row.insertCell().textContent=percent(item.count,profile.total);
   checkbox.onchange=()=>{if(checkbox.checked)selected.set(item.key,item);else selected.delete(item.key);summary.textContent=`${selected.size} values selected`;copy.disabled=!selected.size;status.textContent='';};
  }more.hidden=matches.length<=limit;
 };
 search.oninput=()=>{limit=50;render();};more.onclick=()=>{limit+=50;render();};
 const format=getCopyFormat();copy.title='Copy as '+(format==='standard'?'Standard':format==='sql-distinct'?'SQL values (distinct)':'SQL values');
 copy.onclick=async()=>{
  const chosen=[...selected.values()].map(item=>item.value),mode=getCopyFormat();
  const csv=value=>{if(value==null)return '';const text=String(value);return /[",\n\r]/.test(text)?'"'+text.replaceAll('"','""')+'"':text;};
  const text=mode==='standard'?[...(getIncludeHeaders()?[name]:[]),...chosen].map(csv).join('\n'):sqlValues(chosen.map(value=>[{value,numeric:kind==='number'}]),{distinct:mode==='sql-distinct',headers:getIncludeHeaders()?[name]:null});
  try{await navigator.clipboard.writeText(text);status.textContent='Copied';}catch{status.textContent='Could not copy. Try again.';}
 };
 render();dialog.append(header,body,footer);dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();close.focus();
}
