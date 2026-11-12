/** Calendar mapping and portable parameter output; no DOM or simulation engine. */
export const today = () => {const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;};
export const defaultAssumption = () => ({format:1, basis:'history', startDate:today(), source:'', dateColumn:'', valueColumn:'', grain:'month', horizon:3, mode:'values', points:[], spread:[]});
/** New allocations are immediately editable; existing saved cells are never reseeded. */
export function defaultPercentageAssumption(){
  const config=defaultAssumption();
  return {...config,basis:'range',chartType:'percent',valueSeries:true,
    series:[0,1].map(i=>({id:`series${i+1}`,name:`Series ${i+1}`,color:SERIES_COLORS[i],mode:'values',valueColumn:'',points:[[config.startDate,50]],spread:[]}))};
}
export function isoDate(value) {
  const text=String(value ?? '');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(Date.parse(text+'T00:00:00Z')) || new Date(text+'T00:00:00Z').toISOString().slice(0,10)!==text)
    throw Error('Use a valid YYYY-MM-DD date. For historical data, select CAST(your_date AS DATE) in the source query.');
  return text;
}
export function futureDate(last, offset, grain) {
  const d=new Date(last+'T00:00:00Z');
  if(grain==='day')d.setUTCDate(d.getUTCDate()+offset);
  else {const day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+offset*(grain==='year'?12:1));const end=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,end));}
  return d.toISOString().slice(0,10);
}
export function historyRows(rows) {
  if(!Array.isArray(rows)||rows.length<2||rows.length>1000)throw Error('Use 2–1,000 historical rows, with one value per date. Aggregate the source query first if needed.');
  const values=rows.map(([date,value])=>{
    if(value===null||value===''||!Number.isFinite(Number(value)))throw Error('Historical values must be numeric and non-missing. Clean the source query first.');
    return [isoDate(date),Number(value)];
  }).sort((a,b)=>a[0].localeCompare(b[0]));
  if(new Set(values.map(r=>r[0])).size!==values.length)throw Error('History has duplicate dates. Aggregate to one row per date first.');
  return values;
}
export function createAssumption(config, history, CurveModel) {
  if(config.format!==1||!['day','month','year'].includes(config.grain)||!['values','normal'].includes(config.mode)||!Number.isInteger(config.horizon)||config.horizon<1||config.horizon>120)throw Error('Choose values or Normal, a daily, monthly or yearly interval, and 1–120 future periods.');
  const range=config.basis==='range';
  if(config.basis && !['history','range'].includes(config.basis))throw Error('Choose From data or Date range.');
  const past=range?[]:historyRows(history), last=past.at(-1), start=past.length;
  const first=range?isoDate(config.startDate):last[0];
  const dates=[...past.map(r=>r[0]),...Array.from({length:config.horizon},(_,i)=>futureDate(first,i+(range?0:1),config.grain))];
  function controls(saved,fallback){
    if(!Array.isArray(saved))throw Error('Invalid saved assumption points.');
    const points=new Map();
    for(const p of saved){if(!Array.isArray(p)||p.length!==2||!Number.isFinite(p[1]))throw Error('Assumption points must contain a date and a finite numeric value.');isoDate(p[0]);if(points.has(p[0]))throw Error('Duplicate assumption point date.');points.set(p[0],p[1]);}
    const result=dates.slice(start).flatMap((date,i)=>points.has(date)?[[start+i,points.get(date)]]:[]);
    // Only new horizons receive a generated endpoint; existing future dates retain their values.
    if(!result.some(p=>p[0]===dates.length-1))result.push([dates.length-1,result.at(-1)?.[1]??fallback]);
    if(range&&dates.length>1&&!result.some(p=>p[0]===0))result.unshift([0,result[0]?.[1]??fallback]);
    return result;
  }
  const future=controls(config.points,last?.[1]??0), sd=controls(config.spread,0);
  if(sd.some(p=>p[1]<0))throw Error('Standard deviation cannot be negative.');
  const domain=[range&&dates.length===1?-1:0,dates.length-1];
  const anchor=points=>range?(dates.length===1?[[-1,points[0][1]],...points]:points):[[start-1,last[1]],...points];
  const mean=new CurveModel({domain,lines:[
    ...(!range?[{id:'actual',name:'History (fixed)',color:'#939393',editable:false,data:past.map((p,i)=>[i,p[1]]),extrapolation:{after:'none'}}]:[]),
    {id:'future',name:config.mode==='normal'?'Future mean':'Future value',color:'#478bf5',data:anchor(future),editDomain:{x:[[start,dates.length-1]]},extrapolation:{before:range?'hold':'none'},lineStyle:{type:'dashed'}}
  ]});
  const spread=new CurveModel({domain,lines:[{id:'sd',name:'Standard deviation',color:'#ae7ce8',data:range?anchor(sd):[[start-1,sd[0][1]],...sd],editDomain:{x:[[start,dates.length-1]]},extrapolation:{before:range?'hold':'none'}}]});
  applyAxis(mean,config.meanAxis,{range});applyAxis(spread,config.spreadAxis,{spread:true});
  return {
    dates,past,start,mean,spread,
    save(){return {points:mean.lines.find(l=>l.id==='future').data.filter(p=>p[0]>=start).map(([x,y])=>[dates[x],y]),spread:spread.lines[0].data.filter(p=>p[0]>=start).map(([x,y])=>[dates[x],y])};},
    rows(){return dates.map((date,i)=>{const actual=i<start,value=actual?past[i][1]:mean.valueAt('future',i);return {date,value,mean:actual?null:value,sd:actual||config.mode==='values'?null:spread.valueAt('sd',i),segment:actual?'actual':'future',distribution:actual?'observed':config.mode==='normal'?'normal':'fixed'};});}
  };
}

