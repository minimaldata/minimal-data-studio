const $=id=>document.getElementById(id),state=studio.state;
const history=(studio.inputs.history||[]).map(row=>({date:String(row.month_end).slice(0,10),mrr:Number(row.mrr_usd)})).filter(row=>/^\d{4}-\d{2}-\d{2}$/.test(row.date)&&Number.isFinite(row.mrr)).sort((a,b)=>a.date.localeCompare(b.date));
const base=history.at(-1);
if(!Array.isArray(state.scenarios)||!state.scenarios.length)state.scenarios=[{id:'base',name:'Base case',growth:1,months:12},{id:'upside',name:'Higher growth',growth:2,months:12}];
if(!state.scenarios.some(s=>s.id===state.selected))state.selected=state.scenarios[0].id;
const selected=()=>state.scenarios.find(s=>s.id===state.selected),money=value=>'$'+Number(value).toLocaleString(undefined,{maximumFractionDigits:0}),short=value=>'$'+(value/1e6).toFixed(1)+'m';
const colors=['#568fe3','#20a58b','#b685dc','#df9a46','#dc6c83'];
const valid=s=>Number.isFinite(s.growth)&&s.growth>=-100&&s.growth<=100&&Number.isInteger(s.months)&&s.months>=1&&s.months<=36;
const assumptions=s=>JSON.stringify({growth:s.growth,months:s.months});
function changes(s){if(!s.result)return [];const reasons=[];if(s.result.inputsHash!==studio.context.inputsHash)reasons.push('Inputs changed');if(s.result.assumptions!==assumptions(s))reasons.push('Assumptions changed');if(s.result.codeHash!==studio.context.codeHash)reasons.push('App code changed');return reasons;}
const stale=s=>!s.result||changes(s).length>0;
const when=value=>value?new Date(value).toLocaleString():'Unknown';
const stage=()=>studio.saveState(state);
function controls(){const s=selected();$('scenario').replaceChildren(...state.scenarios.map(x=>new Option(x.name,x.id)));$('scenario').value=s.id;$('name').value=s.name;$('growth').value=s.growth;$('months').value=s.months;}
function cell(row,text,tag='td'){const el=document.createElement(tag);el.textContent=text;row.append(el);return el;}
function draw(){
 const host=$('chart');host.replaceChildren();if(!base)return;
 const series=[{name:'History',color:'#8994a6',rows:history.slice(-12)},...state.scenarios.filter(s=>s.result).map((s,i)=>({name:s.name+(stale(s)?' · outdated':''),color:colors[i%colors.length],rows:[s.result.baseline,...s.result.rows],stale:stale(s)}))];
 const all=series.flatMap(s=>s.rows),dates=all.map(r=>Date.parse(r.date)),min=Math.min(...dates),max=Math.max(...dates),ymax=Math.max(...all.map(r=>r.mrr),1)*1.1;
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 1000 330');svg.setAttribute('role','img');svg.setAttribute('aria-label','Historical and scenario monthly recurring revenue');host.append(svg);
 const node=(tag,attrs,text)=>{const el=document.createElementNS(svg.namespaceURI,tag);for(const [key,value] of Object.entries(attrs))el.setAttribute(key,value);if(text!==undefined)el.textContent=text;svg.append(el);return el;};
 const x=d=>70+(Date.parse(d)-min)/(max-min||1)*890,y=v=>260-v/ymax*210;
 for(let i=0;i<=4;i++){const v=ymax*i/4;node('line',{x1:70,x2:960,y1:y(v),y2:y(v),stroke:'#8994a6','stroke-opacity':.18});node('text',{x:60,y:y(v)+4,'text-anchor':'end'},short(v));}
 series.forEach((s,i)=>{node('path',{d:s.rows.map((r,j)=>(j?'L':'M')+x(r.date)+','+y(r.mrr)).join(' '),fill:'none',stroke:s.color,'stroke-width':2.5,'stroke-dasharray':s.stale?'5 4':'none'});node('text',{x:70+(i%4)*225,y:18+Math.floor(i/4)*18,style:'fill:'+s.color},s.name);});
 [min,max].forEach((d,i)=>node('text',{x:i?960:70,y:290,'text-anchor':i?'end':'start'},new Date(d).toISOString().slice(0,7)));
 node('text',{x:70,y:320},'Monthly recurring revenue · USD');
}
function render(){
 const s=selected();$('baseline').textContent=base?`${money(base.mrr)} MRR · ${base.date}`:'Bind history to saas_subscription_kpis, then Refresh inputs.';
 $('run').disabled=!base||!valid(s);$('save-table').disabled=!s.result;
 $('notice').textContent=!valid(s)?'Use growth from −100% to 100% and 1–36 whole months.':!s.result?'No result yet. Run this scenario, then Save document.':stale(s)?'Outdated result — '+changes(s).join(' · ')+'. Previous results are retained. Run this scenario to replace its result.':'Result matches these inputs. Save document to keep it.';
 $('notice').className=s.result&&stale(s)?'stale':'';
 const details=$('result-details');details.replaceChildren();
 if(s.result){
  const summary=document.createElement('p');let used;try{used=JSON.parse(s.result.assumptions);}catch{used={};}
  summary.textContent=`Last run: ${when(s.result.at)} · Baseline: ${money(s.result.baseline.mrr)} on ${s.result.baseline.date} · Growth: ${used.growth ?? '—'}% · ${used.months ?? '—'} months`;
  const fingerprints=document.createElement('small');fingerprints.textContent=`Run input ${s.result.inputsHash?.slice(0,12)||'unknown'} · Current input ${studio.context.inputsHash.slice(0,12)}`;
  const rows=document.createElement('table'),header=document.createElement('tr');['Period','Result MRR'].forEach(t=>cell(header,t,'th'));rows.append(header);
  for(const value of s.result.rows){const row=document.createElement('tr');cell(row,value.date);cell(row,money(value.mrr));rows.append(row);}
  details.append(summary,fingerprints,rows);
 }else details.textContent='Run this scenario to capture results.';
 const table=document.createElement('table'),head=document.createElement('tr');['Scenario','Status','Final MRR','Annualized run rate'].forEach(t=>cell(head,t,'th'));table.append(head);
 for(const scenario of state.scenarios){const row=document.createElement('tr'),end=scenario.result?.rows.at(-1);cell(row,scenario.name);const status=cell(row,!end?'Not run':stale(scenario)?'Outdated':'Current');if(end&&stale(scenario)){status.className='stale';status.title=changes(scenario).join(' · ');}cell(row,end?money(end.mrr):'—');cell(row,end?money(end.mrr*12):'—');table.append(row);}
 $('comparison').replaceChildren(table);const meta=studio.context.inputMetadata?.history;
 $('provenance').textContent=meta?`${meta.label} · ${meta.rows} rows · Refreshed ${new Date(meta.refreshedAt).toLocaleString()} · Input ${studio.context.inputsHash.slice(0,12)} · Code ${studio.context.codeHash.slice(0,12)}`:'';draw();
}
$('scenario').onchange=()=>{state.selected=$('scenario').value;controls();render();stage();};
$('name').onchange=()=>{selected().name=$('name').value.trim()||'Untitled scenario';controls();render();stage();};
for(const [id,key] of [['growth','growth'],['months','months']])$(id).oninput=()=>{selected()[key]=$(id).value===''?null:Number($(id).value);render();stage();};
function add(copy){if(state.scenarios.length>=8){$('notice').textContent='Keep up to eight scenarios in this example.';return;}const previous=selected(),s={id:crypto.randomUUID(),name:copy?previous.name+' copy':'Scenario '+(state.scenarios.length+1),growth:copy?previous.growth:1,months:copy?previous.months:12};state.scenarios.push(s);state.selected=s.id;controls();render();stage();}
$('new').onclick=()=>add(false);$('duplicate').onclick=()=>add(true);
$('run').onclick=()=>{const s=selected();if(!base||!valid(s))return;const d=new Date(base.date+'T00:00:00Z');s.result={at:new Date().toISOString(),baseline:base,assumptions:assumptions(s),inputsHash:studio.context.inputsHash,codeHash:studio.context.codeHash,rows:Array.from({length:s.months},(_,i)=>({date:new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+i+2,0)).toISOString().slice(0,10),mrr:base.mrr*(1+s.growth/100)**(i+1)}))};render();stage();};
$('save-table').onclick=()=>{
 const s=selected(),r=s.result;if(!r)return;const used=JSON.parse(r.assumptions);
 studio.saveResultsAsTable({suggestedName:'scenario_revenue',description:s.name+' · Run '+when(r.at)+(stale(s)?' · Outdated result: '+changes(s).join(', '):''),
 columns:[['scenario_id','string'],['scenario_name','string'],['run_id','string'],['run_at','timestamp'],['month','date'],['forecast_mrr','number'],['growth_pct','number'],['periods','number'],['baseline_date','date'],['baseline_mrr','number'],['input_hash','string'],['code_hash','string'],['outdated_at_export','boolean']].map(([name,type])=>({name,type})),
 rows:r.rows.map(row=>({scenario_id:s.id,scenario_name:s.name,run_id:s.id+':'+r.at,run_at:r.at,month:row.date,forecast_mrr:row.mrr,growth_pct:used.growth,periods:used.months,baseline_date:r.baseline.date,baseline_mrr:r.baseline.mrr,input_hash:r.inputsHash,code_hash:r.codeHash,outdated_at_export:!!stale(s)}))});
};
controls();render();
