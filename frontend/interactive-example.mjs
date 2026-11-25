export function scenarioDocument() {
 return {id:crypto.randomUUID(),name:'Scenario simulator',
 inputs:{baseline:[{period:'Year 1',revenue:100000}]},state:{},
 html:`<header><small>INTERACTIVE DOCUMENT · SAMPLE</small><h1>Compare growth scenarios</h1><p>Adjust two assumptions, then capture a result. Save in Studio to keep your scenarios and results.</p></header>
 <div class="scenarios"><label>Scenario A · growth %<input id="growthA" type="number" min="-100" max="300" value="10"></label><label>Scenario B · growth %<input id="growthB" type="number" min="-100" max="300" value="20"></label></div>
 <p id="baseline"></p><button id="simulate">Run scenarios</button><p id="status"></p><div id="result"></div>`,
 css:`body{font:16px system-ui;color:#e5e7eb;background:#191b1e;margin:0;padding:32px;max-width:900px}small{color:#8da9df;letter-spacing:.08em}h1{font-size:26px}p{color:#b3b9c5;line-height:1.5}.scenarios{display:flex;gap:24px;margin:28px 0}label{display:grid;gap:10px;flex:1}input,button{font:inherit;padding:12px;border-radius:8px;border:1px solid #424956;background:#252a32;color:inherit}button{background:#355ca0;cursor:pointer}table{border-collapse:collapse;width:100%;margin-top:24px}td,th{text-align:right;padding:12px;border-bottom:1px solid #424956}td:first-child,th:first-child{text-align:left}`,
 javascript:`const a=document.querySelector('#growthA'), b=document.querySelector('#growthB');
const state=studio.state;
a.value=state.a??10;b.value=state.b??20;
const base=Number(studio.inputs.baseline?.[0]?.revenue);
const signature=()=>JSON.stringify({a:Number(a.value),b:Number(b.value),baseline:studio.inputs.baseline});
const money=n=>n.toLocaleString(undefined,{maximumFractionDigits:0});
function render(){
 document.querySelector('#baseline').textContent=Number.isFinite(base)?'Starting revenue: '+money(base):'Input baseline needs a first row with a numeric revenue column.';
 document.querySelector('#simulate').disabled=!Number.isFinite(base);
 document.querySelector('#status').textContent=state.result?(state.result.signature===signature()?'Result matches these inputs.':'Inputs changed — run again to update the result.'):'No result yet.';
 const host=document.querySelector('#result');host.replaceChildren();
 if(state.result){const table=document.createElement('table');for(const row of [['Year','Scenario A','Scenario B'],...state.result.rows]){const tr=document.createElement('tr');for(const v of row){const td=document.createElement('td');td.textContent=typeof v==='number'?money(v):v;tr.append(td);}table.append(tr);}host.append(table);}
}
function changed(){state.a=Number(a.value);state.b=Number(b.value);studio.saveState(state);render();}
a.oninput=b.oninput=changed;
document.querySelector('#simulate').onclick=()=>{state.a=Number(a.value);state.b=Number(b.value);state.result={signature:signature(),at:new Date().toISOString(),rows:Array.from({length:5},(_,i)=>['Year '+(i+1),base*(1+state.a/100)**(i+1),base*(1+state.b/100)**(i+1)])};studio.saveState(state);render();};
render();`};
}
