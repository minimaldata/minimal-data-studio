import {mountConnectionReviewTest} from './connection-review-test.mjs';
import {connectionManager} from './connection-manager.mjs';
import {mountConnectionSetup} from './connection-setup.mjs';
import {mountPostgresSetup} from './postgres-setup.mjs';
import {mountConnectionGuide} from './connection-guide.mjs';
import {mountSupabaseSettings} from './supabase-settings.mjs';
import {fullTransfer} from './remote-transfers.mjs';
import {setLoading} from './loading.mjs';
import {jsonRequest,checkedResponse} from './api.mjs';
import {setupRemoteModels} from './remote-models.mjs';
import {mountGoogleProfiles} from './google-profile-settings.mjs';
import {anchorEditorSelect} from './editor-select.mjs';
const providers={bigquery:'BigQuery',snowflake:'Snowflake',postgres:'Postgres',supabase:'Supabase'};
const kind=c=>c?.provider||'bigquery';
const displayKind=c=>kind(c)==='postgres'&&c?.preset==='supabase'?'supabase':kind(c);
const element=(tag,text,cls)=>Object.assign(document.createElement(tag),{...(text!==undefined?{textContent:text}:{}),...(cls?{className:cls}:{})});
export function setupRemoteSources({getSession,getTab,changed,openQuery,getCode,setCode,tableFromIPC,refreshSchema}) {
  let state={revision:0,connections:[]},currentJob=null,transferBusy=false;
  const connectionPhases=new Map();
  const request=(action,data={})=>jsonRequest('/remote/'+action,{...data,session:getSession()?.session});
  const models=setupRemoteModels({request,dialog,getTab,getCode,setCode,openQuery,changed:()=>{render();changed();},wait,connections:()=>state.connections});
  const host=document.getElementById('externalConnections'),selectHost=document.getElementById('connectionControl');
  const statusText={idle:'Not connected',working:'Working…',credentials:'Check the Mac app for credential approval or a code prompt.',mfa_push:'Signing in… Check your authenticator for a push if prompted. Cached approval may skip it.',signing_in:'Signing in… Complete any browser or Mac app prompt.',connected:'Connected',error:'Could not complete the request. See the message below.'};
  function showConnectionStatus(id,phase){
    connectionPhases.set(id,phase);
    for(const node of document.querySelectorAll('.remote-connection'))if(node.dataset.connection===id){node.dataset.phase=phase;const name=node.querySelector('.remote-connection-name');if(name)name.title=(node.dataset.name||'')+' · '+(statusText[phase]||statusText.working);}
    for(const node of document.querySelectorAll('.remote-status'))if(node.dataset.connection===id){node.dataset.phase=phase;node.textContent=statusText[phase]||statusText.working;setLoading(node,!['idle','connected','error'].includes(phase));}
  }
  async function withConnectionStatus(id,operation){
    let active=true,polling=false;
    showConnectionStatus(id,'working');
    const poll=async()=>{if(polling||!active)return;polling=true;try{const data=await request('connection-status',{connection:id});if(active&&data.phase!=='idle')showConnectionStatus(id,data.phase);}catch{}finally{polling=false;}};
    const timer=setInterval(poll,500);
    try{const result=await operation();showConnectionStatus(id,'connected');return result;}
    catch(error){showConnectionStatus(id,'error');throw error;}
    finally{active=false;clearInterval(timer);}
  }
  const catalogRequest=data=>withConnectionStatus(data.connection,()=>request('catalog',data));
  function iconButton(label,path){
    const b=element('button',undefined,'remote-icon');b.title=label;b.setAttribute('aria-label',label);
    b.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+path+'"/></svg>';return b;
  }
  function sync(visible=true){
    models.sync(visible);
    const objectTransfers=document.getElementById('objectExternal');if(objectTransfers?.dataset.table)mountObjectTransfers(objectTransfers,objectTransfers.dataset.table);
    document.querySelectorAll('select[aria-label="Notebook SQL connection"]').forEach(s=>s.dispatchEvent(new Event('studio-connections')));
    selectHost.hidden=!visible;selectHost.replaceChildren();
    const label=element('span','Connection','connection-label'),select=element('select');select.setAttribute('aria-label','SQL connection');
    select.add(new Option('Local DuckDB',''));
    for(const c of state.connections)select.add(new Option(providers[displayKind(c)]+' · '+c.name,c.id));
    const id=getTab()?.connection||'';
    if(id&&!state.connections.some(c=>c.id===id))select.add(new Option('Unavailable remote connection',id));
    select.value=id;select.disabled=Boolean(getTab()?.remoteModel);
    select.onchange=()=>{getTab().connection=select.value;changed();};
    selectHost.append(label,select);anchorEditorSelect(select);
  }
  async function load(){state=await request('list');await models.load();render();sync((getTab()?.lang||'sql')==='sql');}
  function dialog(title){
    const d=element('dialog',undefined,'remote-dialog'),form=element('form'),h=element('h3',title),error=element('p','','remote-error');error.setAttribute('role','status');
    d.append(form);form.append(h);document.body.append(d);
    const close=element('button','Cancel');close.type='button';close.onclick=()=>d.close();d.addEventListener('close',()=>d.remove());
    return {d,form,error,close,field:(name,value='')=>{const label=element('label',name),input=element('input');input.value=value;label.append(input);form.append(label);return input;}};
  }
  async function settings(existing,provider='bigquery',preset='',options={}){
    const catalog=await request('connections');
    if(existing?.sharedId){const resolved=catalog.connections.find(c=>c.id===existing.sharedId);if(!resolved){await load();return shared.picker(existing);}existing=resolved;}
    options.central=options.central||Boolean(existing?.id);
    preset=existing?.preset||preset;const supabase=preset==='supabase';
    try{state=await request('list');}catch(e){host.textContent=e.message;return;}
    provider=existing?kind(existing):provider;
    const {d,form,error,close,field}=dialog((existing?'':'Connect ')+(supabase?'Supabase':providers[provider])+(existing?' connection':''));
    if(existing)mountConnectionGuide(form,supabase?'supabase':provider,{open:!existing});
    const name=field('Connection name',existing?.name||'');name.required=true;
    let confirmation;
    if(existing?.id&&existing.projects?.length){
      form.append(element('p','Changes apply to every project using this connection.','remote-note'));
      for(const project of existing.projects)form.append(element('small',project.path));
      const label=element('label','Apply changes to these projects');confirmation=element('input');confirmation.type='checkbox';confirmation.required=true;label.prepend(confirmation);form.append(label);
    }
    const inputs={};
    const definitions={
      bigquery:[['project','Google Cloud project ID',''],['location','Dataset location','US'],['maximumBytesBilled','Maximum bytes billed per query',1000000000]],
      postgres:[],
      snowflake:[['account','Account identifier',''],['user','User',''],['role','Read-only role',''],['warehouse','Warehouse',''],['database','Database',''],['timeoutSeconds','Query timeout (seconds)',60]]
    };
    for(const [key,label,fallback] of definitions[provider]){const input=field(label,String(existing?.[key]??fallback));input.required=true;if(['maximumBytesBilled','timeoutSeconds'].includes(key)){input.type='number';input.min='1';input.max=key==='timeoutSeconds'?'300':'10000000000000';}inputs[key]=input;}
    let authentication,passwordChoice,mfaMethod,googleProfile,supabaseSettings,wizardSetup,wizard,submitting=false,testing=false;
    const auth=element('details');auth.open=true;
    if(supabase){
      supabaseSettings=mountSupabaseSettings(auth,{existing,request});
    }else if(provider==='bigquery'){
      auth.append(element('summary','Google account'));
      googleProfile=mountGoogleProfiles(auth,{request,selected:existing?.authProfile||'',onBusy:busy=>{if(wizard)wizard.refresh?.();else save.disabled=busy;}});
      auth.append(element('p','Existing Terminal setup: gcloud auth application-default login','remote-note'));
    }else if(provider==='snowflake'){
      auth.append(element('summary','Authentication'));
      const methodLabel=element('label','Sign-in method');authentication=element('select');
      authentication.add(new Option('Browser SSO','sso'));authentication.add(new Option('Username/password + MFA','password_mfa'));
      authentication.value=existing?.authentication||'sso';methodLabel.append(authentication);auth.append(methodLabel);
      const sso=element('p','Opens your browser for company SSO. Your administrator must enable SSO for this account.');
      const passwordFields=element('div'),passwordLabel=element('label','Keychain password');passwordChoice=element('select');passwordLabel.append(passwordChoice);
      const mfaLabel=element('label','MFA method');mfaMethod=element('select');
      mfaMethod.add(new Option('Approve a push notification','push'));mfaMethod.add(new Option('Enter a one-time code in the Mac app','passcode'));
      mfaMethod.value=existing?.mfaMethod||'push';mfaLabel.append(mfaMethod);
      const rememberNote=element('p','Studio automatically remembers MFA approval in macOS Keychain when your Snowflake account permits it, for up to four hours. One-time-code mode still asks for a code before connecting.','remote-note');
      const credentialStatus=element('p','','remote-note');credentialStatus.setAttribute('role','status');
      const refresh=element('button','Refresh credentials'),manage=element('button','Manage credentials…');refresh.type=manage.type='button';
      async function credentials(){
        const selected=passwordChoice.value||existing?.credentialId||'';refresh.disabled=true;
        try{const data=await request('credentials');passwordChoice.replaceChildren();passwordChoice.add(new Option('Choose a password…',''));
          for(const c of data.credentials)passwordChoice.add(new Option(c.name,c.id));
          if(selected&&!data.credentials.some(c=>c.id===selected))passwordChoice.add(new Option('Unavailable credential — reconnect in Credentials',selected));
          passwordChoice.value=selected;manage.disabled=!data.available;
          credentialStatus.textContent=data.error||'Add your Snowflake password in Credentials, then refresh this list. Each project asks before using it.';
        }catch(e){credentialStatus.textContent=e.message;}finally{refresh.disabled=false;form.dispatchEvent(new Event('connection-setup-change'));}
      }
      refresh.onclick=credentials;manage.onclick=async()=>{try{await request('manage-credentials');credentialStatus.textContent='Save your password in the Mac app, then click Refresh credentials.';}catch(e){credentialStatus.textContent=e.message;}};
      passwordFields.append(passwordLabel,manage,refresh,mfaLabel,rememberNote,credentialStatus,element('p','The password stays in Keychain. Studio asks for permission before using it for this connection. Snowflake may ask again when approval expires or account policy requires it.','remote-note'));
      authentication.onchange=()=>{passwordFields.hidden=authentication.value!=='password_mfa';sso.hidden=!passwordFields.hidden;passwordChoice.required=!passwordFields.hidden;if(!passwordFields.hidden)credentials();};
      auth.append(sso,passwordFields,element('p','Use a role with SELECT and warehouse/database/schema USAGE. Secondary roles are disabled.','remote-note'));authentication.onchange();
    }else{
      auth.append(element('summary','Postgres connection'));
      const direct=element(existing?'details':'div');direct.open=true;
      const directContainer=element('fieldset');directContainer.style.cssText='border:0;margin:0;padding:0;min-width:0';directContainer.append(direct);
      const directSettings=mountSupabaseSettings(direct,{existing,request,direct:true});
      const advanced=element('details');advanced.open=Boolean(existing?.service);advanced.append(element('summary','Advanced · service profile'));
      const modeLabel=element('label','Use a local service profile'),mode=element('input');mode.type='checkbox';mode.checked=Boolean(existing?.service);modeLabel.prepend(mode);
      const profileLabel=element('label','Local Postgres service profile'),profile=element('input');profile.value=existing?.service||'';profileLabel.append(profile);
      advanced.append(modeLabel,profileLabel,element('p','For existing ~/.pg_service.conf profiles. Passwords remain in ~/.pgpass. Verified TLS and read-only access are required.','remote-note'));
      const sync=()=>{direct.hidden=mode.checked;directContainer.disabled=mode.checked;profile.disabled=!mode.checked;profile.required=mode.checked;};mode.onchange=sync;sync();
      auth.append(directContainer,advanced);
      if(!existing)wizardSetup=save=>mountPostgresSetup(direct,{form,name,settings:{...directSettings,get busy(){return directSettings.busy||testing;}},serviceMode:mode,save,error});
      supabaseSettings={get busy(){return !mode.checked&&directSettings.busy;},value:()=>mode.checked?{service:profile.value,timeoutSeconds:existing?.timeoutSeconds||60}:directSettings.value()};
    }

    const links={bigquery:'https://cloud.google.com/bigquery/docs/authentication',postgres:'https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-PARAMKEYWORDS',snowflake:'https://docs.snowflake.com/en/developer-guide/python-connector/python-connector-connect#using-single-sign-on-sso-for-authentication'};
    const link=element('a','Authentication instructions');link.href=supabase?'https://supabase.com/docs/guides/database/connecting-to-postgres':links[provider];link.target='_blank';link.rel='noopener';auth.append(link);
    form.append(auth,element('p',provider==='bigquery'?'Queries can incur charges. Publishing and uploads require explicit review.':'Read-only access: browse and run SELECT queries, then save a separate snapshot to Local DuckDB. No remote publishing or uploads.','remote-note'));
    const actions=element('div',undefined,'remote-actions'),save=element('button','Save connection','primary');actions.append(close,save);form.append(error,actions);
    if(!existing&&!wizardSetup){
      const holder=element('div');form.insertBefore(holder,error);
      const row=key=>inputs[key].parentElement;
      let steps,review;
      if(supabase){
        const sections=supabaseSettings.sections;
        steps=[
          {title:'Database',help:'In Supabase, open your project → Connect → Session pooler → View parameters. Copy the host, database and full username, including the project suffix. Studio uses port 5432.',nodes:[name.parentElement,...sections.database]},
          {title:'Database password',help:'Choose your database password from Credentials. This is not an API key, CLI token or Supabase account password.',nodes:sections.password},
          {title:'Server certificate',help:'Download the CA certificate from Database Settings → SSL Configuration if needed. Studio verifies TLS even when Enforce SSL is off.',nodes:[sections.certificate,sections.advanced,link]}
        ];
        review=()=>{const c=supabaseSettings.value();return [['Name',name.value],['Database',c.host?`${c.host}:5432 / ${c.database}`:''],['Username',c.user],['Password',c.credentialId?supabaseSettings.credentialName():''],['Certificate',c.sslrootcert||'Public CA trust']];};auth.remove();
      }else if(provider==='bigquery'){
        steps=[
          {title:'Project',help:'In Google Cloud, copy the project ID, not its display name. In BigQuery, select your dataset and check Details → Data location.',nodes:[name.parentElement,row('project'),row('location')]},
          {title:'Google account',help:'Choose an account profile or use existing System ADC. To sign in, install the Google Cloud CLI, expand Add or reconnect an account and finish sign-in in your browser.',nodes:[auth]},
          {title:'Query budget',help:'This is a processing cap per query, not a download limit. The default is 1 GB. Your account needs permission to run jobs and read the selected datasets.',nodes:[row('maximumBytesBilled')]}
        ];
        review=()=>[['Name',name.value],['Project',inputs.project.value],['Location',inputs.location.value],['Account',auth.querySelector('select')?.selectedOptions[0]?.textContent],['Query budget',`${inputs.maximumBytesBilled.value} bytes`]];
      }else{
        steps=[
          {title:'Account',help:'In Snowflake, copy the account identifier (usually organization-account, without https://) and your login username.',nodes:[name.parentElement,row('account'),row('user')]},
          {title:'Authentication',help:'Choose company SSO or your password from Credentials. Connecting may open a browser or ask for MFA in the Mac app; cached approval may skip the prompt.',nodes:[auth]},
          {title:'Data access',help:'Enter the role, warehouse and database you use in Snowflake. The role needs warehouse/database/schema USAGE and SELECT on the tables you want to read.',nodes:[row('role'),row('warehouse'),row('database'),row('timeoutSeconds')]}
        ];
        review=()=>[['Name',name.value],['Account',inputs.account.value],['User',inputs.user.value],['Sign-in',authentication.selectedOptions[0]?.textContent],...(authentication.value==='password_mfa'?[['Password',passwordChoice.value?passwordChoice.selectedOptions[0]?.textContent:'']]:[]),['Role',inputs.role.value],['Warehouse',inputs.warehouse.value],['Database',inputs.database.value]];
      }
      wizard=mountConnectionSetup(holder,{form,steps,save,error,review,busy:()=>submitting||testing||Boolean(googleProfile?.busy||supabaseSettings?.busy)});
    }else wizard=wizardSetup?.(save);if(wizard){d.classList.add('guided-connection-dialog');actions.classList.add('setup-footer');}
    const collectConnection=()=>{
      const connection={...(existing?{id:existing.id}:{}),provider,name:name.value};if(supabaseSettings)Object.assign(connection,supabaseSettings.value());if(googleProfile)connection.authProfile=googleProfile.value;if(authentication){connection.authentication=authentication.value;if(authentication.value==='password_mfa'){connection.credentialId=passwordChoice.value;connection.mfaMethod=mfaMethod.value;}}for(const [key,input] of Object.entries(inputs))connection[key]=input.type==='number'?Number(input.value):input.value;
      return connection;
    };
    if(wizard?.reviewPanel)mountConnectionReviewTest({dialog:d,form,panel:wizard.reviewPanel,save,collect:collectConnection,request,onBusy:value=>{testing=value;wizard.refresh();}});
    form.onsubmit=async e=>{e.preventDefault();if(submitting||testing)return;if(wizard&&!wizard.submit())return;if(googleProfile?.busy)return;if(supabaseSettings?.busy){error.textContent='Wait for the certificate to finish importing before saving.';return;}submitting=true;save.disabled=true;try{
      const connection=collectConnection();
      const saved=await request('connection-save',{revision:catalog.revision,connection,confirmed:Boolean(confirmation?.checked)});
      if(!options.central)await request('connection-attach',{revision:state.revision,connectionId:saved.id});
      await load();d.close();await options.after?.();
    }catch(e){error.textContent=e.message;}finally{submitting=false;if(wizard?.refresh)wizard.refresh();else save.disabled=false;}};
    if(wizard){
      const scroller=element('div',undefined,'setup-scroll');
      for(const node of [...form.children])if(node!==actions)scroller.append(node);
      form.prepend(scroller);
    }
    d.showModal();name.focus();
  }
  function render(){
    const expanded=new Set([...host.querySelectorAll('.remote-connection[open]')].map(d=>d.dataset.connection));
    host.replaceChildren();
    for(const c of state.connections){
      const description=c.missing?'Unavailable on this Mac — reconnect':kind(c)==='bigquery'?c.project+' · '+c.location:kind(c)==='postgres'?(c.preset==='supabase'?'Supabase · '+c.database:c.preset==='direct'?c.host+' · '+c.database:c.service):c.database+' · '+c.role;
      const details=element('details',undefined,'remote-connection'),summary=element('summary'),body=element('div'),actions=element('div',undefined,'remote-actions');
      const remove=element('button','Remove from project');remove.onclick=async()=>{if(!confirm('Remove '+c.name+' from this project? Saved queries stay, but need reconnection before running.'))return;try{await request('connection-detach',{revision:state.revision,id:c.id});await load();}catch(e){alert(e.message);}};
      body.append(remove);if(c.missing){const reconnect=element('button','Reconnect…');reconnect.onclick=()=>shared.picker(c);body.append(reconnect);}
      details.dataset.connection=c.id;details.dataset.provider=displayKind(c);details.dataset.name=c.name;details.open=expanded.has(c.id);
      const connectionName=element('span',c.name,'remote-connection-name');connectionName.title=c.name;summary.append(connectionName,element('span',providers[displayKind(c)],'remote-provider'));
      const headerActions=element('span',undefined,'remote-header-actions');
      headerActions.onclick=e=>{e.stopPropagation();e.preventDefault();};
      summary.append(headerActions);
      const check=iconButton('Connect / refresh','M20 4v5h-5M4 20v-5h5M5 9a7.5 7.5 0 0 1 12-3l3 3M4 15l3 3a7.5 7.5 0 0 0 12-3'),edit=iconButton('Settings','M4 7h16M4 17h16M8 4v6M16 14v6');edit.onclick=()=>c.missing?shared.picker(c):settings(c);
      const newQuery=element('button','New query');newQuery.onclick=()=>openQuery(c.id,'Query','');
      const message=element('p',description,'remote-note'),status=element('p',statusText.idle,'remote-status');status.dataset.connection=c.id;status.dataset.phase='idle';status.setAttribute('role','status');check.disabled=Boolean(c.missing);newQuery.disabled=Boolean(c.missing);headerActions.append(check,edit);actions.append(newQuery);body.append(message,actions,status);details.append(summary,body);host.append(details);
      if(kind(c)==='bigquery'&&!c.missing){
        const identity=element('p',c.authIdentity?c.authIdentity.name+' · '+c.authIdentity.account:'System ADC (shared default)','remote-account');
        body.insertBefore(identity,actions);models.render(c.id,body);
      }
      showConnectionStatus(c.id,connectionPhases.get(c.id)||'idle');
      const sources=element('details'),sourceTitle=element('summary','Data sources'),catalog=element('div');sources.open=true;sources.append(sourceTitle,catalog);body.append(sources);
      check.onclick=async()=>{details.open=true;check.disabled=true;catalog.textContent='Connecting…';try{const data=await catalogRequest({connection:c.id});catalog.replaceChildren();message.textContent=description;for(const name of data.datasets){
        const folder=element('details'),title=element('summary',name),tables=element('div');folder.append(title,tables);catalog.append(folder);
        folder.addEventListener('toggle',async()=>{if(!folder.open||folder.dataset.loaded)return;tables.textContent='Loading…';try{const result=await catalogRequest({connection:c.id,dataset:name});tables.replaceChildren();for(const t of result.tables){if(kind(c)==='bigquery'&&models.managed(t.qualified))continue;const b=element('button',t.name,'remote-table');b.title=t.kind+' · '+t.qualified;b.onclick=()=>openQuery(c.id,t.name,t.sql||'SELECT *\nFROM `'+t.qualified+'`\nLIMIT 1000;');tables.append(b);}folder.dataset.loaded='1';if(!result.tables.length)tables.textContent='No tables or views.';if(result.truncated)tables.append(element('p','Showing the first 500 objects. Query other objects by name.','remote-note'));}catch(e){tables.textContent=e.message;}});
      }if(!data.datasets.length)catalog.textContent='No accessible datasets or schemas.';if(data.truncated)catalog.append(element('p','Showing the first 500 schemas.','remote-note'));}catch(e){catalog.textContent=e.message;}finally{check.disabled=false;}};
    }
  }
  async function wait(id,onStatus=()=>{}){
    for(;;){const status=await request('status',{id});onStatus(status);if(status.state==='error')throw Error(status.error);if(status.state==='done')return status;await new Promise(resolve=>setTimeout(resolve,500));}
  }
  function notebookSelector(host,cell,onChange){
    const select=element('select');select.setAttribute('aria-label','Notebook SQL connection');
    function populate(){
      select.replaceChildren(new Option('Local DuckDB',''));
      for(const c of state.connections)select.add(new Option(providers[displayKind(c)]+' · '+c.name,c.id));
      if(cell.connection&&!state.connections.some(c=>c.id===cell.connection))select.add(new Option('Unavailable remote connection',cell.connection));
      select.value=cell.connection||'';
    }
    populate();host.append(select);anchorEditorSelect(select);
    select.onchange=()=>{cell.connection=select.value;onChange();};
    // Refresh choices when connections are added while a notebook remains open.
    select.addEventListener('studio-connections',populate);
  }
  async function notebookQuery(sql,connection,name){
    return withConnectionStatus(connection,async()=>{
      const job=await request('start',{action:'query',connection,sql});
      await wait(job.id);
      try{return await request('notebook-result',{id:job.id,name});}
      catch(e){throw Error(e.message+' Downstream cells cannot use this output. Filter or aggregate the query and rerun.');}
    });
  }
  async function query(sql,connection){return withConnectionStatus(connection,()=>queryInner(sql,connection));}
  async function queryInner(sql,connection){
    const job=await request('start',{action:'query',connection,sql,model:getTab()?.remoteModel});currentJob=job.id;
    const cancel=document.getElementById('cancelRemote');cancel.hidden=false;cancel.disabled=false;
    try{const meta=await wait(job.id);const response=await checkedResponse(await fetch('/remote/result',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:job.id,session:getSession()?.session})}));
      const arrow=tableFromIPC(await response.arrayBuffer()),fields=arrow.schema.fields;
      return {arrow,cols:fields.map(f=>f.name),types:fields.map(f=>f.type),rows:arrow.toArray().map(r=>fields.map(f=>r[f.name])),query:sql,remote:{...meta,connection}};
    }finally{currentJob=null;cancel.hidden=true;}
  }
  document.getElementById('cancelRemote').onclick=async e=>{e.target.disabled=true;try{if(currentJob)await request('cancel',{id:currentJob});}catch(error){document.getElementById('meta').textContent=error.message;}finally{e.target.disabled=false;}};
  function mountObjectTransfers(host,table){
    const wasOpen=host.querySelector('details')?.open||false;host.dataset.table=table;host.replaceChildren();
    const section=element('details',undefined,'object-external'),heading=element('summary','External databases'),body=element('div',undefined,'object-external-body');section.open=wasOpen;
    const available=state.connections.filter(c=>kind(c)==='bigquery');
    if(available.length){
      body.append(element('p','Copy the saved table or view’s current data to BigQuery. Unapplied SQL edits are not included.'));
      const copy=element('button','Copy to BigQuery…');copy.onclick=()=>upload({table});body.append(copy);
    }else body.append(element('p','Add a BigQuery connection to this project to copy data there.'));
    const manage=element('button',available.length?'Manage connections…':'Add connection…');manage.onclick=()=>available.length?shared.manager():shared.picker();body.append(manage);
    section.append(heading,body);host.append(section);
  }
  async function upload(source){
    try{state=await request('list');}catch(e){host.textContent=e.message;return;}
    const uploadConnections=state.connections.filter(c=>kind(c)==='bigquery');
    if(!uploadConnections.length){await settings();return;}
    const {d,form,error,close,field}=dialog('Upload to BigQuery');
    form.append(element('p',(source.file?'File: '+source.file:'Local DuckDB: '+source.table),'remote-note'));
    const label=element('label','Connection'),select=element('select');select.setAttribute('aria-label','Upload connection');for(const c of uploadConnections)select.add(new Option(c.name+' · '+c.project,c.id));label.append(select);form.append(label);
    const dataset=field('Destination dataset'),name=field('New table name',(source.table||source.file.split('/').pop().replace(/\.[^.]+$/,'')).replace(/[^a-zA-Z0-9_]/g,'_'));dataset.required=name.required=true;
    const target=element('p','','remote-target');function describe(){const c=state.connections.find(c=>c.id===select.value);target.textContent=c.project+'.'+(dataset.value||'dataset')+'.'+(name.value||'table');}select.onchange=dataset.oninput=name.oninput=describe;describe();
    form.append(target,element('p','Uploads this data to Google BigQuery as a new table. Existing names are rejected. CSV column types are inferred; the source stays unchanged. Preview limit: 100,000 rows / 64 MB. A temporary staging table is used during upload.','remote-note'));
    const actions=element('div',undefined,'remote-actions'),submit=element('button','Upload new table','primary');actions.append(close,submit);form.append(error,actions);
    form.onsubmit=async e=>{e.preventDefault();if(transferBusy)return;transferBusy=true;submit.disabled=true;close.disabled=true;d.oncancel=event=>event.preventDefault();try{const job=await request('start',{action:'upload',connection:select.value,...source,dataset:dataset.value,name:name.value,confirmed:true});error.textContent='Uploading…';const result=await wait(job.id);error.textContent='Created '+result.destination+(result.warning?' · '+result.warning:'');submit.hidden=true;close.textContent='Close';}catch(e){error.textContent=e.message;}finally{transferBusy=false;submit.disabled=false;close.disabled=false;d.oncancel=null;}};
    d.showModal();anchorEditorSelect(select);dataset.focus();
  }
  async function resultResponse(result,action,extra={}){
    return checkedResponse(await fetch('/remote/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:result.remote.id,session:getSession()?.session,...extra})}));
  }
  async function fetchMore(result){
    const limit=Math.min(100000,result.rows.length+10000);
    const response=await resultResponse(result,'result',{limit});
    const arrow=tableFromIPC(await response.arrayBuffer()),fields=arrow.schema.fields;
    return {...result,arrow,cols:fields.map(f=>f.name),types:fields.map(f=>f.type),rows:arrow.toArray().map(r=>fields.map(f=>r[f.name]))};
  }
  async function transfer(result,kind){
    if(transferBusy)return;transferBusy=true;
    try{return await fullTransfer(result,kind,{request,dialog,refresh:refreshSchema});}
    finally{transferBusy=false;}
  }
  const shared=connectionManager({request,dialog,settings,refresh:load,projectState:()=>state,providers});
  window.addEventListener('focus',async()=>{try{const catalog=await request('connections');if(catalog.revision!==state.centralRevision)await load();}catch{/* Keep the current UI when its server is unavailable. */}});
  document.getElementById('addConnection').onclick=e=>{e.preventDefault();e.stopPropagation();shared.picker();};
  if(location.hash==='#connections-manager'){
    document.body.classList.add('connections-manager-only');document.title='Connections — Minimal Data Studio';
    const home=element('div',undefined,'connections-manager-home'),heading=element('h2','Connections'),open=element('button','Manage connections…');open.onclick=()=>shared.manager();home.append(heading,open);document.body.append(home);
    shared.manager();
  }
  return {mountObjectTransfers,provider:id=>kind(state.connections.find(c=>c.id===id)),providerLabel:id=>providers[displayKind(state.connections.find(c=>c.id===id))],dialect:id=>({bigquery:'bigquery',snowflake:'snowflake',postgres:'postgresql'}[kind(state.connections.find(c=>c.id===id))]),modelHints:(...args)=>kind(state.connections.find(c=>c.id===getTab()?.connection))==='bigquery'?models.hints(...args):null,modelDirty:models.dirty,saveModel:models.save,manageConnections:shared.manager,notebookSelector,notebookQuery,load,sync,query,upload,transfer,fetchMore,settings,get busy(){return transferBusy||models.busy;},label:id=>state.connections.find(c=>c.id===id)?.name||'Unavailable remote connection'};
}
