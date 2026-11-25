// Controls operate on an explicit input snapshot; never query on slider movement.
const $=id=>document.getElementById(id), state=studio.state;
const number=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
const money=v=>number(v)===null?'—':Number(v).toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});
const count=v=>number(v)===null?'—':Number(v).toLocaleString('en-US',{maximumFractionDigits:0});
const pct=v=>number(v)===null?'—':Number(v).toFixed(1)+'%';
const date=v=>String(v).slice(0,10), label=v=>new Date(v+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',year:'numeric',timeZone:'UTC'});
const rows=(studio.inputs.monthly||[]).slice().sort((a,b)=>date(a.month_end).localeCompare(date(b.month_end)));
const months=rows.map(r=>date(r.month_end));
const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
if(!months.includes(state.month))state.month=months.at(-1)||'';
if(![6,12,24,120].includes(state.window))state.window=12;
if(!['mrr_usd','active_accounts','total_cash_collected_usd'].includes(state.metric))state.metric='mrr_usd';
$('month').replaceChildren(...months.map(m=>new Option(label(m),m)));$('month').value=state.month;
$('timeline').max=Math.max(0,rows.length-1);$('timeline').value=Math.max(0,months.indexOf(state.month));
$('window').value=state.window;$('metric').value=state.metric;$('notes').value=state.notes||'';
const stage=()=>studio.saveState({...state,version:1});
function choose(month){state.month=month;$('month').value=month;$('timeline').value=months.indexOf(month);render();stage();}
$('month').onchange=e=>choose(e.target.value);$('timeline').oninput=e=>choose(months[Number(e.target.value)]);
$('window').onchange=e=>{state.window=Number(e.target.value);render();stage();};$('metric').onchange=e=>{state.metric=e.target.value;render();stage();};
$('notes').oninput=e=>{state.notes=e.target.value;stage();};
function card(title,value,detail){const box=el('article',undefined,'kpi');box.append(el('h2',title),el('strong',value),el('small',detail));$('kpis').append(box);}
function chart(selected){
 const host=$('trend');host.replaceChildren();const i=months.indexOf(state.month),visible=rows.slice(Math.max(0,i-state.window+1),i+1), metric=state.metric;
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 1000 265');svg.setAttribute('role','img');svg.setAttribute('aria-label',$('metric').selectedOptions[0].text+' through '+label(state.month));host.append(svg);
 const add=(tag,attrs,text)=>{const n=document.createElementNS(svg.namespaceURI,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;svg.append(n);return n;};
 const values=visible.map(r=>number(r[metric])).filter(v=>v!==null), low=Math.min(0,...values), high=Math.max(1,...values), x=j=>90+j/(visible.length-1||1)*870,y=v=>210-(v-low)/(high-low)*180;
 for(let j=0;j<=4;j++){const v=low+(high-low)*j/4;add('line',{x1:90,x2:960,y1:y(v),y2:y(v),stroke:'var(--line)'});add('text',{x:80,y:y(v)+4,'text-anchor':'end'},(metric==='active_accounts'?'':'$')+Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(v));}
 let path='',connected=false;visible.forEach((r,j)=>{const v=number(r[metric]);if(v===null){connected=false;return;}path+=(connected?'L':'M')+x(j)+','+y(v);connected=true;});add('path',{d:path,fill:'none',stroke:'var(--blue)','stroke-width':3});
 visible.forEach((r,j)=>{const v=number(r[metric]);if(v===null)return;const circle=add('circle',{cx:x(j),cy:y(v),r:4,fill:'var(--blue)',tabindex:0,role:'button','aria-label':label(date(r.month_end))+': '+(metric==='active_accounts'?count(v):money(v))});const title=document.createElementNS(svg.namespaceURI,'title');title.textContent=circle.getAttribute('aria-label');circle.append(title);circle.onclick=()=>choose(date(r.month_end));circle.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose(date(r.month_end));}};});
 [...new Set([0,Math.floor((visible.length-1)/2),visible.length-1])].filter(j=>j>=0).forEach(j=>add('text',{x:x(j),y:245,'text-anchor':j===0?'start':j===visible.length-1?'end':'middle'},label(date(visible[j].month_end))));
 $('data').replaceChildren(...visible.map(r=>{const tr=el('tr');[label(date(r.month_end)),money(r.mrr_usd),count(r.active_accounts),money(r.total_cash_collected_usd),pct(r.nrr_12m_pct)].forEach(v=>tr.append(el('td',v)));return tr;}));
}
function render(){
 $('empty').hidden=rows.length>0;$('content').hidden=!rows.length;for(const id of ['month','timeline','window'])$(id).disabled=!rows.length;if(!rows.length)return;
 const row=rows[months.indexOf(state.month)];$('headline').textContent=label(state.month)+' · '+count(row.active_accounts)+' active accounts · '+money(row.arr_usd)+' annualized recurring run rate';
 const meta=studio.context.inputMetadata?.monthly;$('freshness').textContent='Loaded snapshot'+(meta?.refreshedAt?' · Refreshed '+new Date(meta.refreshedAt).toLocaleString():'')+' · Controls use loaded data; refresh SQL in Data inputs. Save document to retain this view.';
 $('kpis').replaceChildren();card('Monthly recurring revenue',money(row.mrr_usd),'Month over month: '+pct(row.mrr_growth_mom_pct));card('Active accounts',count(row.active_accounts),'Monthly logo churn: '+pct(row.logo_churn_monthly_pct));card('12-month net retention',pct(row.nrr_12m_pct),'Same starting customer cohort · revenue weighted');card('Cash collected',money(row.total_cash_collected_usd),'Payments received in this month · all products');
 chart(row);const bridge=(studio.inputs.bridge||[]).find(r=>date(r.month_end)===state.month);$('bridge').replaceChildren();$('bridge-summary').textContent=bridge?'Net new MRR '+money(bridge.net_new_mrr_usd)+' · Ending '+money(bridge.ending_mrr_usd):'No movement data for this month.';
 if(bridge){const parts=[['New accounts','new_mrr_usd',1],['Reactivation','reactivation_mrr_usd',1],['Expansion','expansion_mrr_usd',1],['Contraction','contraction_mrr_usd',-1],['Churn','churned_mrr_usd',-1]],max=Math.max(1,...parts.map(([,key])=>Math.abs(number(bridge[key])||0)));
 for(const [name,key,sign]of parts){const value=number(bridge[key]),r=el('div',undefined,'movement'),track=el('div',undefined,'bar-track'),bar=el('div',undefined,'bar '+(sign>0?'positive':'negative'));bar.style.width=(value===null?0:Math.abs(value)/max*100)+'%';track.append(bar);r.append(el('span',name),track,el('span',value===null?'—':(sign>0?'+':'−')+money(Math.abs(value))));$('bridge').append(r);}}
 $('efficiency').replaceChildren();for(const [name,value]of [['New customers',count(row.new_customers)],['Blended CAC',money(row.blended_cac_usd)],['Estimated payback',number(row.estimated_payback_months)===null?'—':Number(row.estimated_payback_months).toFixed(1)+' months']])$('efficiency').append(el('dt',name),el('dd',value));
 const mix=(studio.inputs.mix||[]).filter(r=>date(r.month_end)===state.month),total=r=>(number(r.workspace_mrr_usd)||0)+(number(r.analytics_mrr_usd)||0);mix.sort((a,b)=>total(b)-total(a));const max=Math.max(1,...mix.map(total));$('mix').replaceChildren();if(!mix.length)$('mix').textContent='No product mix available for this month.';
 for(const m of mix){const r=el('div',undefined,'mix-row'),track=el('div',undefined,'mix-track');for(const [key,cls]of [['workspace_mrr_usd','workspace'],['analytics_mrr_usd','analytics']]){const bar=el('div',undefined,cls);bar.style.width=((number(m[key])||0)/max*100)+'%';bar.title=cls+': '+money(m[key]);track.append(bar);}r.append(el('span',m.employee_band||'Unclassified'),track,el('span',money(total(m))));$('mix').append(r);}
}
render();
