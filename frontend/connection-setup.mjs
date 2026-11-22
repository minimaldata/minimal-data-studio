// Reuse the live form controls: moving between steps never discards user input.
export function mountConnectionSetup(host,{form,steps,save,error,busy=()=>false,review=()=>[]}){
 const el=(tag,text)=>Object.assign(document.createElement(tag),{textContent:text||''});
 const root=el('div');root.className='postgres-setup connection-setup';
 const track=el('div');track.className='setup-progress';track.setAttribute('aria-label','Connection setup progress');
 const progress=el('p');progress.className='remote-note';progress.setAttribute('aria-live','polite');
 const heading=el('h4');heading.tabIndex=-1;
 const all=[...steps,{title:'Review',help:'Use Test connection to check browsing access before saving. Save connection keeps these settings on this Mac. Credentials stay outside your project.',nodes:[]}];
 let current=0;const visited=new Set();
 const markers=all.map((step,i)=>{const button=el('button',String(i+1));button.type='button';button.title=step.title;button.onclick=()=>navigate(i);track.append(button);return button;});
 const panels=all.map(step=>{const panel=el('section');panel.setAttribute('aria-label',step.title+' setup');const help=el('p',step.help);help.className='remote-note';panel.append(help,...step.nodes);return panel;});
 const summary=el('dl');summary.className='connection-review';panels.at(-1).append(summary);
 const notices=panels.map(panel=>{const note=el('p');note.className='setup-validation';note.setAttribute('role','status');panel.append(note);return note;});
 const back=el('button','Back'),next=el('button','Next');back.type=next.type='button';next.className='primary';save.parentElement.prepend(back,next);
 function refresh(){
  const invalid=panels.map((panel,i)=>{
   let count=0;for(const field of panel.querySelectorAll('input,select')){
    const bad=!field.matches(':disabled')&&!field.validity.valid;
    if(bad)count++;
    if(bad&&(visited.has(i)||current===steps.length))field.setAttribute('aria-invalid','true');else field.removeAttribute('aria-invalid');
   }
   return count>0;
  });
  markers.forEach((marker,i)=>{
   const bad=invalid[i]&&(visited.has(i)||current===steps.length);
   marker.dataset.invalid=String(bad);marker.dataset.complete=String(i<steps.length&&!invalid[i]&&visited.has(i));
   marker.setAttribute('aria-label',`Step ${i+1}: ${all[i].title}${bad?' — Needs attention':''}`);
   notices[i].textContent=bad?'Complete the highlighted fields.':'';
  });
  const missing=invalid.some(Boolean);save.disabled=missing||busy();
  if(current===steps.length){
   notices.at(-1).textContent=missing?'Before saving, complete: '+steps.filter((_,i)=>invalid[i]).map(step=>step.title).join(', ')+'. Select its numbered step to return to it.':busy()?'Wait for the current account or certificate operation to finish.':'';
   summary.replaceChildren();for(const [label,value] of review())summary.append(el('dt',label),el('dd',String(value||'Not completed')));
  }
  return !missing&&!busy();
 }
 function navigate(index){visited.add(current);current=index;error.textContent='';show(true);}
 function show(focus=false){
  panels.forEach((panel,i)=>panel.hidden=i!==current);
  markers.forEach((marker,i)=>{if(i===current)marker.setAttribute('aria-current','step');else marker.removeAttribute('aria-current');});
  progress.textContent=`Step ${current+1} of ${all.length}`;heading.textContent=all[current].title;
  back.disabled=current===0;next.hidden=current===steps.length;save.hidden=current!==steps.length;refresh();
  if(focus){heading.focus({preventScroll:true});(host.closest('.setup-scroll')||host.closest('dialog')).scrollTop=0;}
 }
 back.onclick=()=>navigate(Math.max(0,current-1));next.onclick=()=>navigate(Math.min(steps.length,current+1));
 root.append(track,progress,heading,...panels);host.append(root);
 form.noValidate=true;form.addEventListener('input',refresh);form.addEventListener('change',refresh);form.addEventListener('connection-setup-change',refresh);show();
 return {reviewPanel:panels.at(-1),refresh,submit(){if(current!==steps.length){navigate(current+1);return false;}return refresh();}};
}
