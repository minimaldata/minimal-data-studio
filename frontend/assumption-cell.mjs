import {percentageAssumption} from './assumption-percent.mjs';
import {defaultAssumption,createAssumptionSet,assumptionSeries,SERIES_COLORS,applyAxis,today,migrateValueSeries} from './assumption-model.mjs';

/** Notebook adapter: owns its chart instances; persistence and execution are injected. */
export function mountAssumption(host,cell,{sources,loadHistory,changed,canEdit}) {
  cell.assumption ||= defaultAssumption();
  const config=cell.assumption, charts=[], unsubscribers=[];
  config.basis ||= 'history';config.startDate ||= today();
  const migrated=migrateValueSeries(config);
  config.series=assumptionSeries(config);let selected=config.series[0].id;
  const active=()=>config.series.find(s=>s.id===selected);
  const target=key=>key==='valueColumn'?active():config;
  let model=null,disposed=false,preparing=null;
  const make=(tag,text)=>Object.assign(document.createElement(tag),{textContent:text??''});
  host.className='assumption-editor';
  const inputs=make('details');inputs.className='assumption-inputs';inputs.open=true;
  const summary=make('summary'),summaryTitle=make('strong','Inputs'),summaryMeta=make('span');summaryMeta.className='assumption-inputs-meta';summary.append(summaryTitle,summaryMeta);inputs.append(summary);host.append(inputs);
  const inputBody=make('div');inputBody.className='assumption-inputs-body';inputs.append(inputBody);
  const settings=make('div');settings.className='assumption-settings';inputBody.append(settings);
  const seriesSettings=make('div');inputBody.append(seriesSettings);
  const seriesBar=make('div');seriesBar.className='assumption-series';host.append(seriesBar);
  const note=make('p','History stays fixed. Future edits save with this notebook. Run publishes the combined input table; values are available to SQL, Python and R.');host.append(note);
  const error=make('p');error.className='error';error.setAttribute('role','status');host.append(error);
  const plots=make('div'),table=make('div');table.className='assumption-values';host.append(plots,table);
  const controls={};
  function field(label,key,options){
    const wrap=make('label',label+' '),input=options?make('select'):make('input');input.setAttribute('aria-label',label);
    if(options)for(const [value,text] of options)input.add(new Option(text,value));
    else {input.type='number';input.min='1';input.max='120';input.step='1';}
    input.value=target(key)[key];controls[key]=input;wrap.append(input);settings.append(wrap);
    input.onchange=()=>{if(!canEdit())return;target(key)[key]=key==='horizon'?Number(input.value):input.value;changed();reset();if(key==='source')columns();visibility();};return input;
  }
  field('Start from','basis',[['history','From data'],['range','Date range']]);
  const startDate=field('Start date','startDate');startDate.type='date';startDate.removeAttribute('min');startDate.removeAttribute('max');startDate.value=config.startDate;
  const available=sources();
  field('History cell','source',[['','Choose an earlier cell'],...available.map(s=>[s.name,s.name])]);
  field('Date column','dateColumn',[]);field('Value column','valueColumn',[]);
  function columns(){const source=sources().find(s=>s.name===config.source);for(const key of ['dateColumn','valueColumn']){const select=controls[key];select.replaceChildren(new Option('Choose a column',''));for(const col of source?.cols||[])select.add(new Option(col,col));select.value=target(key)[key];}}
  columns();controls.dateColumn.onfocus=columns;controls.valueColumn.onfocus=columns;
  field('Interval','grain',[['month','Monthly'],['day','Daily'],['year','Yearly']]);field('Number of periods','horizon');
  const load=make('button','Load / refresh history');load.type='button';load.onclick=()=>prepare().catch(()=>{});settings.append(load);
  function visibility(){summaryMeta.textContent=`${config.basis==='range'?config.startDate:config.source||'Choose source'} · ${config.horizon} ${config.grain==='year'?'yearly':config.grain==='day'?'daily':'monthly'} periods`;const range=config.basis==='range';for(const key of ['source','dateColumn'])controls[key].parentElement.hidden=range;controls.valueColumn.parentElement.hidden=range||!!active().futureOnly;controls.startDate.parentElement.hidden=!range;load.textContent=range?'Update chart':'Load / refresh history';note.textContent=config.chartType==='percent'?'Shares total 100% at each date. Source values are shown as percentages; the source data stays unchanged.':range?'All periods are editable. Run publishes the input table; values are available to SQL, Python and R.':'History stays fixed. Future edits save with this notebook. Run publishes the combined input table; values are available to SQL, Python and R.';}
  visibility();renderSeries();
  function renderSeries(){
    seriesBar.replaceChildren();
    const list=make('div');list.className='assumption-series-list';list.setAttribute('role','group');list.setAttribute('aria-label','Assumption series');
    for(const series of config.series){const button=make('button',series.name);button.type='button';button.style.setProperty('--series-color',series.color);button.setAttribute('aria-pressed',String(series.id===selected));button.onclick=()=>{
      if(model?.mean.transaction||model?.spread.transaction)return;
      selected=series.id;model?.select(selected);columns();
      visibility();
      renderSeries();for(const chart of charts)chart.render();if(model)renderTable();
    };list.append(button);}
    const add=make('button','+ Series');add.type='button';add.disabled=!canEdit()||config.series.length>=24;add.onclick=()=>{
      if(!canEdit())return;let n=1;while(config.series.some(s=>s.name.toLowerCase()===`series ${n}`))n++;
      const series={id:crypto.randomUUID(),name:`Series ${n}`,color:SERIES_COLORS[config.series.length%SERIES_COLORS.length],mode:'values',valueColumn:active().valueColumn,points:[],spread:[]};
      if(config.basis==='range'&&model){const value=config.chartType==='percent'?0:model.rows(selected).at(-1).value;series.points=[[model.dates[0],value]];if(model.dates.length>1)series.points.push([model.dates.at(-1),value]);}
      config.series.push(series);selected=series.id;changed();reset();columns();visibility();renderSeries();prepare().catch(()=>{});
    };list.append(add);seriesBar.append(list);
    const detail=make('div');detail.className='assumption-series-detail';detail.append(make('strong',`Editing ${active().name}`));
    const name=make('input');name.value=active().name;name.setAttribute('aria-label','Series name');name.disabled=!canEdit();name.onchange=()=>{
      if(!canEdit())return;const old=active().name;active().name=name.value.trim();try{assumptionSeries(config);}catch(e){active().name=old;name.value=old;error.textContent=e.message;return;}
      error.textContent='';if(model)for(const m of [model.mean,model.spread])for(const line of m.lines.filter(l=>l.seriesId===selected))line.name=`${active().name}${line.id.endsWith(':actual')?' · history':''}`;
      changed();renderSeries();for(const chart of charts)chart.render();
    };detail.append(name,controls.valueColumn.parentElement);
    for(const [key,label] of [['monotonicity','Value monotonicity']]){
      const wrap=make('label',label),select=make('select');select.setAttribute('aria-label',label);
      for(const [value,text] of [['none','Unrestricted'],['ascending','Non-decreasing'],['descending','Non-increasing']])select.add(new Option(text,value));
      select.value=active()[key]||'none';select.disabled=!canEdit()||config.chartType==='percent';select.onchange=()=>{
        if(!canEdit())return;try{if(model)model.setMonotonicity(selected,select.value,key==='spreadMonotonicity');else active()[key]=select.value;error.textContent='';changed();}
        catch(e){error.textContent=e.message;select.replaceChildren(new Option('Unrestricted','none'),new Option('Non-decreasing','ascending'),new Option('Non-increasing','descending'));select.value=active()[key]||'none';}
      };wrap.append(select);detail.append(wrap);
    }
    const remove=make('button','Remove series');remove.type='button';remove.disabled=!canEdit()||config.series.length===1;remove.onclick=()=>{
      if(!canEdit()||config.series.length===1||!confirm(`Remove ${active().name} and its assumption points?`))return;
      config.series=config.series.filter(s=>s.id!==selected);selected=config.series[0].id;changed();reset();columns();visibility();renderSeries();prepare().catch(()=>{});
    };detail.append(remove);seriesSettings.replaceChildren(detail);
  }
  const hint=make('p','Drag future points, click to add, Shift-click to remove. The table below accepts exact values. New future periods start flat.');host.append(hint);
  function reset(){for(const fn of unsubscribers.splice(0))fn();for(const chart of charts.splice(0))chart.destroy();plots.replaceChildren();table.replaceChildren();model=null;}
  function mark(){Object.assign(config,model.save());changed();}
  function renderTable(){
    table.replaceChildren();const t=make('table'),head=make('tr');
    for(const label of ['Date',model.percent?'Share (%)':'Value'])head.append(make('th',label));t.append(head);
    for(const row of model.rows(selected).filter(row=>row.segment==='future')){
      const tr=make('tr');tr.append(make('td',row.date));
      for(const key of ['value']){
        const input=make('input');input.type='number';input.step='any';input.value=row[key];input.setAttribute('aria-label',`${key==='sd'?'Standard deviation':'Future value'} ${row.date}`);input.disabled=!canEdit();if(key==='sd')input.min='0';
        input.onchange=()=>{
          if(!canEdit())return;const n=Number(input.value);
          if(input.value===''||!Number.isFinite(n)||(key==='sd'&&n<0)){error.textContent='Enter a finite value; standard deviation must be zero or greater.';input.value=row[key];return;}
          if(model.percent){try{model.setShare(selected,model.dates.indexOf(row.date),n);error.textContent='';}catch(e){error.textContent=e.message;input.value=row[key];}return;}
          error.textContent='';const m=key==='sd'?model.spread:model.mean,id=`${selected}:${key==='sd'?'sd':'future'}`,x=model.dates.indexOf(row.date),line=m.lines.find(l=>l.id===id),index=line.data.findIndex(p=>p[0]===x);
          const settings=config[key==='sd'?'spreadAxis':'meanAxis']||{};
          if((settings.min!=null&&n<settings.min)||(settings.max!=null&&n>settings.max)){error.textContent='This value is outside your axis bounds. Widen the bounds or use Auto first.';input.value=row[key];return;}
          m.bounds=[settings.min??Math.min(m.bounds[0],n),settings.max??Math.max(m.bounds[1],n+Math.max(1,Math.abs(n)*.1))];charts[key==='sd'?1:0].yDomain=[...m.bounds];
          if(index>=0){m.begin('exact',id);m.move(id,index,x,n,{snapY:false});m.commit();}else {m.begin('exact',id);const next=structuredClone(m.lines);next.find(l=>l.id===id).data.push([x,n]);next.find(l=>l.id===id).data.sort((a,b)=>a[0]-b[0]);m.apply(next);m.commit();}
          input.value=m.valueAt(id,x);
        };
        const td=make('td');td.append(input);tr.append(td);
      }t.append(tr);
    }table.append(t);
  }
  function draw(m,label,axisKey){
    const section=make('section'),title=make('strong',label),actions=make('span'),container=make('div');container.className='assumption-plot';
    const axis=make('details');axis.className='assumption-axis';axis.append(make('summary','Chart settings'));section.append(title,actions,axis,container);plots.append(section);
    const chart=new D3NapkinChart(container,m,{showEditHints:false,template:{surface:'transparent',text:'var(--text)',axis:'var(--muted)',grid:'var(--border)',font:'inherit'}});
    if(model.percent)chart.bandValues=x=>model.bands(x);
    // Keep the hover proposal at the same constrained position as the committed click.
    chart.preview.classed("assumption-add-preview",true);
    const preview=chart.renderEditPreview.bind(chart);
    chart.renderEditPreview=(p,event)=>{
      const line=chart.nearestLine(p),point=!event.shiftKey&&chart.mode(event)==='point'&&!chart.nearest(p)&&line&&m.constrainedAddPoint(line.id,p.x,p.y);
      if(!point)return preview(p,event);
      chart.preview.selectAll('*').remove();chart.paths.selectAll('path').style('opacity',null);chart.editHint.style('display','none');
      const proposed={...line,data:[...line.data,point].sort((a,b)=>a[0]-b[0])};
      chart.paths.selectAll('path').filter(l=>l.id===line.id).style('opacity',.25);
      chart.preview.append('path').attr('d',chart.linePath(chart.displayData(proposed))).attr('fill','none').attr('stroke',line.color).attr('stroke-width',2.5).attr('stroke-dasharray','5 4');
      chart.preview.append('circle').attr('cx',chart.x(point[0])).attr('cy',chart.y(point[1])).attr('r',5).attr('fill','white').attr('stroke',line.color).attr('stroke-width',2);
      chart.svg.style('cursor','crosshair');
    };
    const render=chart.render.bind(chart);chart.render=()=>{for(const line of m.lines){line.name=`${config.series.find(s=>s.id===line.seriesId)?.name||line.name}${line.id.endsWith(':actual')?' · history':''}`;line.lineStyle={...line.lineStyle,width:m.editable(line,m.domain[1])?3:1.5,opacity:m.editable(line,m.domain[1])?1:.4};}render();chart.xAxis.call(d3.axisBottom(chart.x).ticks(5).tickFormat(x=>Number.isInteger(x)?model.dates[x]?.slice(0,10)||'':''));if(model.percent)chart.yAxis.call(d3.axisLeft(chart.y).ticks(5).tickFormat(v=>v+'%'));};chart.render();charts.push(chart);
    const axisFields={};
    const refreshFields=()=>{for(const key of ['min','max','snap']){axisFields[key].value=(model.percent?(key==='snap'?config.percentSnap:key==='min'?0:100):config[axisKey]?.[key])??'';axisFields[key].placeholder=String(key==='snap'?m.snap:m.bounds[key==='min'?0:1]);}};
    const apply=()=>{if(!canEdit())return;const next={};for(const key of ['min','max','snap'])next[key]=axisFields[key].value===''?null:Number(axisFields[key].value);
      try{if(model.percent){if(next.snap!=null&&(!Number.isFinite(next.snap)||next.snap<=0))throw Error('Snap increment must be greater than zero.');m.snap=next.snap??1;config.percentSnap=next.snap;}else applyAxis(m,next,{range:config.basis==='range',spread:axisKey==='spreadAxis'});if(!model.percent)config[axisKey]=next;chart.setYDomain(...m.bounds);error.textContent='';changed();refreshFields();}catch(e){error.textContent=e.message;}};
    for(const [key,label] of [['min','Y min'],['max','Y max'],['snap','Snap increment']]){const wrap=make('label',label),input=make('input');input.type='number';input.step='any';input.setAttribute('aria-label',`${axisKey==='spreadAxis'?'Spread':'Value'} ${label}`);if(key==='snap')input.min='0';axisFields[key]=input;if(model.percent&&key!=='snap')wrap.hidden=true;input.onchange=apply;wrap.append(input);axis.append(wrap);}
    const auto=make('button','Auto');auto.type='button';auto.onclick=()=>{if(!canEdit())return;for(const input of Object.values(axisFields))input.value='';apply();};axis.append(auto,make('small','Blank = Auto. Snap applies to dragging and adding points; exact entries stay exact.'));refreshFields();
    container.addEventListener('pointerdown',event=>{if(!canEdit()){event.preventDefault();event.stopImmediatePropagation();}},true);
    for(const [label,fn] of [['Undo',()=>m.undo()],['Redo',()=>m.redo()]]){const button=make('button',label);button.type='button';button.onclick=()=>{if(canEdit())fn();};actions.append(button);}
    unsubscribers.push(m.on(event=>{if(event.type==='editRejected')error.textContent=event.reason;if(['editCommit','history'].includes(event.type)){if(!canEdit())return;error.textContent='';try{if(!model.percent)applyAxis(m,config[axisKey],{range:config.basis==='range',spread:axisKey==='spreadAxis'});chart.setYDomain(...m.bounds);refreshFields();}catch(e){error.textContent=e.message;}mark();renderTable();}}));
  }
  function prepare(){return preparing ||= doPrepare().finally(()=>{preparing=null;});}
  async function doPrepare(){
    error.textContent='';load.disabled=true;
    try{
      if(config.basis!=='range'&&(!config.source||!config.dateColumn||config.series.some(s=>!s.futureOnly&&!s.valueColumn)))throw Error('Choose a historical cell and its date and numeric value columns. Run that cell first.');
      const histories={};for(const series of config.series)histories[series.id]=config.basis==='range'?[]:await loadHistory({...config,valueColumn:series.valueColumn,futureOnly:series.futureOnly});if(disposed)return null;columns();
      const base=createAssumptionSet(config.chartType==='percent'?{...config,meanAxis:undefined,series:config.series.map(s=>({...s,monotonicity:'none'}))}:config,histories,CurveModel);const next=config.chartType==='percent'?percentageAssumption(base,config,CurveModel):base;reset();model=next;model.select(selected);
      hint.textContent='Drag future points, click to add, Shift-click to remove. The table below accepts exact values. New future periods start flat.';
      if(model.percent){note.textContent='Shares total 100% at each date. Source values are shown as percentages; the source data stays unchanged.';hint.textContent='Drag a dividing line to transfer share between neighboring series. Exact values below are percentages. A single series owns 100%.';}
      draw(model.mean,model.percent?'% of total':config.basis==='range'?'Values over time':'Historical values → future values','meanAxis');
      renderTable();return model;
    }catch(e){error.textContent=e.message;throw e;}finally{load.disabled=false;}
  }
  if(config.basis==='range'||(config.source&&sources().find(s=>s.name===config.source)?.cols.length))queueMicrotask(()=>{if(!disposed)prepare().catch(()=>{});});
  if(migrated){note.textContent+=' Saved Normal inputs have been separated into value series.';queueMicrotask(()=>{if(!disposed&&canEdit())changed();});}
  return {prepare,get editing(){return !!(model?.mean.transaction||model?.spread.transaction);},destroy(){disposed=true;reset();}};
}
