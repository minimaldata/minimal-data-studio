import {startTableSelectionScroll} from './table-selection-scroll.mjs';
import {mountChartSelection} from './calculator-chart-selection.mjs';
import {mountCalculatorExpression} from './calculator-expression.mjs';
import {calculate,numericValue,selectionStats,cleanCalculatorState,formatCalculatorNumber,formatCalculatorSummary} from './calculator-core.mjs';
const cells=new WeakMap();let active=null;
export function calculatorCell(cell,value,label,numeric=true){cells.set(cell,{raw:value,value:numericValue(value,numeric),label});}
export function calculatorPicking(){return !!active?.enabled;}
export function calculatorSelecting(){return !!(active?.enabled||active?.minimized);}
export function calculatorTableSelection(nodes){active?.selectTable([...nodes].filter(cell=>cells.has(cell)).map(cell=>cells.get(cell)));}
export function calculatorColumnsSelection(rows,columns,insert=false){active?.selectColumn(rows.flatMap(row=>columns.map(({index,label,numeric})=>({raw:row[index],value:numericValue(row[index],numeric),label}))),insert);}
export function calculatorColumnSelection(values,label,numeric,insert=false){active?.selectColumn(values.map(raw=>({raw,value:numericValue(raw,numeric),label})),insert);}
export function calculatorChart(view,plot,config,data,getLabel,getPins=()=>new Set()){
 const events=new AbortController();let start=null,moved=false,frame=0,lastHover=null,previewResult=null,previewPoint=null,pressedResult=null,lastClick=null,consumedClick=false;
 plot.classList.add('calculator-chart');
 const modifierCursor=e=>{
  plot.classList.toggle('calculator-shift-select',calculatorSelecting()&&e.shiftKey);
  plot.classList.toggle('calculator-add-region',calculatorSelecting()&&e.shiftKey&&(e.metaKey||e.ctrlKey));
  plot.classList.toggle('calculator-multi-select',calculatorSelecting()&&(e.metaKey||e.ctrlKey)&&!e.shiftKey);
  if(e.type.startsWith('key')&&lastHover)hover({...lastHover.event,metaKey:e.metaKey,ctrlKey:e.ctrlKey,shiftKey:e.shiftKey},lastHover.item);
 };
 const resetModifiers=()=>plot.classList.remove('calculator-shift-select','calculator-multi-select','calculator-remove-pick','calculator-add-region');
 document.addEventListener('keydown',modifierCursor,{signal:events.signal});document.addEventListener('keyup',modifierCursor,{signal:events.signal});plot.addEventListener('pointermove',modifierCursor,{signal:events.signal});window.addEventListener('blur',()=>{resetModifiers();clearPreview();},{signal:events.signal});document.addEventListener('calculator-mode-change',resetModifiers,{signal:events.signal});
 const tip=document.createElement('div');tip.className='calculator-chart-preview';tip.setAttribute('role','tooltip');tip.hidden=true;document.body.append(tip);
 const clearPreview=()=>{cancelAnimationFrame(frame);frame=0;lastHover=null;previewPoint=null;tip.hidden=true;plot.classList.remove('calculator-can-pick','calculator-remove-pick');document.body.classList.remove('calculator-chart-hover');};
 const groups=new Map();if(config.type!=='scatter')for(const row of data.values){if(!groups.has(row.xk))groups.set(row.xk,[]);if(Number.isFinite(row.value))groups.get(row.xk).push(row);}

 const chartSelection=mountChartSelection({view,plot,config,data,pins:getPins,enabled:calculatorSelecting,onStart:()=>{consumedClick=true;start=null;pressedResult=null;clearPreview();},onChange:items=>active?.selectChart(chartSelection,items)});
 plot.addEventListener('pointerdown',e=>{consumedClick=false;pressedResult=previewPoint&&Math.hypot(previewPoint.clientX-e.clientX,previewPoint.clientY-e.clientY)<5?previewResult:null;clearPreview();start={x:e.clientX,y:e.clientY,multi:e.metaKey||e.ctrlKey};moved=plot.classList.contains('is-box-zoom');},{capture:true,signal:events.signal});
 plot.addEventListener('pointermove',e=>{if(start&&e.buttons&&Math.hypot(e.clientX-start.x,e.clientY-start.y)>4)moved=true;},{capture:true,signal:events.signal});
 plot.addEventListener('pointercancel',()=>{start=null;moved=true;},{signal:events.signal});
 const finalize=view.finalize.bind(view);view.finalize=()=>{active?.releaseChart(chartSelection);chartSelection.dispose();clearPreview();tip.remove();events.abort();return finalize();};
 const resolve=(event,item)=>{
  let row=item?.datum;
  if(config.type==='line'){
   const surface=plot.querySelector('.studioPanSurface path')?.getBoundingClientRect(),svg=plot.querySelector('svg')?.getBoundingClientRect(),origin=view.origin();
   const box=surface||(svg?{left:svg.left+origin[0],top:svg.top+origin[1],width:view.width(),height:view.height()}:null);
   if(!box||event.clientX<box.left||event.clientX>box.left+box.width||event.clientY<box.top||event.clientY>box.top+box.height)return;
   const xs=view.scale('x'),ys=view.scale('y'),x=(event.clientX-box.left)*view.width()/box.width,y=(event.clientY-box.top)*view.height()/box.height;
   const position=r=>xs(data.time&&!data.overlay?r.x:r.xk)+(xs.bandwidth?.()||0)/2;
   const pins=getPins(),hit=item?.mark?.marktype==='line'?(Array.isArray(row)?row[0]?.series:row?.series):null;
   const candidates=data.values.filter(r=>Number.isFinite(r.value)&&position(r)>=0&&position(r)<=view.width()&&(pins.size?pins.has(r.series):hit==null||r.series===hit));
   const nearest=candidates.reduce((best,r)=>!best||Math.abs(position(r)-x)<Math.abs(position(best)-x)?r:best,null);
   row=nearest&&candidates.filter(r=>r.xk===nearest.xk).reduce((best,r)=>!best||Math.abs(ys(r.value)-y)<Math.abs(ys(best.value)-y)?r:best,null);
  }else if(Array.isArray(row))return;
  if(!row)return;
  const isScatter=config.type==='scatter';let value=isScatter?row.y:row.value;
  if(!Number.isFinite(value))return;
  const pins=getPins();const group=groups.get(row.xk)||[];
  const combined=!isScatter&&pins.size>1&&!event.metaKey&&!event.ctrlKey;
  if(combined){const selected=group.filter(r=>pins.has(r.series));if(config.type==='line'&&new Set(selected.map(r=>r.series)).size!==pins.size){return {row,error:'Some selected lines have no value here. Choose another point.'};}value=selected.reduce((sum,r)=>sum+r.value,0);}
  let label=[getLabel?.(),combined?`${pins.size} selected series`:row.series,row.xl??row.xCategory].filter(Boolean).join(' · ');
  if(config.type==='percent'){
   const total=group.reduce((n,r)=>n+r.value,0);
   if(total<=0||group.some(r=>r.value<0)){return {error:'Cannot pick a percentage from this stack.'};}
   value=value/total;label+=' · share';
  }
  return {row,value,label:label||config.y?.[0]||'Chart value',detail:config.type==='percent'?'Displayed share (0–1; multiply by 100 for percentage points)':'Displayed chart value'};
 };
 const pick=(event,item)=>{
  if((!calculatorPicking()&&!(calculatorSelecting()&&(event.metaKey||event.ctrlKey||start?.multi)))||moved||consumedClick||event===lastClick||plot.classList.contains('is-box-zoom'))return;
  const result=pressedResult||resolve(event,item);if(!result)return;if(result.error&&!(result.row&&(event.metaKey||event.ctrlKey||start?.multi))){active.message(result.error);return;}
  lastClick=event;consumedClick=true;pressedResult=null;clearPreview();if(event.metaKey||event.ctrlKey||start?.multi){chartSelection.toggle(result.row);return;}active.capture([{value:result.value,label:result.label}],result.detail);
  const flash=document.createElement('span');flash.className='calculator-capture-flash';flash.style.left=event.clientX+'px';flash.style.top=event.clientY+'px';document.body.append(flash);flash.addEventListener('animationend',()=>flash.remove(),{once:true});setTimeout(()=>flash.remove(),700);
 };
 const hover=(event,item)=>{
  if((!calculatorPicking()&&!(calculatorSelecting()&&(event.metaKey||event.ctrlKey||event.shiftKey)))||chartSelection.selecting||event.buttons||plot.classList.contains('is-box-zoom')||plot.classList.contains('is-panning')){clearPreview();return;}
  lastHover={event:{clientX:event.clientX,clientY:event.clientY,metaKey:event.metaKey,ctrlKey:event.ctrlKey,shiftKey:event.shiftKey},item};if(frame)return;
  frame=requestAnimationFrame(()=>{frame=0;const h=lastHover;if(!h)return;const result=resolve(h.event,h.item);previewResult=result;previewPoint=h.event;if(!result){clearPreview();return;}
   tip.replaceChildren();const value=document.createElement('strong'),label=document.createElement('span');const multi=h.event.metaKey||h.event.ctrlKey,removing=multi&&chartSelection.has(result.row);plot.classList.toggle('calculator-remove-pick',!!removing);value.textContent=h.event.shiftKey?(multi?'Drag to add to selection':'Drag to replace selection'):result.error||(multi?`${removing?'Remove':'Add'} ${result.value} ${removing?'from':'to'} selection`:`Add ${result.value} to calculator`);label.textContent=result.error?'':result.label;tip.append(value,label);const help=document.createElement('small');help.textContent='⌘/Ctrl-click to select · Shift-drag for a region';tip.append(help);
   if(config.type==='percent'&&!result.error){const note=document.createElement('small');note.textContent='Share as a fraction (0–1)';tip.append(note);}
   tip.hidden=false;plot.classList.toggle('calculator-can-pick',!result.error);document.body.classList.add('calculator-chart-hover');const box=tip.getBoundingClientRect();tip.style.left=Math.max(8,Math.min(innerWidth-box.width-8,h.event.clientX+16))+'px';tip.style.top=Math.max(8,Math.min(innerHeight-box.height-8,h.event.clientY+16))+'px';
  });
 };
 view.addEventListener('pointermove',hover);
 plot.addEventListener('pointerleave',clearPreview,{signal:events.signal});
 for(const type of ['calculator-mode-change','scroll'])document.addEventListener(type,clearPreview,{capture:true,signal:events.signal});
 window.addEventListener('resize',clearPreview,{signal:events.signal});
 document.addEventListener('pointerup',e=>{if(start&&pressedResult&&Math.hypot(e.clientX-start.x,e.clientY-start.y)<4)pick(e,null);start=null;},{capture:true,signal:events.signal});
 view.addEventListener('click',pick);
 // A zoomed chart captures the pointer on its host for panning. A stationary
 // click still picks a line observation even when Vega receives no mark event.
 plot.addEventListener('click',e=>{if(pressedResult||e.target===plot&&config.type==='line')pick(e,null);},{signal:events.signal});
}
export function mountCalculator({save,label=()=> 'Result',statsHost}){
 let dirty=false;let state=cleanCalculatorState(null),selection=[],selected=new Set(),anchor=null,drag=null,suppressClick=false,timer=null,ready=false,selectionRefs=null,selectionPending=false,chartOwner=null,aggregation='sum',capturing=false;
 const launcher=document.createElement('button');launcher.className='calculator-launcher';launcher.setAttribute('aria-label','Calculator');launcher.title='Calculator (⌥C)';launcher.innerHTML='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><rect x="5" y="2.5" width="14" height="19" rx="2"/><path d="M8 6h8v4H8zM8 14h1m6 0h1m-8 4h1m6 0h1"/></svg>';document.body.append(launcher);
 const panel=document.createElement('section');panel.className='calculator-panel';panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-label','Scratch calculator');
 panel.innerHTML=`<header><strong>Calculator</strong><span><button type="button" aria-label="Close calculator">×</button></span></header><div class="calculator-body"><details class="calculator-help"><summary>How to use</summary><p class="calculator-hint">Select table cells or click a chart to add values. ⌘/Ctrl-drag adds table blocks, or removes them when starting on a selected cell. ⌘/Ctrl-click toggles chart values; Shift-drag selects a region. Selection statistics stay available in the results toolbar when the calculator is closed.</p></details><div class="calculator-selection" hidden><output></output><div class="calculator-aggregation" role="group" aria-label="Selection calculation"></div></div><div class="calculator-expression" contenteditable="true" role="textbox" aria-label="Calculation" aria-multiline="false" data-placeholder="Type a calculation…" spellcheck="false"></div><output class="calculator-answer" aria-live="polite"></output><div class="calculator-operators" role="group" aria-label="Calculation operators"></div><details class="calculator-rounding"><summary>Rounding</summary><label>Input decimals <select aria-label="Input decimals"></select></label><label>Result decimals <select aria-label="Result decimals"></select></label><small>Display only. Calculations keep full precision.</small></details><div class="calculator-source" hidden></div><div class="calculator-equation-actions"><button type="button" data-action="calculate" title="Save this result to history (Enter)">Save to history</button><button type="button" data-action="clear">Clear expression</button><button type="button" data-action="copy">Copy</button></div><p class="calculator-status" role="status"></p><details><summary>Saved values</summary><button type="button" class="calculator-clear-list" data-action="clear-values">Clear saved values</button><div class="calculator-snapshots"></div></details><details><summary>History</summary><button type="button" class="calculator-clear-list" data-action="clear-history">Clear history</button><div class="calculator-history"></div></details></div>`;
 let statistic='sum';const names={sum:'Sum',average:'Avg',median:'Median',nonNullCount:'Count',distinctCount:'Count distinct',min:'Min',max:'Max'};
 const readout=document.createElement('button');readout.type='button';readout.className='calculator-readout';readout.setAttribute('aria-label','Selection statistic');statsHost?.append(readout);
 const statToggle=document.createElement('button');statToggle.type='button';statToggle.className='calculator-stat-toggle';statToggle.textContent='▾';statToggle.setAttribute('aria-label','Change selection statistic');statToggle.setAttribute('aria-haspopup','menu');statToggle.setAttribute('aria-expanded','false');statToggle.title='Change statistic';statsHost?.append(statToggle);
 let statisticValue=null;
 const copyTimers=new WeakMap();
 const copyValue=async(value,element)=>{
  if(!Number.isFinite(value))return;
  clearTimeout(copyTimers.get(element));
  try{await navigator.clipboard.writeText(String(value));element.dataset.copyStatus='Copied';}
  catch{element.dataset.copyStatus='Copy failed';}
  copyTimers.set(element,setTimeout(()=>{delete element.dataset.copyStatus;},1800));
 };
 const toolbarOpen=document.createElement('button');toolbarOpen.type='button';toolbarOpen.className='calculator-toolbar-open';toolbarOpen.setAttribute('aria-label','Open calculator');toolbarOpen.title='Open calculator';toolbarOpen.innerHTML=launcher.innerHTML;toolbarOpen.onclick=()=>panel.hidden?open():close();statsHost?.append(toolbarOpen);
 const statMenu=document.createElement('div');statMenu.className='calculator-stat-menu';statMenu.setAttribute('role','menu');statMenu.setAttribute('aria-label','Choose selection statistic');statMenu.hidden=true;document.body.append(statMenu);
 const closeStats=()=>{statMenu.hidden=true;statToggle.setAttribute('aria-expanded','false');};
 for(const [kind,name] of Object.entries(names)){const b=document.createElement('button');b.type='button';b.setAttribute('role','menuitemradio');b.textContent=name;b.dataset.stat=kind;b.onclick=()=>{statistic=kind;delete readout.dataset.copyStatus;syncAggregation();closeStats();statToggle.focus();};statMenu.append(b);}
 readout.onclick=()=>copyValue(statisticValue,readout);
 statToggle.onclick=()=>{if(!statMenu.hidden){closeStats();return;}statMenu.hidden=false;statToggle.setAttribute('aria-expanded','true');const box=readout.getBoundingClientRect();statMenu.style.left=Math.max(8,Math.min(innerWidth-statMenu.offsetWidth-8,box.left))+'px';statMenu.style.top=(box.bottom+statMenu.offsetHeight<innerHeight?box.bottom+4:box.top-statMenu.offsetHeight-4)+'px';statMenu.querySelector(`[data-stat="${statistic}"]`).focus();};
 document.addEventListener('pointerdown',e=>{if(!readout.contains(e.target)&&!statToggle.contains(e.target)&&!statMenu.contains(e.target))closeStats();});
 statMenu.onkeydown=e=>{if(e.key==='Escape'){e.stopPropagation();closeStats();statToggle.focus();}else if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const items=[...statMenu.children],i=items.indexOf(document.activeElement);items[e.key==='Home'?0:e.key==='End'?items.length-1:(i+(e.key==='ArrowDown'?1:-1)+items.length)%items.length].focus();}};
 window.addEventListener('resize',closeStats);document.addEventListener('scroll',closeStats,true);
 document.body.append(panel);const source=panel.querySelector('.calculator-source');const input=mountCalculatorExpression(panel.querySelector('.calculator-expression'),{snapshots:()=>state.snapshots,format:value=>formatCalculatorNumber(value,state.inputDecimals),inspect:s=>{source.replaceChildren();source.hidden=false;const title=document.createElement('strong'),detail=document.createElement('p'),close=document.createElement('button');title.textContent=s.label;detail.textContent=`${s.detail} · Captured ${new Date(s.time).toLocaleString()}. ${(selectionRefs?.match(/\$\d+/g)||[]).includes(s.id)?'Linked to the current selection.':'This value stays fixed.'}`;close.textContent='Close source';close.onclick=()=>{source.hidden=true;input.focus();};source.append(title,detail,close);}});const status=panel.querySelector('.calculator-status'),answer=panel.querySelector('.calculator-answer'),area=panel.querySelector('.calculator-selection'),summary=area.querySelector('output');
 const button=action=>panel.querySelector(`[data-action="${action}"]`);
 const message=text=>{status.textContent=text;};
 const flush=async()=>{clearTimeout(timer);timer=null;if(!dirty)return true;const version=JSON.stringify(state);try{const ok=await save(structuredClone(state));if(ok&&version===JSON.stringify(state))dirty=false;message(ok?'Saved to project':'Not saved. This window is read-only or has a saved-work conflict.');return ok;}catch(e){message('Not saved: '+e.message);return false;}};
 const updateAnswer=()=>{
  answer.classList.remove('calculator-answer-error');answer.setAttribute('aria-disabled','true');answer.tabIndex=-1;
  if(!input.value.trim()){answer.textContent='';button('calculate').disabled=true;return null;}
  try{const result=calculate(input.value.replaceAll('×','*').replaceAll('÷','/'),state.snapshots);answer.textContent='= '+formatCalculatorNumber(result,state.resultDecimals);button('calculate').disabled=false;answer.setAttribute('aria-disabled','false');answer.tabIndex=0;return result;}
  catch(e){button('calculate').disabled=true;const incomplete=['Enter a number, snapshot, or parentheses.','Close the parentheses.'].includes(e.message);answer.textContent=incomplete?'':e.message;answer.classList.toggle('calculator-answer-error',!incomplete);return null;}
 };
 answer.setAttribute('role','button');answer.title='Copy full-precision result';answer.onclick=()=>copyValue(updateAnswer(),answer);answer.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();answer.click();}};
 const changed=()=>{updateAnswer();state.expression=input.value;source.hidden=true;dirty=true;message('Saving…');clearTimeout(timer);timer=setTimeout(flush,250);};
 window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
 const insert=text=>{input.insertValue(text);};
 for(const [symbol,name] of [['+','Add'],['-','Subtract'],['×','Multiply'],['÷','Divide'],['^','Power'],['%','Percent'],['(','Open parenthesis'],[')','Close parenthesis'],['wrap','Wrap selection in parentheses']]){
  const b=document.createElement('button');b.type='button';b.textContent=symbol==='wrap'?'( … )':symbol==='-'?'−':symbol;b.setAttribute('aria-label',name);b.title=name;b.onpointerdown=e=>e.preventDefault();b.onclick=()=>input.operator(symbol);panel.querySelector('.calculator-operators').append(b);
 }
 for(const [name,key] of [['Input decimals','inputDecimals'],['Result decimals','resultDecimals']]){
  const select=panel.querySelector(`[aria-label="${name}"]`);select.add(new Option('Auto','auto'));for(let n=0;n<=8;n++)select.add(new Option(String(n),String(n)));
  select.onchange=()=>{state[key]=select.value==='auto'?null:Number(select.value);input.refreshValues();syncAggregation();changed();};
 }
 const readable=expression=>expression.replace(/\$\d+/g,id=>String(state.snapshots.find(s=>s.id===id)?.value??id));
 const render=()=>{
  button('clear-values').disabled=!state.snapshots.length;button('clear-history').disabled=!state.history.length;
  const snapshots=panel.querySelector('.calculator-snapshots');snapshots.replaceChildren();for(const s of state.snapshots){const b=document.createElement('button');b.type='button';b.textContent=`${s.value} · ${s.label}`;b.title=`${s.detail}\nCaptured ${s.time}`;b.onclick=()=>insert(s.id);snapshots.append(b);}
  const history=panel.querySelector('.calculator-history');history.replaceChildren();for(const h of [...state.history].reverse()){const b=document.createElement('button');b.type='button';b.textContent=`${readable(h.expression)} = ${h.result}`;b.title='Use this result';b.onclick=()=>capture([{value:h.result,label:'Previous result'}],readable(h.expression));history.append(b);}
  if(!state.snapshots.length)snapshots.textContent='No saved values.';if(!state.history.length)history.textContent='No history yet.';
 };
 const syncLinkedValue=()=>{input.setLinkedRefs(selectionRefs);area.classList.toggle('has-live-selection',!!selectionRefs);};
 const releaseChart=owner=>{if(owner&&chartOwner!==owner)return;chartOwner?.reset(false);chartOwner=null;selectionRefs=null;syncLinkedValue();area.hidden=true;};
 const finishSelection=()=>{chartOwner?.reset(false);chartOwner=null;selectionRefs=null;syncLinkedValue();selected.forEach(c=>c.classList.remove('calculator-selected'));selected.clear();anchor=null;selectionPending=false;if(selection.length&&!area.hidden&&summary.querySelector('strong'))summary.querySelector('strong').textContent=`${selection.length.toLocaleString()} captured`;};
 const capture=(...args)=>{const previous=capturing;capturing=true;try{return captureValues(...args);}finally{capturing=previous;}};
 const captureValues=(items,detail,{replace=null,keepSelection=false}={})=>{
  if(!keepSelection)releaseChart();
  const valid=items.filter(i=>Number.isFinite(i.value));if(!valid.length){message('No numeric values selected.');return;}
  if(valid.length>100){message('Select at most 100 individual values, or choose an aggregate.');return;}
  // An active selection is one editable operand. Once reused or saved to history,
  // retain that snapshot and give the next selection result its own identity.
  const reusable=valid.length===1&&/^\$\d+$/.test(replace||'')&&input.value.match(/\$\d+/g)?.filter(id=>id===replace).length===1&&!state.history.some(h=>(h.expression.match(/\$\d+/g)||[]).includes(replace))?state.snapshots.find(s=>s.id===replace):null;
  if(reusable){Object.assign(reusable,{value:valid[0].value,label:valid[0].label.slice(0,300),detail,time:new Date().toISOString()});input.refreshValues();changed();render();input.focus();return replace;}
  let id=state.snapshots.reduce((max,s)=>Math.max(max,Number(s.id.slice(1))),0);const refs=[];
  for(const item of valid){const snapshot={id:'$'+ ++id,value:item.value,label:item.label.slice(0,300),detail,time:new Date().toISOString()};state.snapshots.push(snapshot);refs.push(snapshot.id);}
  const text=refs.join(' + '),pattern=replace?new RegExp(replace.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?!\\d)'):null;
  if(pattern&&pattern.test(input.value)){input.value=input.value.replace(pattern,()=>text);answer.textContent='';changed();input.focus();}else insert(text);
  for(const chip of panel.querySelectorAll('.calculator-value-chip'))if(refs.includes(chip.dataset.snapshot)){chip.classList.add('calculator-just-added');chip.addEventListener('animationend',()=>chip.classList.remove('calculator-just-added'),{once:true});}
  render();if(!keepSelection){area.hidden=true;selectionRefs=null;}message('Value added. Click its chip to see the source.');return text;
 };
 const setEnabled=enabled=>{active.enabled=enabled;active.minimized=!enabled;toolbarOpen.setAttribute('aria-expanded',String(enabled));toolbarOpen.title=enabled?'Close calculator':'Open calculator';launcher.setAttribute('aria-expanded',String(enabled));document.dispatchEvent(new Event('calculator-mode-change'));document.body.classList.toggle('calculator-selecting',enabled);document.body.classList.toggle('calculator-statistics',!enabled);document.body.classList.toggle('calculator-table-selecting',enabled);if(!enabled){stopScroll();finishSelection();drag=null;selectionPending=false;}syncAggregation();};
 const refreshSelection=()=>{
  if(!chartOwner)selection=[...selected].filter(c=>c.isConnected).map(c=>cells.get(c));const stats=selectionStats(selection);area.hidden=!selection.length;
  const count=document.createElement('strong');count.textContent=`${selection.length.toLocaleString()} selected`;summary.replaceChildren(count);
  for(const button of area.querySelectorAll('[data-aggregate]'))button.disabled=(!!chartOwner&&button.dataset.aggregate==='values')||!stats.count&&!['nonNullCount','distinctCount'].includes(button.dataset.aggregate);
  if(area.querySelector(`[data-aggregate="${aggregation}"]`)?.disabled)aggregation='nonNullCount';
  syncAggregation();
 };
 const selectRange=cell=>{
  const table=cell.closest('table');if(!anchor||anchor.closest('table')!==table)anchor=cell;
  const next=new Set(drag.base),r=[anchor.parentElement.rowIndex,cell.parentElement.rowIndex].sort((a,b)=>a-b),c=[anchor.cellIndex,cell.cellIndex].sort((a,b)=>a-b);
  for(const row of table.rows)if(row.rowIndex>=r[0]&&row.rowIndex<=r[1])for(const td of row.cells)if(td.cellIndex>=c[0]&&td.cellIndex<=c[1]&&cells.has(td)){if(drag.remove)next.delete(td);else next.add(td);}
  for(const td of selected)if(!next.has(td))td.classList.remove('calculator-selected');for(const td of next)td.classList.add('calculator-selected');selected=next;refreshSelection();
 };
 let hoveredCell=null,tableModifier=false,stopScroll=()=>{};
 const updateTableCursor=()=>{
  document.body.classList.remove('calculator-table-add','calculator-table-remove');
  if(!active?.enabled||!hoveredCell?.isConnected||!cells.has(hoveredCell))return;
  if(drag?.multiple||!drag&&tableModifier)document.body.classList.add((drag?drag.remove:selected.has(hoveredCell))?'calculator-table-remove':'calculator-table-add');
 };
 document.addEventListener('pointermove',e=>{hoveredCell=e.target.closest?.('td');tableModifier=e.metaKey||e.ctrlKey;updateTableCursor();},true);
 for(const type of ['keydown','keyup'])document.addEventListener(type,e=>{tableModifier=e.metaKey||e.ctrlKey;updateTableCursor();});
 const resetTableCursor=()=>{hoveredCell=null;tableModifier=false;updateTableCursor();};
 window.addEventListener('blur',resetTableCursor);document.addEventListener('calculator-mode-change',resetTableCursor);document.addEventListener('pointerleave',resetTableCursor);
 active={enabled:false,minimized:true,selectColumn(items,insert){
  const linked=items.length&&!chartOwner?selectionRefs:null;releaseChart();selectionRefs=linked;syncLinkedValue();selected.forEach(c=>c.classList.remove('calculator-selected'));selected.clear();selection=items;
  const count=document.createElement('strong');count.textContent=items.length.toLocaleString()+' selected';summary.replaceChildren(count);area.hidden=!items.length;
  const stats=selectionStats(items);for(const b of area.querySelectorAll('[data-aggregate]'))b.disabled=!stats.count&&!['nonNullCount','distinctCount'].includes(b.dataset.aggregate);
  if(insert&&!linked)aggregation=stats.count?'sum':'nonNullCount';if(!stats.count&&!['nonNullCount','distinctCount'].includes(aggregation))aggregation='nonNullCount';syncAggregation();if((insert||linked)&&active.enabled&&items.length)useSelection(false);
 },selectTable(items){if(active.enabled)return;releaseChart();selection=items;syncAggregation();},capture,message,releaseChart,selectChart(owner,items){if(chartOwner!==owner){releaseChart();selected.forEach(c=>c.classList.remove('calculator-selected'));selected.clear();chartOwner=owner;aggregation='sum';}selection=items;if(!items.length){releaseChart();message('Selection cleared; captured value kept.');return;}refreshSelection();if(active.enabled)useSelection(false);}};
 document.addEventListener('pointerdown',e=>{if(!active.enabled||e.button!==0)return;const cell=e.target.closest?.('td');if(!cell||!cells.has(cell))return;e.preventDefault();e.stopImmediatePropagation();suppressClick=true;if(chartOwner)releaseChart();
  const multiple=e.metaKey||e.ctrlKey;
  if(multiple)anchor=cell;
  else if(!e.shiftKey){anchor=cell;selectionRefs=null;syncLinkedValue();aggregation='sum';}
  drag={cell,multiple,base:multiple?new Set(selected):new Set(),remove:multiple&&selected.has(cell)};selectionPending=true;selectRange(cell);hoveredCell=cell;tableModifier=multiple;updateTableCursor();stopScroll();stopScroll=startTableSelectionScroll(cell.closest('table'),e,td=>{if(drag&&cells.has(td))selectRange(td);});
 },true);
 document.addEventListener('pointermove',e=>{if(!drag)return;const cell=e.target.closest?.('td');if(cell&&cells.has(cell)&&cell.closest('table')===drag.cell.closest('table'))selectRange(cell);},true);
 document.addEventListener('pointerup',e=>{stopScroll();drag=null;tableModifier=e.metaKey||e.ctrlKey;updateTableCursor();if(selectionPending){selectionPending=false;if(selected.size){if(active.enabled)useSelection();else refreshSelection();}else{selectionRefs=null;syncLinkedValue();area.hidden=true;message('Selection cleared; captured value kept.');}}setTimeout(()=>{suppressClick=false;},0);},true);
 for(const type of ['pointercancel','blur'])window.addEventListener(type,()=>{stopScroll();drag=null;selectionPending=false;suppressClick=false;resetTableCursor();});
 document.addEventListener('click',e=>{if(suppressClick||active.enabled&&cells.has(e.target.closest?.('td'))){suppressClick=false;e.preventDefault();e.stopImmediatePropagation();}},true);
 const open=()=>{if(!ready)return;panel.hidden=false;panel.querySelector('.calculator-body').hidden=false;setEnabled(true);area.hidden=!selection.length;input.focus();};launcher.onclick=()=>panel.hidden||active.minimized?open():close();
 const close=()=>{panel.hidden=true;setEnabled(false);};panel.querySelector('[aria-label="Close calculator"]').onclick=close;
 const useSelection=(refresh=true)=>{
  if(refresh)refreshSelection();const stats=selectionStats(selection),kind=aggregation;
  if(!selection.length)return;
  if(!stats.count&&!['nonNullCount','distinctCount'].includes(kind)){message('No numeric values selected.');return;}
  const refs=capture(kind==='values'?selection:[{value:stats[kind],label:`${kind==='nonNullCount'?'count':kind==='distinctCount'?'count distinct':kind} of ${selection.length} ${chartOwner?'chart values':'cells'} · ${label()}`}],`${stats.nonNullCount} non-null values; ${stats.distinctCount} distinct; ${stats.count} numeric cells. Counts exclude nulls; empty text is a value. ${[...new Set(selection.map(s=>s.label))].join(', ').slice(0,350)}`,{replace:selectionRefs,keepSelection:true});
  if(refs)selectionRefs=refs;syncLinkedValue();
 };
 const numericNote=document.createElement('small');numericNote.className='calculator-numeric-note';numericNote.hidden=true;area.append(numericNote);
 function syncAggregation(){
  const stats=selectionStats(selection),mixed=stats.skipped>0;
  const note=mixed?`* Numeric values only: ${stats.count.toLocaleString()} included; ${stats.skipped.toLocaleString()} non-numeric or empty cells excluded.`:'';
  numericNote.hidden=!mixed;numericNote.textContent=note;
  const numericStat=!['nonNullCount','distinctCount'].includes(statistic);
  const value=selection.length&&(statistic==='nonNullCount'||statistic==='distinctCount'||stats.count)?stats[statistic]:null;
  statisticValue=value;readout.disabled=!Number.isFinite(value);
  readout.textContent=`${names[statistic]}${mixed&&numericStat?'*':''} ${formatCalculatorSummary(value,{places:state.inputDecimals,count:statistic==='nonNullCount'||statistic==='distinctCount'})}`;
  readout.title=selection.length?`Click to copy · ${selection.length} selected · ${names[statistic]}: ${value??'No numeric values'}${mixed&&numericStat?' · '+note:''}`:'Select table cells to see statistics';
  for(const b of statMenu.children){
   const kind=b.dataset.stat,count=['nonNullCount','distinctCount'].includes(kind);
   const v=selection.length&&(count||stats.count)?stats[kind]:null;
   const caption=document.createElement('span'),value=document.createElement('strong');
   caption.textContent=names[kind]+(mixed&&!count?'*':'');value.textContent=formatCalculatorSummary(v,{places:state.inputDecimals,count});
   b.replaceChildren(caption,value);b.setAttribute('aria-checked',String(kind===statistic));
   b.title=selection.length?`${names[kind]}: ${v??'No numeric values'}${count?' (excluding null values)':mixed?' · '+note:''}`:'Select table cells to see statistics';
  }
  for(const b of area.querySelectorAll('[data-aggregate]')){
   const kind=b.dataset.aggregate;b.setAttribute('aria-pressed',String(kind===aggregation));
   const numeric=!['nonNullCount','distinctCount'].includes(kind);b.querySelector('span').textContent=b.dataset.caption+(mixed&&numeric?'*':'');
   if(kind==='values')b.title='Insert numeric values separately, joined with +'+(mixed?' · '+note:'');
   const output=b.querySelector('.calculator-aggregate-value');if(!output)continue;
   const count=['nonNullCount','distinctCount'].includes(kind),value=count||stats.count?stats[kind]:null;
   output.textContent=formatCalculatorSummary(value,{places:state.inputDecimals,count});
   b.title=b.dataset.caption+(value==null?' · No numeric values':` · ${value}`)+(count?' (excluding null values)':mixed?' · '+note:'');
  }
 }
 for(const [kind,text] of [['sum','Sum'],['average','Avg'],['nonNullCount','Count'],['distinctCount','Count distinct'],['min','Min'],['max','Max'],['median','Median'],['values','Individual values']]){
  const b=document.createElement('button');b.type='button';const caption=document.createElement('span');caption.textContent=text;b.append(caption);b.dataset.caption=text;if(kind!=='values'){const value=document.createElement('strong');value.className='calculator-aggregate-value';b.append(value);}b.dataset.aggregate=kind;if(['min','max','median','values'].includes(kind))b.className='calculator-aggregate-secondary';b.title=kind==='nonNullCount'?'Count non-null values':kind==='distinctCount'?'Count distinct non-null values':kind==='values'?'Insert each selected table value separately, joined with +':text;b.onclick=()=>{aggregation=kind;syncAggregation();useSelection(false);};area.querySelector('.calculator-aggregation').append(b);
 }
 syncAggregation();
 button('clear-history').onclick=()=>{state.history=[];render();changed();};
 button('clear-values').onclick=()=>{releaseChart();
  // Resolve references before removing them so neither current work nor history
  // can accidentally bind to a subsequently reused snapshot ID.
  const resolve=expression=>expression.replace(/\$\d+/g,id=>{const snapshot=state.snapshots.find(s=>s.id===id);return snapshot?`(${snapshot.value})`:id;});
  input.value=resolve(input.value);state.history=state.history.map(h=>({...h,expression:resolve(h.expression)}));state.snapshots=[];selectionRefs=null;area.hidden=true;render();changed();
 };
 button('calculate').onclick=()=>{const result=updateAnswer();if(result===null)return;state.history.push({expression:input.value,result,time:new Date().toISOString()});state.history=state.history.slice(-30);render();changed();};
 button('clear').onclick=()=>{releaseChart();selectionRefs=null;area.hidden=true;selected.forEach(c=>c.classList.remove('calculator-selected'));selected.clear();input.value='';answer.textContent='';changed();input.focus();};button('copy').onclick=async()=>{try{await navigator.clipboard.writeText(input.value.replace(/\$\d+/g,id=>{const s=state.snapshots.find(s=>s.id===id);return s?`${s.value} [${s.label}]`:id;})+' '+answer.textContent);message('Copied calculation.');}catch{message('Could not copy. Select the expression and copy it manually.');}};
 const expression=panel.querySelector('.calculator-expression');
 // Editing or moving the caret ends the live selection's ownership of an operand.
 expression.addEventListener('pointerdown',finishSelection,{capture:true});
 input.oninput=()=>{if(!capturing)finishSelection();changed();};input.onkeydown=e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','Tab'].includes(e.key)||(e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='a')finishSelection();if(e.key==='Enter'){e.preventDefault();button('calculate').click();}};
 document.addEventListener('keydown',e=>{if(e.altKey&&e.code==='KeyC'){e.preventDefault();open();}if(e.key==='Escape'&&!panel.hidden)close();});
 const header=panel.querySelector('header');let moving=null;header.onpointerdown=e=>{if(e.target.closest('button'))return;const b=panel.getBoundingClientRect();moving={x:e.clientX-b.left,y:e.clientY-b.top};header.setPointerCapture(e.pointerId);};header.onpointermove=e=>{if(!moving)return;panel.style.left=Math.max(0,Math.min(innerWidth-panel.offsetWidth,e.clientX-moving.x))+'px';panel.style.top=Math.max(0,Math.min(innerHeight-50,e.clientY-moving.y))+'px';panel.style.right=panel.style.bottom='auto';};header.onpointerup=header.onpointercancel=()=>{moving=null;};
 launcher.disabled=true;return {flush,restore(raw){state=cleanCalculatorState(raw);dirty=false;panel.querySelector('[aria-label="Input decimals"]').value=state.inputDecimals??'auto';panel.querySelector('[aria-label="Result decimals"]').value=state.resultDecimals??'auto';input.value=state.expression;updateAnswer();ready=true;launcher.disabled=false;render();syncAggregation();document.body.classList.toggle('calculator-statistics',!active.enabled);},snapshot:()=>structuredClone(state)};
}
