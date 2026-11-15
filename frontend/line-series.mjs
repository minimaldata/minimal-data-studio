export function mountSelectionActions(host,series,state,pin){
 const all=document.createElement('button'),clear=document.createElement('button');
 all.type=clear.type='button';all.textContent='Select all';clear.textContent='Clear selection';
 all.title='Select every series, including those outside the search results';
 all.onclick=()=>{series.forEach(s=>state._linePins.add(s));pin(null);refresh();};
 clear.onclick=()=>{state._linePins.clear();pin(null);refresh();};
 function refresh(){all.disabled=series.every(s=>state._linePins.has(s));clear.disabled=!state._linePins.size;}
 host.append(all,clear);refresh();return {refresh};
}
// Transient series inspection controls; pinning does not change saved data.
export function mountSeriesPicker(host,series,colors,state,{highlight,pin,only}){
 const wrap=document.createElement('div');wrap.className='line-series-tools';
 const menu=document.createElement('details'),summary=document.createElement('summary');summary.textContent=`Series · ${series.length}`;menu.append(summary);
 const panel=document.createElement('div');panel.className='line-series-menu';
 const search=document.createElement('input');search.type='search';search.placeholder='Find a series…';search.setAttribute('aria-label','Find a series');panel.append(search);
 const list=document.createElement('div');list.className='line-series-list';panel.append(list);menu.append(panel);
 const onlyButton=document.createElement('button');onlyButton.type='button';onlyButton.textContent='Show pinned only';onlyButton.setAttribute('aria-pressed',String(!!state._lineOnly));
 const actions=document.createElement('span');actions.className='line-selection-actions';let selectionActions;
 const status=document.createElement('span');status.className='muted';
 function update(){status.textContent=state._linePins.size?`${state._linePins.size} pinned`:'Hover a line · click to pin';onlyButton.disabled=!state._linePins.size;selectionActions?.refresh();}
 function render(){list.replaceChildren();series.forEach((s,i)=>{if(!s.toLowerCase().includes(search.value.toLowerCase()))return;const b=document.createElement('button');b.type='button';b.setAttribute('aria-pressed',String(state._linePins.has(s)));const dot=document.createElement('span');dot.className='sw';dot.style.background=colors[i];b.append(dot,document.createTextNode(s));b.onclick=()=>{pin(s);render();update();};b.onmouseenter=()=>highlight(s);b.onmouseleave=()=>highlight(null);b.onfocus=()=>highlight(s);b.onblur=()=>highlight(null);list.append(b);});if(!list.children.length)list.textContent='No matching series.';}
 search.oninput=render;menu.ontoggle=()=>{if(!menu.open)highlight(null);};onlyButton.onclick=()=>only(!state._lineOnly);selectionActions=mountSelectionActions(actions,series,state,s=>{pin(s);render();update();});
 wrap.append(menu,onlyButton,actions,status);host.append(wrap);render();update();return {refresh(){render();update();}};
}
export function bindLineInspection(view,pins,onPin,plot){
 const series=item=>{const d=item?.datum;return Array.isArray(d)?d[0]?.series:d?.series;};
 const valid=item=>item?.mark?.marktype==='line';
 view.addEventListener('pointerover',(e,item)=>{if(!pins.size&&valid(item)){const s=series(item);if(s!=null)view.signal('hl',s).runAsync();}});
 view.addEventListener('pointermove',(e,item)=>{if(!pins.size&&valid(item)&&!plot.classList.contains('is-panning')){const s=series(item);if(s!=null&&view.signal('hl')!==s)view.signal('hl',s).runAsync();}});
 view.addEventListener('pointerout',(e,item)=>{if(valid(item))view.signal('hl',null).runAsync();});
 let start=null;const events=new AbortController();
 view.addEventListener('pointerdown',(e,item)=>{start=e.button===0&&valid(item)&&!plot.classList.contains('is-box-zoom')?{x:e.clientX,y:e.clientY,series:series(item)}:null;});
 document.addEventListener('pointerup',e=>{const down=start;start=null;if(down&&down.series!=null&&Math.hypot(e.clientX-down.x,e.clientY-down.y)<4)onPin(down.series);},{signal:events.signal});
 document.addEventListener('pointercancel',()=>{start=null;},{signal:events.signal});
 window.addEventListener('blur',()=>{start=null;view.signal('hl',null).runAsync();},{signal:events.signal});
 const finalize=view.finalize.bind(view);view.finalize=()=>{events.abort();return finalize();};
 view.signal('pinnedSeries',[...pins]);
}