// ECharts' original default: 5 × 10^(floor(log10(scale)) − 2).
export function automaticSnap(min,max){return 5*10**(Math.floor(Math.log10(Math.max(Math.abs(min),Math.abs(max))||1))-2);}
export function applyAxis(model,settings={}, {range=false,spread=false}={}){
  const values=model.lines.flatMap(l=>l.data.map(p=>p[1])),low=Math.min(...values),high=Math.max(...values);
  const pad=Math.max(1,(high-low)*.25,Math.abs(high)*.1);
  const bounds=[settings.min??(spread?0:range?Math.min(0,low):low-pad),settings.max??(spread?Math.max(1,high*1.5):range?Math.max(100,high+pad):high+pad)];
  if(!bounds.every(Number.isFinite)||bounds[0]>=bounds[1])throw Error('Y min must be less than Y max.');
  if(spread&&bounds[0]<0)throw Error('Standard deviation needs a Y min of zero or greater.');
  if(bounds[0]>low||bounds[1]<high)throw Error('Axis bounds must include all existing values. Change the values first, or use Auto.');
  const snap=settings.snap??automaticSnap(...bounds);
  if(!Number.isFinite(snap)||snap<=0)throw Error('Snap increment must be greater than zero.');
  model.bounds=bounds;model.snap=snap;return {min:bounds[0],max:bounds[1],snap};
}

export const MONOTONICITY=['none','ascending','descending'];
export function respectsMonotonicity(points,rule='none'){
  if(!MONOTONICITY.includes(rule))throw Error('Choose unrestricted, non-decreasing or non-increasing.');
  return rule==='none'||points.every((p,i)=>!i||(rule==='ascending'?p[1]>=points[i-1][1]-1e-9:p[1]<=points[i-1][1]+1e-9));
}

