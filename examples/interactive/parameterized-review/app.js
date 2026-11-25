const $=id=>document.getElementById(id), state=studio.state;
$('from').value=studio.context.parameters.from_date;$('minimum').value=studio.context.parameters.minimum_amount;
$('stage').onclick=()=>{
 const amount=Number($('minimum').value),date=$('from').value;
 if(!date||$('minimum').value===''||!Number.isFinite(amount)){$('status').textContent='Enter a date and numeric amount.';return;}
 studio.setInputParameters({from_date:date,minimum_amount:amount});
 $('status').textContent='Staged. Open Data inputs and choose Apply & refresh inputs. The loaded table has not changed.';
};
const rows=studio.inputs.payments||[],meta=studio.context.inputMetadata.payments;
$('provenance').textContent=meta?`${rows.length} rows · Refreshed ${new Date(meta.refreshedAt).toLocaleString()} · Applied parameters: ${JSON.stringify(meta.parameters)}`:'No snapshot. Refresh Data inputs to load the synthetic example.';
for(const value of rows){const row=document.createElement('tr');for(const text of [value.paid_date,Number(value.amount).toLocaleString('en-US',{style:'currency',currency:'USD'})]){const cell=document.createElement('td');cell.textContent=text;row.append(cell);}$('rows').append(row);}
$('notes').value=state.notes||'';$('notes').oninput=()=>{state.notes=$('notes').value;studio.saveState(state);};
