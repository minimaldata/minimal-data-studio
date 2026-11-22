import {mountPostgresGuidance} from './postgres-guidance.mjs';
// A guided view over the same validated connection form; no separate file format.
export function mountPostgresSetup(host,{form,name,settings,serviceMode,save,error}){
 const el=(tag,text)=>Object.assign(document.createElement(tag),{textContent:text||''});
 const {sections}=settings;
 const steps=[
  ['Database','Enter your PostgreSQL connection details.',sections.database],
  ['Database password','Choose the database password from Credentials. Use the database password, not a tool’s master password or an SSH key passphrase.',sections.password],
  ['SSH tunnel','Choose an SSH tunnel only if required.',[sections.ssh]],
  ['Server certificate','Studio verifies the database server’s TLS certificate, including through an SSH tunnel.',[sections.certificate,sections.advanced]],
  ['Review','Studio will save this connection on this Mac. No service-profile file to write, no Terminal commands, and no passwords in your project.',[]]
 ];
 const root=el('div');root.className='postgres-setup';
 const progress=el('p');progress.className='remote-note';progress.setAttribute('aria-live','polite');
 const track=el('div');track.className='setup-progress';track.setAttribute('aria-label','Connection setup progress');
 const markers=steps.map(([label],i)=>{const item=el('button',String(i+1));item.type='button';item.onclick=()=>navigate(i);item.title=label;item.setAttribute('aria-label',`Step ${i+1}: ${label}`);track.append(item);return item;});
 const title=el('h4');title.tabIndex=-1;
 const panels=steps.map(([label,help,nodes])=>{const panel=el('section');panel.setAttribute('aria-label',label+' setup');const hint=el('p',help);hint.className='remote-note';panel.append(hint,...nodes.filter(Boolean));return panel;});
 const review=el('dl');review.className='connection-review';panels[4].append(review,el('p','Use Test connection to check browsing access before saving. First use may ask for SSH fingerprint and credential approval in the Mac app.'));
 const actions=el('div');actions.className='remote-actions';const back=el('button','Back'),next=el('button','Next');back.type=next.type='button';next.className='primary';actions.append(back,next);
 const notices=panels.map(panel=>{const note=el('p');note.className='setup-validation';note.setAttribute('role','status');panel.append(note);return note;});
 let current=0;
 const visited=new Set();
 const inspect=()=>{
  const issues=panels.map(()=>[]);
  panels.forEach((panel,i)=>{
   const fields=[...panel.querySelectorAll('input,select'),...(i===0?[name]:[])];
   for(const field of fields){const invalid=!field.validity.valid&&!field.matches(':disabled');
    if(invalid)issues[i].push(field);
    if(invalid&&(visited.has(i)||current===4))field.setAttribute('aria-invalid','true');else field.removeAttribute('aria-invalid');
   }
  });
  let config,configError='';try{config=settings.value();}catch(e){configError=e.message;issues[2].push(null);}
  markers.forEach((marker,i)=>{
   const invalid=issues[i].length>0;
   marker.dataset.invalid=String(invalid&&(visited.has(i)||current===4));
   marker.dataset.complete=String(i<4&&!invalid&&visited.has(i));
   marker.setAttribute('aria-label',`Step ${i+1}: ${steps[i][0]}${marker.dataset.invalid==='true'?' — Needs attention':''}`);
   notices[i].textContent=invalid&&(visited.has(i)||current===4)?(i===2&&configError?configError:'Complete the highlighted fields.'):'';
  });
  const missing=issues.slice(0,4).some(list=>list.length);
  save.disabled=!serviceMode.checked&&(missing||settings.busy);
  if(current===4){
   notices[4].textContent=missing?'Before saving, complete: '+steps.filter((_,i)=>issues[i].length).map(step=>step[0]).join(', ')+'. Select its numbered step to return to it.':'';
   review.replaceChildren();
   const c=config||{};
   for(const [label,value] of [['Name',name.value],['Database',c.host?`${c.host}:${c.port} / ${c.database}`:''],['Username',c.user],['Password',c.credentialId?settings.credentialName():''],['SSH',configError?'Needs attention':c.sshHost?`${c.sshUser}@${c.sshHost}:${c.sshPort}`:'Not used'],['Private key',c.sshKeyPath||'Not used'],['Key passphrase',c.sshPassphraseId?'Selected from Credentials':'Not used'],['Certificate',c.sslrootcert||'Public CA trust']])review.append(el('dt',label),el('dd',value||'Not completed'));
  }
  return !missing;
 };
 const show=(focus=false)=>{
  markers.forEach((marker,i)=>{if(i===current)marker.setAttribute('aria-current','step');else marker.removeAttribute('aria-current');});
  panels.forEach((panel,i)=>panel.hidden=i!==current);progress.textContent=`Step ${current+1} of ${steps.length}`;title.textContent=steps[current][0];back.disabled=current===0;next.hidden=current===4;save.hidden=!serviceMode.checked&&current!==4;
  inspect();
  if(focus){title.focus({preventScroll:true});const scroller=host.closest('.setup-scroll')||host.closest('dialog');if(scroller)scroller.scrollTop=0;}
 };
 function navigate(index){visited.add(current);error.textContent='';current=index;show(true);}
 back.onclick=()=>navigate(Math.max(0,current-1));next.onclick=()=>navigate(Math.min(4,current+1));
 form.addEventListener('input',inspect);form.addEventListener('change',inspect);form.addEventListener('connection-setup-change',inspect);
 serviceMode.addEventListener('change',()=>{save.hidden=!serviceMode.checked&&current!==4;inspect();});
 mountPostgresGuidance(root,guidance=>{panels[0].querySelector('p').textContent=guidance.database;panels[2].querySelector('p').textContent=guidance.ssh;panels[3].querySelector('p').textContent=guidance.certificate;});
 root.append(track,progress,title,...panels,actions);host.replaceChildren(root);if(sections.ssh)sections.ssh.open=true;
 form.noValidate=true;show();
 return {reviewPanel:panels[4],refresh:inspect,submit(){if(serviceMode.checked)return form.reportValidity();if(current!==4){navigate(current+1);return false;}return inspect()&&!settings.busy;}};
}