export const SERIES_COLORS=['#478bf5','#e7a447','#51b99a','#b18bea','#e47797','#65baca'];
export function assumptionSeries(config){
  const series=config.series??[{id:'series1',name:'Series 1',color:SERIES_COLORS[0],valueColumn:config.valueColumn||'',mode:config.mode||'values',points:config.points||[],spread:config.spread||[]}];
  if(!Array.isArray(series)||!series.length||series.length>24)throw Error('Use 1–24 named series.');
  const ids=new Set(),names=new Set();
  for(const s of series){
    if(typeof s.id!=='string'||!s.id||ids.has(s.id))throw Error('Each series needs a unique ID.');ids.add(s.id);
    if(typeof s.name!=='string'||!s.name.trim()||s.name.length>64||names.has(s.name.trim().toLowerCase()))throw Error('Give each series a unique name (1–64 characters).');names.add(s.name.trim().toLowerCase());
    if(!/^#[0-9a-f]{6}$/i.test(s.color||''))throw Error('Choose a valid series color.');
  }
  return series;
}

/** Upgrade old distribution controls to ordinary value series, without losing points. */
export function migrateValueSeries(config){
  if(config.valueSeries)return false;
  const original=assumptionSeries(config),result=[],ids=new Set(original.map(s=>s.id)),names=new Set(original.map(s=>s.name.toLowerCase()));
  for(const series of original){
    result.push({...series,mode:'values',spread:[]});
    if(series.mode!=='normal')continue;
    let id=series.id+'-sd';while(ids.has(id))id+='-sd';ids.add(id);
    let base=series.name.slice(0,42)+' standard deviation',name=base,n=2;while(names.has(name.toLowerCase()))name=base+' '+n++;names.add(name.toLowerCase());
    result.push({id,name,color:SERIES_COLORS[result.length%SERIES_COLORS.length],mode:'values',points:structuredClone(series.spread||[]),spread:[],valueColumn:series.valueColumn,
      monotonicity:series.spreadMonotonicity||'none',futureOnly:config.basis!=='range',initialValue:0});
  }
  const migrated=original.some(s=>s.mode==='normal');
  config.series=result;config.valueSeries=true;config.mode='values';config.spread=[];
  if(migrated)config.meanAxis={...config.meanAxis,min:null,max:null};
  return migrated;
}

/** One timeline and axis per chart; only the selected series accepts edits. */
export function createAssumptionSet(config,histories,CurveModel){
  const series=assumptionSeries(config);
  const parts=series.map(s=>{
    const history=s.futureOnly&&config.basis!=='range'?historyRows(histories[s.id]||[]):histories[s.id]||[];
    // Future-only series use source dates, never fabricated historical observations.
    const futureDates=history.length?new Set(Array.from({length:config.horizon},(_,i)=>futureDate(history.at(-1)[0],i+1,config.grain))):null;
    const anchor=s.points?.filter(p=>!futureDates||futureDates.has(p[0])).sort((a,b)=>a[0].localeCompare(b[0]))[0]?.[1]??s.initialValue??0;
    return createAssumption({...config,...s,meanAxis:undefined,spreadAxis:undefined},s.futureOnly?history.map(([d])=>[d,anchor]):history,CurveModel);
  });
  const {dates,start,past}=parts[0];
  if(parts.some(p=>JSON.stringify(p.dates)!==JSON.stringify(dates)))throw Error('All series must share the same historical dates.');
  const merge=key=>new CurveModel({domain:parts[0][key].domain,lines:parts.flatMap((p,i)=>p[key].lines.filter(l=>!series[i].futureOnly||l.id!=='actual').map(l=>({...structuredClone(l),id:`${series[i].id}:${l.id}`,name:`${series[i].name}${l.id==='actual'?' · history':''}`,color:series[i].color,seriesId:series[i].id}))) });
  const mean=merge('mean'),spread=merge('spread');
  applyAxis(mean,config.meanAxis,{range:config.basis==='range'});applyAxis(spread,config.spreadAxis,{spread:true});
  let selected=series[0].id;
  for(const m of [mean,spread]){const editable=m.editable.bind(m);m.editable=(line,x,op)=>line.seriesId===selected&&editable(line,x,op);}
  const settingsFor=id=>config.series?.find(s=>s.id===id)||series.find(s=>s.id===id);
  const violation=(lines,key,override)=>lines.find(line=>!line.id.endsWith(':actual')&&!respectsMonotonicity(
    line.data.filter(p=>p[0]>=(config.basis==='range'?0:start-1)),
    override?.id===line.seriesId?override.rule:settingsFor(line.seriesId)[key]||'none'));
  const explain=line=>`${settingsFor(line.seriesId).name}: this edit would break its monotonicity. Adjust neighboring points or choose Unrestricted.`;
  for(const [m,key] of [[mean,'monotonicity'],[spread,'spreadMonotonicity']]){
    const invalid=violation(m.lines,key);if(invalid)throw Error(explain(invalid));
    const move=m.move.bind(m);
    m.move=(id,index,x,y,options={})=>{
      const line=m.lines.find(l=>l.id===id),rule=line&&settingsFor(line.seriesId)[key];
      // Pointer gestures stop at neighbors; exact entries retain explicit validation.
      if(m.transaction?.operation==='move'&&line&&rule&&rule!=='none'){
        const first=config.basis==='range'?0:start-1;
        const left=line.data[index-1]?.[0]>=first?line.data[index-1]:null,right=line.data[index+1];
        let low=m.bounds[0],high=m.bounds[1];
        if(rule==='ascending'){low=Math.max(low,left?.[1]??low);high=Math.min(high,right?.[1]??high);}
        else {high=Math.min(high,left?.[1]??high);low=Math.max(low,right?.[1]??low);}
        if(options.snapY!==false)y=Math.round(y/m.snap)*m.snap;
        return move(id,index,x,Math.max(low,Math.min(high,y)),{...options,snapY:false});
      }
      return move(id,index,x,y,options);
    };
    m.constrainedAddPoint=(id,x,y)=>{
      const line=m.lines.find(l=>l.id===id),rule=line&&settingsFor(line.seriesId)[key];
      x=Math.round(x);
      if(!line||!rule||rule==='none'||!m.editable(line,x,'add')||x<m.domain[0]||x>m.domain[1]||line.data.some(p=>p[0]===x))return null;
      const first=config.basis==='range'?0:start-1;
      const left=line.data.filter(p=>p[0]>=first&&p[0]<x).at(-1),right=line.data.find(p=>p[0]>x);
      let low=m.bounds[0],high=m.bounds[1];
      if(rule==='ascending'){low=Math.max(low,left?.[1]??low);high=Math.min(high,right?.[1]??high);}
      else {high=Math.min(high,left?.[1]??high);low=Math.max(low,right?.[1]??low);}
      return [x,Math.max(low,Math.min(high,Math.round(y/m.snap)*m.snap))];
    };
    const add=m.add.bind(m);
    m.add=(id,x,y,mode='point')=>{
      const point=mode==='point'&&m.constrainedAddPoint(id,x,y);
      if(!point)return add(id,x,y,mode);
      const next=structuredClone(m.lines),line=next.find(l=>l.id===id);
      line.data.push(point);line.data.sort((a,b)=>a[0]-b[0]);
      m.begin('add',id);const accepted=m.apply(next);m.commit();return accepted;
    };
    const valid=m.valid.bind(m),apply=m.apply.bind(m);m.valid=next=>!violation(next,key)&&valid(next);
    m.apply=next=>{const invalid=violation(next,key);if(invalid){m.emit('editRejected',{reason:explain(invalid)});return false;}return apply(next);};
    for(const [method,step] of [['undo',-1],['redo',1]]){const action=m[method].bind(m);m[method]=()=>{const next=m.history[m.cursor+step];const invalid=next&&violation(next,key);if(invalid){m.emit('editRejected',{reason:'This history step conflicts with the current monotonicity. Choose Unrestricted to restore it.'});return;}action();};}
  }
  const points=(m,s,id)=>m.lines.find(l=>l.id===`${s.id}:${id}`).data.filter(p=>p[0]>=start).map(([x,y])=>[dates[x],y]);
  return {dates,start,past,mean,spread,series,
    setMonotonicity(id,rule,spreadRule=false){
      if(!MONOTONICITY.includes(rule))throw Error('Choose unrestricted, non-decreasing or non-increasing.');
      const key=spreadRule?'spreadMonotonicity':'monotonicity',m=spreadRule?spread:mean;
      const invalid=violation(m.lines,key,{id,rule});if(invalid)throw Error('Existing points do not follow this direction. Adjust them first; no values were changed.');
      settingsFor(id)[key]=rule;
    },
    select(id){if(!series.some(s=>s.id===id))throw Error('Unknown series.');selected=id;},
    get selected(){return selected;},
    save(){const saved=series.map(s=>({...(config.series?.find(current=>current.id===s.id)??s),points:points(mean,s,'future'),spread:points(spread,s,'sd')}));return {series:saved,points:saved[0].points,spread:saved[0].spread,mode:saved[0].mode,valueColumn:saved[0].valueColumn};},
    rows(id){return series.flatMap((s,j)=>id&&id!==s.id?[]:dates.flatMap((date,i)=>{const actual=i<start;if(actual&&s.futureOnly)return [];const value=actual?parts[j].past[i][1]:mean.valueAt(`${s.id}:future`,i);return [{series:s.name,date,value,mean:actual?null:value,sd:actual||s.mode==='values'?null:spread.valueAt(`${s.id}:sd`,i),segment:actual?'actual':'future',distribution:actual?'observed':s.mode==='normal'?'normal':'fixed'}];}));}
  };
}
