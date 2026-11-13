import {setLoading} from './loading.mjs';
/** Google account profile controls. Only metadata crosses this transport. */
import {anchorEditorSelect} from './editor-select.mjs';
const el=(tag,text)=>Object.assign(document.createElement(tag),text===undefined?{}:{textContent:text});
export function mountGoogleProfiles(host,{request,selected='',onBusy=()=>{}}){
  let profiles=[],busy=true;
  const label=el('label','Authentication profile'),select=el('select');select.setAttribute('aria-label','Google authentication profile');label.append(select);
  const identity=el('p'),note=el('p','Profiles stay on this Mac and can be reused across projects. Each connection uses its selected account; signing in here does not change Terminal’s default ADC.'),status=el('p');
  note.className=identity.className='remote-note';status.className='remote-note';status.setAttribute('role','status');
  const manage=el('details'),title=el('summary','Add or reconnect an account');manage.append(title);
  const nameLabel=el('label','Profile name'),name=el('input');name.placeholder='e.g. Work or Client A';name.maxLength=100;nameLabel.append(name);
  const buttons=el('div');buttons.className='google-profile-actions';
  const login=el('button','Add Google account…'),copy=el('button','Use current ADC as a profile'),reconnect=el('button','Reconnect selected account…'),refresh=el('button','Refresh profiles');
  for(const button of [login,copy,reconnect,refresh]){button.type='button';buttons.append(button);}
  manage.append(nameLabel,buttons,el('p','Google sign-in opens your browser. Tokens stay outside your project and are never shown here. The Google Cloud CLI is required for new sign-ins.'));
  host.append(label,identity,note,manage,status);
  function describe(){
    const p=profiles.find(p=>p.id===select.value);
    identity.textContent=p?'Google account: '+p.account:select.value?'Profile unavailable on this Mac. Choose another account or add it here.':'System ADC is shared. Its account is not verified here; create a profile to pin this connection to an account.';
    reconnect.disabled=busy||!p;
  }
  async function load(value=select.value||selected){
    const data=await request('google-profiles');profiles=data.profiles;
    select.replaceChildren(new Option('System ADC (shared default)',''));
    for(const p of profiles)select.add(new Option(p.name+' · '+p.account,p.id));
    if(value&&!profiles.some(p=>p.id===value))select.add(new Option('Unavailable profile',value));
    select.value=value;describe();
  }
  function setBusy(value){setLoading(status,value);busy=value;onBusy(value);for(const button of [login,copy,reconnect,refresh])button.disabled=value;select.disabled=value;name.disabled=value;describe();}
  async function start(mode,profile){
    if(busy)return;
    if(!profile&&!name.value.trim()){status.textContent='Enter a profile name first.';name.focus();return;}
    setBusy(true);status.textContent=mode==='import'?'Verifying the current ADC account…':'Complete Google sign-in in your browser. Waiting up to five minutes…';
    try{
      const job=await request('google-profile-start',{mode,name:profile?.name||name.value.trim(),...(profile?{profile:profile.id}:{})});
      while(host.isConnected){
        const data=await request('google-profile-status',{id:job.id});
        if(data.state==='error')throw Error(data.error);
        if(data.state==='done'){await load(data.profile.id);status.textContent='Verified '+data.profile.account+'. Save the connection to use this profile.';name.value='';break;}
        await new Promise(resolve=>setTimeout(resolve,750));
      }
    }catch(error){status.textContent=error.message;}
    finally{setBusy(false);}
  }
  select.onchange=describe;login.onclick=()=>start('login');copy.onclick=()=>start('import');reconnect.onclick=()=>start('login',profiles.find(p=>p.id===select.value));
  refresh.onclick=()=>load().catch(error=>{status.textContent=error.message;});
  // Populate immediately so legacy connections remain editable if the server is old.
  select.add(new Option('System ADC (shared default)',''));if(selected)select.add(new Option('Loading profile…',selected));select.value=selected;select.disabled=true;describe();anchorEditorSelect(select);
  queueMicrotask(()=>onBusy(true));
  load().catch(error=>{status.textContent=error.message;}).finally(()=>setBusy(false));
  return {get value(){return select.value;},get busy(){return busy;}};
}