export {stripPalette as cohortColors} from './line-appearance.mjs';
export function stripLabels(series){
 const months=series.every(s=>/^\d{4}-\d{2}$/.test(s));
 const candidates=series.map((s,i)=>i).filter(i=>i===0||i===series.length-1||(months&&series[i].endsWith('-01')));
 const indices=candidates.length<=6?candidates:Array.from({length:5},(_,i)=>Math.round(i*(series.length-1)/4));
 return [...new Set(indices)].map(i=>({index:i,label:months?new Date(series[i]+'-01T00:00:00Z').toLocaleDateString('en-US',{month:'short',year:'numeric',timeZone:'UTC'}):series[i]}));
}
// Calendar grouping is selection-only: members retain their identities, colors and values.
export function cohortGroups(series,mode='original'){
 const parts=series.map(s=>String(s).match(/^(\d{4})-(\d{2})(?:-(\d{2})(?:[T ].*)?)?$/));
 const dated=parts.every(p=>p&&+p[2]>=1&&+p[2]<=12&&(!p[3]||(+p[3]>=1&&+p[3]<=new Date(Date.UTC(+p[1],+p[2],0)).getUTCDate())));
 if(!dated||mode==='original')return series.map((s,i)=>({label:s,members:[s],indices:[i]}));
 const groups=new Map();parts.forEach((p,i)=>{const key=mode==='year'?p[1]:mode==='quarter'?`${p[1]} Q${Math.ceil(+p[2]/3)}`:`${p[1]}-${p[2]}`;
  if(!groups.has(key))groups.set(key,{label:key,members:[],indices:[]});groups.get(key).members.push(series[i]);groups.get(key).indices.push(i);
 });return [...groups.values()];
}
export function canGroupCohorts(series){return series.length>0&&series.every(s=>/^\d{4}-\d{2}(?:-\d{2}(?:[T ].*)?)?$/.test(String(s)))&&cohortGroups(series,'year').every(g=>/^\d{4}$/.test(g.label));}
export function resolveSeriesKind(mode,series){return mode==='cohorts'?'cohorts':mode==='series'?'series':canGroupCohorts(series)?'cohorts':'series';}
export function mountSeriesStrip(host,series,colors,state,{highlight,pin,seriesKind}){
 const kind=resolveSeriesKind(seriesKind,series),groupable=kind==='cohorts'&&canGroupCohorts(series);
 const wrap=document.createElement('div');wrap.className='cohort-strip';
 const top=document.createElement('div');top.className='cohort-strip-heading';
 const label=document.createElement('span');label.textContent=kind==='cohorts'?'Cohorts':'Series';
 const readout=document.createElement('span');readout.className='cohort-strip-readout';
 const actions=document.createElement('span');actions.className='line-selection-actions';let selectionActions;top.append(label);
 let mode=groupable?(state._cohortGrouping||'original'):'original',groups=cohortGroups(series,mode),buttons=[],hovered=null,localHover=null;
 if(groupable){
  const chooser=document.createElement('select');chooser.setAttribute('aria-label','Cohort selection grouping');
  for(const [value,text] of [['original','Original'],['month','Month'],['quarter','Quarter'],['year','Year']])chooser.add(new Option(text,value,false,value===mode));
  const hint=document.createElement('small');hint.textContent='Groups selections only';
  chooser.onchange=()=>{mode=chooser.value;state._cohortGrouping=mode;groups=cohortGroups(series,mode);localHover=hovered=null;highlight(null);render();};top.append(chooser,hint);
 }
 top.append(readout,actions);
 const track=document.createElement('div');track.className='cohort-strip-track';track.setAttribute('role','group');track.setAttribute('aria-label',kind==='cohorts'?'Select cohorts to highlight':'Select series to highlight');
 const axis=document.createElement('div');axis.className='cohort-strip-axis';
 const full=g=>g.members.every(s=>state._linePins.has(s));
 const apply=(g,select)=>g.members.forEach(s=>state._linePins[select?'add':'delete'](s));
 function hoverGroup(i){if(i!==null&&!groups[i])i=null;localHover=i;highlight(i===null?null:groups[i].members.length===1?groups[i].members[0]:groups[i].members);refresh();}
 function render(){
  buttons=[];track.replaceChildren();axis.replaceChildren();
  buttons=groups.map((g,i)=>{const b=document.createElement('button');b.type='button';
   const stops=g.indices.flatMap((idx,j)=>[`${colors[idx]} ${100*j/g.indices.length}%`,`${colors[idx]} ${100*(j+1)/g.indices.length}%`]);
   b.style.background=g.indices.length===1?colors[g.indices[0]]:`linear-gradient(to right,${stops.join(',')})`;
   b.setAttribute('aria-label',g.label);b.onmouseenter=()=>hoverGroup(i);b.onmouseleave=()=>hoverGroup(null);b.onfocus=()=>hoverGroup(i);b.onblur=()=>hoverGroup(null);
   b.onclick=()=>{apply(g,!full(g));pin(null);refresh();};
   b.onkeydown=e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();buttons[Math.max(0,Math.min(groups.length-1,i+(e.key==='ArrowRight'?1:-1)))].focus();}};track.append(b);return b;
  });
  for(const {index,label} of stripLabels(groups.map(g=>g.label))){const tick=document.createElement('span');tick.textContent=label;tick.style.left=`${100*(index+.5)/groups.length}%`;if(index===0)tick.className='first';if(index===groups.length-1)tick.className='last';axis.append(tick);}
  refresh();
 }
 // Fully selected starting groups erase; partial or empty starting groups select.
 // Restoring the initial set keeps shrinking/reversing a drag predictable.
 let drag=null,suppressClick=false;
 const indexAt=x=>{const r=track.getBoundingClientRect();return Math.max(0,Math.min(groups.length-1,Math.floor((x-r.left)/r.width*groups.length)));};
 const restore=base=>{state._linePins.clear();base.forEach(s=>state._linePins.add(s));};
 track.addEventListener('pointerdown',e=>{if(e.button!==0||!e.target.closest('button'))return;suppressClick=false;drag={id:e.pointerId,x:e.clientX,start:indexAt(e.clientX),select:!full(groups[indexAt(e.clientX)]),base:new Set(state._linePins),active:false};});
 track.addEventListener('pointermove',e=>{
  if(!drag||drag.id!==e.pointerId)return;
  if(!(e.buttons&1)){drag=null;return;}
  const end=indexAt(e.clientX);if(!drag.active&&Math.abs(e.clientX-drag.x)<4)return;
  if(!drag.active){drag.active=true;track.setPointerCapture(e.pointerId);track.classList.add('is-selecting');}
  e.preventDefault();restore(drag.base);
  for(let i=Math.min(drag.start,end);i<=Math.max(drag.start,end);i++)apply(groups[i],drag.select);
  pin(null);hoverGroup(end);refresh();
 });
 const finish=(e,cancel=false)=>{if(!drag||drag.id!==e.pointerId)return;const prior=drag;drag=null;
  if(prior.active){suppressClick=true;if(cancel){restore(prior.base);pin(null);}track.classList.remove('is-selecting');if(track.hasPointerCapture(e.pointerId))track.releasePointerCapture(e.pointerId);hoverGroup(null);refresh();}
 };
 track.addEventListener('pointerup',e=>finish(e));track.addEventListener('pointercancel',e=>finish(e,true));track.addEventListener('lostpointercapture',e=>finish(e,true));
 track.addEventListener('click',e=>{if(suppressClick&&e.detail!==0){e.preventDefault();e.stopPropagation();suppressClick=false;}},true);
 function refresh(){
  const hoverIndex=localHover??groups.findIndex(g=>g.members.includes(hovered)),active=hoverIndex>=0||state._linePins.size>0;
  buttons.forEach((b,i)=>{const count=groups[i].members.filter(s=>state._linePins.has(s)).length;
   b.setAttribute('aria-pressed',count===groups[i].members.length?'true':count?'mixed':'false');b.classList.toggle('is-hovered',i===hoverIndex);b.style.opacity=active&&!count&&i!==hoverIndex?'.35':'1';
  });
  readout.textContent=hoverIndex>=0?groups[hoverIndex].label:(state._linePins.size?`${state._linePins.size} selected`:'Hover to explore · drag to select');
  readout.classList.toggle('is-hovered',hoverIndex>=0);
  if(hoverIndex>=0){const width=wrap.clientWidth;readout.style.left=Math.max(0,Math.min(width-readout.offsetWidth,track.offsetLeft+track.clientWidth*(hoverIndex+.5)/groups.length-readout.offsetWidth/2))+'px';readout.style.top=(track.offsetTop-readout.offsetHeight-4)+'px';}else{readout.style.left='';readout.style.top='';}
  selectionActions?.refresh();
 }
 selectionActions=mountSelectionActions(actions,series,state,s=>{pin(s);refresh();});
 wrap.append(top,track,axis);host.append(wrap);render();return {refresh,hover(s){hovered=s;refresh();}};
}
