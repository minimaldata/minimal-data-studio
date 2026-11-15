// Supabase is a Postgres preset. Only metadata and a Keychain reference leave this form.
export function mountSupabaseSettings(host,{existing,request}){
 const el=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
 host.append(el('summary','Supabase connection'));
 const fields={};
 for(const [key,label,value] of [['host','Database host',''],['database','Database','postgres'],['user','Database username','']]){
  const l=el('label',label),i=el('input');i.value=existing?.[key]??value;i.required=true;i.autocomplete='off';l.append(i);host.append(l);fields[key]=i;
 }
 const label=el('label','Database password in Keychain'),select=el('select');select.required=true;label.append(select);host.append(label);
 const status=el('p');status.className='remote-note';status.setAttribute('role','status');
 const manage=el('button','Manage credentials…'),refresh=el('button','Refresh credentials');manage.type=refresh.type='button';
 async function load(){
  const selected=select.value||existing?.credentialId||'';refresh.disabled=true;
  try{const data=await request('credentials');select.replaceChildren(new Option('Choose a database password…',''));for(const c of data.credentials)select.add(new Option(c.name,c.id));select.value=selected;manage.disabled=!data.available;status.textContent=data.error||'Store your database password in Credentials and connect it to this project. API keys and CLI login tokens are not database passwords.';}
  catch(e){status.textContent=e.message;}finally{refresh.disabled=false;}
 }
 manage.onclick=async()=>{try{await request('manage-credentials');status.textContent='Add/connect your database password in the Mac app, then refresh this list.';}catch(e){status.textContent=e.message;}};refresh.onclick=load;
 host.append(manage,refresh,status);
 const certificate=el('section');certificate.className='supabase-certificate';
 certificate.append(el('strong','Verify the server certificate'),el('p','Studio verifies encrypted connections even when Supabase’s “Enforce SSL” toggle is off. If the server uses Supabase’s CA, select its certificate here.'));
 const instructions=el('a','Download from Supabase → Database Settings → SSL Configuration ↗');instructions.href='https://supabase.com/dashboard';instructions.target='_blank';instructions.rel='noopener noreferrer';certificate.append(instructions);
 const choose=el('button','Choose certificate…');choose.type='button';
 const file=el('input');file.type='file';file.accept='.crt,.pem';file.hidden=true;file.setAttribute('aria-label','Choose CA certificate file');
 let certificatePath=existing?.sslrootcert||'',importing=false;
 const selected=el('p',certificatePath?'Certificate selected: '+certificatePath:'No certificate selected — using public CA trust.');selected.className='remote-note';selected.style.overflowWrap='anywhere';selected.setAttribute('role','status');
 choose.onclick=()=>file.click();
 file.onchange=async()=>{
  const picked=file.files?.[0];if(!picked)return;choose.disabled=true;importing=true;
  try{if(picked.size>128*1024)throw Error('Choose a certificate under 128 KB.');const result=await request('import-certificate',{certificate:await picked.text()});certificatePath=result.path;selected.textContent=picked.name+' · saved on this Mac. Save connection to use it.';}
  catch(error){selected.textContent=error.message+(certificatePath?' Your previous certificate is unchanged.':'');}
  finally{choose.disabled=false;importing=false;file.value='';}
 };
 certificate.append(choose,file,selected,el('p','Studio keeps a local copy outside your project. You can move the downloaded file afterward.'));host.append(certificate);
 const advanced=el('details');advanced.append(el('summary','Advanced · timeout'));
 const timeoutLabel=el('label','Query timeout (seconds)'),timeout=el('input');timeout.type='number';timeout.min='1';timeout.max='300';timeout.value=existing?.timeoutSeconds||60;timeout.required=true;timeoutLabel.append(timeout);
 advanced.append(timeoutLabel);host.append(advanced);load();
 return {get busy(){return importing;},value:()=>({preset:'supabase',host:fields.host.value,database:fields.database.value,user:fields.user.value,port:5432,credentialId:select.value,sslrootcert:certificatePath,timeoutSeconds:Number(timeout.value)})};
}
