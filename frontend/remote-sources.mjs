import {fullTransfer} from './remote-transfers.mjs';
import {setLoading} from './loading.mjs';
import {jsonRequest,checkedResponse} from './api.mjs';
import {setupRemoteModels} from './remote-models.mjs';
import {mountGoogleProfiles} from './google-profile-settings.mjs';
import {anchorEditorSelect} from './editor-select.mjs';
const providers={bigquery:'BigQuery',snowflake:'Snowflake',postgres:'Postgres'};
const kind=c=>c?.provider||'bigquery';
const element=(tag,text,cls)=>Object.assign(document.createElement(tag),{...(text!==undefined?{textContent:text}:{}),...(cls?{className:cls}:{})});
export function setupRemoteSources({getSession,getTab,changed,openQuery,getCode,setCode,tableFromIPC,refreshSchema}) {
  let state={revision:0,connections:[]},currentJob=null,transferBusy=false;
  const connectionPhases=new Map();
  const request=(action,data={})=>jsonRequest('/remote/'+action,{...data,session:getSession()?.session});
  const models=setupRemoteModels({request,dialog,getTab,getCode,setCode,openQuery,changed:()=>{render();changed();},wait,connections:()=>state.connections});
  const host=document.getElementById('bigqueryList'),hosts=Object.fromEntries(Object.keys(providers).map(p=>[p,document.getElementById(p+'List')])),selectHost=document.getElementById('connectionControl');
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
    document.querySelectorAll('select[aria-label="Notebook SQL connection"]').forEach(s=>s.dispatchEvent(new Event('studio-connections')));
    selectHost.hidden=!visible;selectHost.replaceChildren();
    const label=element('span','Connection','connection-label'),select=element('select');select.setAttribute('aria-label','SQL connection');
    select.add(new Option('Local DuckDB',''));
    for(const c of state.connections)select.add(new Option(providers[kind(c)]+' · '+c.name,c.id));
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
  async function settings(existing,provider='bigquery'){
    try{state=await request('list');}catch(e){host.textContent=e.message;return;}
    provider=existing?kind(existing):provider;
    const {d,form,error,close,field}=dialog((existing?'':'Connect ')+providers[provider]+(existing?' connection':''));
    const name=field('Connection name',existing?.name||'');name.required=true;
    const inputs={};
    const definitions={
      bigquery:[['project','Google Cloud project ID',''],['location','Dataset location','US'],['maximumBytesBilled','Maximum bytes billed per query',1000000000]],
      postgres:[['service','Local Postgres service profile',''],['timeoutSeconds','Query timeout (seconds)',60]],
      snowflake:[['account','Account identifier',''],['user','User',''],['role','Read-only role',''],['warehouse','Warehouse',''],['database','Database',''],['timeoutSeconds','Query timeout (seconds)',60]]
    };
    for(const [key,label,fallback] of definitions[provider]){const input=field(label,String(existing?.[key]??fallback));input.required=true;if(['maximumBytesBilled','timeoutSeconds'].includes(key)){input.type='number';input.min='1';input.max=key==='timeoutSeconds'?'300':'10000000000000';}inputs[key]=input;}
    let authentication,passwordChoice,mfaMethod,googleProfile;
    const auth=element('details');auth.open=true;
    if(provider==='bigquery'){
      auth.append(element('summary','Google account'));
      googleProfile=mountGoogleProfiles(auth,{request,selected:existing?.authProfile||'',onBusy:busy=>{save.disabled=busy;}});
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
          credentialStatus.textContent=data.error||'Add your Snowflake password in Credentials, connect it to this project, then refresh this list.';
        }catch(e){credentialStatus.textContent=e.message;}finally{refresh.disabled=false;}
      }
      refresh.onclick=credentials;manage.onclick=async()=>{try{await request('manage-credentials');credentialStatus.textContent='Save/connect your password in the Mac app, then click Refresh credentials.';}catch(e){credentialStatus.textContent=e.message;}};
      passwordFields.append(passwordLabel,manage,refresh,mfaLabel,rememberNote,credentialStatus,element('p','The password stays in Keychain. Studio asks for permission before using it for this connection. Snowflake may ask again when approval expires or account policy requires it.','remote-note'));
      authentication.onchange=()=>{passwordFields.hidden=authentication.value!=='password_mfa';sso.hidden=!passwordFields.hidden;passwordChoice.required=!passwordFields.hidden;if(!passwordFields.hidden)credentials();};
      auth.append(sso,passwordFields,element('p','Use a role with SELECT and warehouse/database/schema USAGE. Secondary roles are disabled.','remote-note'));authentication.onchange();
    }else{
      auth.append(element('summary','Authentication · Local service profile'),element('p','Use a named profile in ~/.pg_service.conf on this Mac. Put passwords in ~/.pgpass with permissions 600, never in the project or this form. Ask your administrator for a read-only user and TLS certificate settings.'),element('pre','[studio_readonly]\nhost=db.example.com\nport=5432\ndbname=analytics\nuser=studio_reader\nsslmode=verify-full\nsslrootcert=/absolute/path/to/ca.pem'),element('p','Enter studio_readonly above. Studio requires verified TLS and read-only transactions.'));
    }
    const links={bigquery:'https://cloud.google.com/bigquery/docs/authentication',postgres:'https://www.postgresql.org/docs/current/libpq-pgservice.html',snowflake:'https://docs.snowflake.com/en/developer-guide/python-connector/python-connector-connect#using-single-sign-on-sso-for-authentication'};
    const link=element('a','Authentication instructions');link.href=links[provider];link.target='_blank';link.rel='noopener';auth.append(link);
    form.append(auth,element('p',provider==='bigquery'?'Queries can incur charges. Publishing and uploads require explicit review.':'Read-only access: browse and run SELECT queries, then save a separate snapshot to Local DuckDB. No remote publishing or uploads.','remote-note'));
    const actions=element('div',undefined,'remote-actions'),save=element('button','Save connection','primary');actions.append(close,save);form.append(error,actions);
    form.onsubmit=async e=>{e.preventDefault();if(googleProfile?.busy)return;save.disabled=true;try{
      const connection={...(existing?{id:existing.id}:{}),provider,name:name.value};if(googleProfile)connection.authProfile=googleProfile.value;if(authentication){connection.authentication=authentication.value;if(authentication.value==='password_mfa'){connection.credentialId=passwordChoice.value;connection.mfaMethod=mfaMethod.value;}}for(const [key,input] of Object.entries(inputs))connection[key]=input.type==='number'?Number(input.value):input.value;
      state=await request('save',{revision:state.revision,connection});if(existing)connectionPhases.delete(existing.id);render();sync();d.close();
    }catch(e){error.textContent=e.message;}finally{save.disabled=false;}};
    d.showModal();name.focus();
  }
  function render(){
    const expanded=new Set(Object.values(hosts).flatMap(h=>[...h.querySelectorAll('.remote-connection[open]')].map(d=>d.dataset.connection)));
    for(const h of Object.values(hosts))h.replaceChildren();
    for(const c of state.connections){
      const host=hosts[kind(c)],description=kind(c)==='bigquery'?c.project+' · '+c.location:kind(c)==='postgres'?c.service:c.database+' · '+c.role;
      const details=element('details',undefined,'remote-connection'),summary=element('summary'),body=element('div'),actions=element('div',undefined,'remote-actions');
      details.dataset.connection=c.id;details.dataset.name=c.name;details.open=expanded.has(c.id);
      const connectionName=element('span',c.name,'remote-connection-name');connectionName.title=c.name;summary.append(connectionName);
      const headerActions=element('span',undefined,'remote-header-actions');
      headerActions.onclick=e=>{e.stopPropagation();e.preventDefault();};
      summary.append(headerActions);
      const check=iconButton('Connect / refresh','M20 4v5h-5M4 20v-5h5M5 9a7.5 7.5 0 0 1 12-3l3 3M4 15l3 3a7.5 7.5 0 0 0 12-3'),edit=iconButton('Settings','M4 7h16M4 17h16M8 4v6M16 14v6');edit.onclick=()=>settings(c);
      const newQuery=element('button','New query');newQuery.onclick=()=>openQuery(c.id,'Query','');
      const message=element('p',description,'remote-note'),status=element('p',statusText.idle,'remote-status');status.dataset.connection=c.id;status.dataset.phase='idle';status.setAttribute('role','status');headerActions.append(check,edit);actions.append(newQuery);body.append(message,actions,status);details.append(summary,body);host.append(details);
      if(kind(c)==='bigquery'){
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
      for(const c of state.connections)select.add(new Option(providers[kind(c)]+' · '+c.name,c.id));
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
  document.getElementById('addBigQuery').onclick=()=>settings();
  document.getElementById('addSnowflake').onclick=()=>settings(null,'snowflake');
  document.getElementById('addPostgres').onclick=()=>settings(null,'postgres');
  return {provider:id=>kind(state.connections.find(c=>c.id===id)),providerLabel:id=>providers[kind(state.connections.find(c=>c.id===id))],dialect:id=>({bigquery:'bigquery',snowflake:'snowflake',postgres:'postgresql'}[kind(state.connections.find(c=>c.id===id))]),modelHints:(...args)=>kind(state.connections.find(c=>c.id===getTab()?.connection))==='bigquery'?models.hints(...args):null,modelDirty:models.dirty,saveModel:models.save,notebookSelector,notebookQuery,load,sync,query,upload,transfer,fetchMore,settings,get busy(){return transferBusy||models.busy;},label:id=>state.connections.find(c=>c.id===id)?.name||'Unavailable remote connection'};
}
