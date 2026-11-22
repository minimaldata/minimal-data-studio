// Keep checkbox edits separate from the rendered/saved chart until Apply.
export function chartMeasurePicker(columns, selected, onApply) {
  const details=document.createElement('details'),summary=document.createElement('summary'),menu=document.createElement('div');
  details.className='chart-measures';menu.className='menu';
  summary.textContent=(selected.join(', ')||'choose…')+' ▾';
  const inputs=columns.map(name=>{
    const row=document.createElement('label'),input=document.createElement('input');
    input.type='checkbox';input.checked=selected.includes(name);
    row.append(input,document.createTextNode(name));menu.append(row);
    input.onchange=()=>refresh();return {name,input};
  });
  const actions=document.createElement('div');actions.className='chart-measure-actions';
  const cancel=document.createElement('button'),apply=document.createElement('button');
  cancel.type=apply.type='button';cancel.textContent='Cancel';apply.textContent='Apply';apply.className='primary';
  const values=()=>inputs.filter(x=>x.input.checked).map(x=>x.name);
  const refresh=()=>{const next=values();apply.disabled=!next.length||(next.length===selected.length&&next.every(n=>selected.includes(n)));};
  const reset=()=>{inputs.forEach(({name,input})=>input.checked=selected.includes(name));refresh();};
  cancel.onclick=()=>{reset();details.open=false;summary.focus();};
  apply.onclick=()=>{if(apply.disabled)return;const next=values();details.open=false;onApply(next);};
  details.addEventListener('toggle',()=>{if(!details.open)reset();});
  details.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();cancel.click();}});
  if(columns.length){actions.append(cancel,apply);menu.append(actions);}else menu.textContent='No number columns';
  refresh();details.append(summary,menu);return details;
}
