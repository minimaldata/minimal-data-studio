// Only paths and credential IDs leave this form; key bytes stay on the Mac.
export function mountSSHSettings(host,{existing,request}){
 const el=(tag,text)=>Object.assign(document.createElement(tag),{textContent:text||''});
 const details=el('details');details.open=Boolean(existing?.sshHost);details.append(el('summary','SSH tunnel · optional'));
 const label=el('label','Connect through an SSH server'),enabled=el('input');enabled.type='checkbox';enabled.checked=Boolean(existing?.sshHost);label.prepend(enabled);details.append(label);
 const body=el('div'),fields={};
 for(const [key,title,fallback] of [['sshHost','SSH host',''],['sshPort','SSH port',22],['sshUser','SSH username','']]){
  const row=el('label',title),input=el('input');input.value=existing?.[key]??fallback;input.required=true;
  if(key==='sshPort'){input.type='number';input.min='1';input.max='65535';}
  row.append(input);body.append(row);fields[key]=input;
 }
 let keyPath=existing?.sshKeyPath||'',busy=false;
 const chosen=el('p',keyPath||'No private key selected'),choose=el('button','Choose private key…');choose.type='button';chosen.style.overflowWrap='anywhere';chosen.setAttribute('role','status');
 choose.onclick=async()=>{busy=true;choose.disabled=true;choose.dispatchEvent(new Event('connection-setup-change',{bubbles:true}));try{const result=await request('choose-ssh-key');if(result.path){keyPath=result.path;chosen.textContent=keyPath;}}catch(error){chosen.textContent=error.message;}finally{busy=false;choose.disabled=false;choose.dispatchEvent(new Event('change',{bubbles:true}));}};
 body.append(choose,chosen,el('p','Choose the private key for your SSH server, often in ~/.ssh. No .pem extension is needed. The file stays on this Mac.'));
 const passLabel=el('label','SSH key passphrase in Credentials'),pass=el('select');passLabel.append(pass);body.append(passLabel);
 const refresh=el('button','Refresh passphrases'),manage=el('button','Manage credentials…');refresh.type=manage.type='button';
 const note=el('p','Only needed for an encrypted private key. Click Manage credentials to add the key’s passphrase, then Refresh passphrases and choose it in SSH key passphrase in Credentials. Leave No passphrase selected for an unencrypted key. This is separate from the database password.');note.setAttribute('role','status');
 async function load(){const selected=pass.value||existing?.sshPassphraseId||'';try{const data=await request('credentials');pass.replaceChildren(new Option('No passphrase',''));for(const c of data.credentials)pass.add(new Option(c.name,c.id));pass.value=selected;if(selected&&!pass.value){pass.add(new Option('Unavailable credential',selected));pass.value=selected;}}catch(error){note.textContent=error.message;}finally{pass.dispatchEvent(new Event('connection-setup-change',{bubbles:true}));}}
 manage.onclick=async()=>{try{await request('manage-credentials');note.textContent='Save the SSH key’s passphrase in the Mac app, then click Refresh passphrases and choose it in SSH key passphrase in Credentials.';}catch(error){note.textContent=error.message;}};
 const actions=el('div');actions.className='google-profile-actions';actions.append(manage,refresh);
 refresh.onclick=load;body.append(actions,note,el('p','Keep the actual database hostname in the Database host field. Studio verifies that server’s TLS certificate through the tunnel. The Mac app asks you to verify the SSH server fingerprint on first use.'));
 const sync=()=>{body.hidden=!enabled.checked;body.querySelectorAll('input,select,button').forEach(input=>input.disabled=!enabled.checked);if(enabled.checked)load();};enabled.onchange=sync;
 details.append(body);host.append(details);sync();
 return {element:details,get busy(){return busy;},value(){if(!enabled.checked)return {};if(!keyPath)throw Error('Choose an SSH private key.');return {sshHost:fields.sshHost.value,sshPort:Number(fields.sshPort.value),sshUser:fields.sshUser.value,sshKeyPath:keyPath,sshPassphraseId:pass.value};}};
}
