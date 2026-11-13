import {setLoading} from './loading.mjs';
const el=(tag,text)=>Object.assign(document.createElement(tag),text===undefined?{}:{textContent:text});
const bytes=n=>n==null?'Unknown':n>=1e9?(n/1e9).toFixed(2)+' GB':(n/1e6).toFixed(1)+' MB';
/** One explicit confirmation followed by a polled, cancellable disk-backed transfer. */
export async function fullTransfer(result,kind,{request,dialog,refresh}){
  const plan=await request('transfer-plan',{id:result.remote.id});
  const {d,form,error,close,field}=dialog('Save full output');
  const choices=el('div');choices.className='remote-actions';choices.style.justifyContent='flex-start';choices.style.gap='20px';form.append(choices);
  const options=[['csv','CSV'],['table','DuckDB table'],['both','Both']];
  const radios=options.map(([value,text])=>{
    const label=el('label'),input=el('input');input.type='radio';input.name='output-kind';input.value=value;input.checked=value==='csv';input.style.width='auto';
    label.style.display='flex';label.style.flexDirection='row';label.style.alignItems='center';label.style.gap='6px';label.append(input,document.createTextNode(text));choices.append(label);return input;
  });
  const csvName=field('CSV filename','query_result.csv'),tableName=field('DuckDB table name','query_result');
  const destination=el('p');destination.className='remote-note';form.append(destination);
  const updateDestination=()=>{
    kind=radios.find(r=>r.checked).value;
    csvName.disabled=kind==='table';tableName.disabled=kind==='csv';
    csvName.required=!csvName.disabled;tableName.required=!tableName.disabled;
    csvName.parentElement.hidden=csvName.disabled;tableName.parentElement.hidden=tableName.disabled;
    destination.textContent=kind==='both'?'One download, saved to Files / exports and Local DuckDB.':kind==='csv'?'Destination: Files / exports':'Destination: Local DuckDB';
  };
  radios.forEach(r=>r.onchange=updateDestination);updateDestination();
  form.append(el('p',plan.rows==null?'Full row count: unknown.':plan.rows.toLocaleString()+' rows in the full result.'));
  form.append(el('p',plan.estimatedBytes==null?'Size is unknown until data arrives.':'Rough uncompressed size: '+bytes(plan.estimatedBytes)+'. Estimated from the preview; actual size may differ.'));
  const budget=field('Transfer budget (GB)','1');budget.type='number';budget.min='.001';budget.max='100';budget.step='.001';budget.required=true;
  form.append(el('p','Stops without publishing a partial file or table if this budget is exceeded. This limits downloaded data/output size, not warehouse bytes scanned. Query cost and timeout settings still apply.'));
  const retrieval=el('p',plan.retrieval);retrieval.className=plan.rerun?'remote-error':'remote-note';form.append(retrieval);
  let consent;
  if(plan.rerun){const label=el('label');consent=el('input');consent.type='checkbox';consent.required=true;consent.style.width='auto';label.style.display='flex';label.style.flexDirection='row';label.style.alignItems='flex-start';label.style.gap='8px';label.append(consent,document.createTextNode('I understand this SELECT will run again and may return different data.'));form.append(label);}
  const actions=el('div');actions.className='remote-actions';const start=el('button','Start full transfer');start.className='primary';const cancel=el('button','Cancel transfer');cancel.type='button';cancel.hidden=true;
  actions.append(close,cancel,start);form.append(error,actions);
  let running=false,job=null;
  d.oncancel=e=>{if(running)e.preventDefault();};
  cancel.onclick=async()=>{cancel.disabled=true;try{await request('transfer-cancel',{id:job});error.textContent='Cancelling… Waiting for the current batch to stop.';}catch(e){error.textContent=e.message;cancel.disabled=false;}};
  return new Promise(resolve=>{
    d.addEventListener('close',()=>resolve(),{once:true});
    form.onsubmit=async e=>{
      e.preventDefault();if(running)return;
      const maxBytes=Math.round(Number(budget.value)*1e9);
      if(!Number.isFinite(maxBytes)||maxBytes<1e6||maxBytes>1e11){error.textContent='Choose a budget between 0.001 and 100 GB.';return;}
      error.style.color='var(--muted)';running=true;start.disabled=close.disabled=csvName.disabled=tableName.disabled=budget.disabled=true;radios.forEach(r=>r.disabled=true);setLoading(error,true);
      try{
        const first=await request('transfer-start',{id:result.remote.id,kind,csvName:csvName.value.trim(),tableName:tableName.value.trim(),maxBytes,confirmed:true,allowRerun:!!consent?.checked});job=first.id;cancel.hidden=false;cancel.disabled=false;
        for(;;){
          let state;
          try{state=await request('transfer-status',{id:job});}
          catch(e){error.textContent='Connection interrupted. The transfer may still be running; retrying status…';await new Promise(resolve=>setTimeout(resolve,2000));continue;}
          if(state.state==='error'||state.state==='cancelled')throw Error(state.error);
          error.textContent=state.phase+' · '+state.rows.toLocaleString()+' rows · '+bytes(state.bytes)+' / '+bytes(maxBytes);
          if(state.state==='done'){error.style.color='var(--fg)';error.textContent='Saved '+state.rows.toLocaleString()+' rows to '+state.destination+'.';start.hidden=true;close.textContent='Close';await refresh().catch(()=>{});break;}
          await new Promise(resolve=>setTimeout(resolve,500));
        }
      }catch(e){error.style.color='';error.textContent=e.message;}
      finally{running=false;setLoading(error,false);cancel.hidden=true;start.disabled=close.disabled=budget.disabled=false;radios.forEach(r=>r.disabled=false);updateDestination();}
    };
    d.showModal();csvName.focus();csvName.select();
  });
}
