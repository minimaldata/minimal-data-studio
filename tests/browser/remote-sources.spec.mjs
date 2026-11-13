import {test,expect,open,edit} from './fixtures.mjs';
test('connection setup, per-tab destination and explicit upload dialog',async({page,studio})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await studio.writeScript('lookup.csv','customer,territory\n1,North\n');
  await open(page,studio.url);
  await expect(page.locator('#filesPanel h2')).toBeVisible();
  await expect(page.locator('#databasePanel h2')).toBeVisible();
  await expect(page.locator('#bigqueryPanel h2')).toBeVisible();
  await page.getByRole('button',{name:'Connect BigQuery',exact:true}).click();
  const dialog=page.locator('dialog[open]');
  await expect(dialog).toContainText('gcloud auth application-default login');
  await page.screenshot({path:'/tmp/mds-bigquery-setup.png',fullPage:true});
  await dialog.getByLabel('Connection name').fill('Company analytics');
  await dialog.getByLabel('Google Cloud project ID').fill('example-project');
  await dialog.getByRole('button',{name:'Save connection',exact:true}).click();
  await page.getByRole('button',{name:'SQL connection',exact:true}).click();
  await page.getByRole('option',{name:'BigQuery · Company analytics',exact:true}).click();
  await edit(page,'SELECT 42 AS remote_answer');
  await page.reload();await expect(page.locator('#status')).toContainText('Ready');
  await expect(page.getByRole('button',{name:'SQL connection',exact:true})).toHaveText('BigQuery · Company analytics');
  await page.locator('#formatBtn').click();
  await expect(page.locator('#editorWrap .CodeMirror-code')).toContainText('remote_answer');
  // Verify dispatch without contacting Google or using ambient ADC.
  let queryRequest;
  await page.route('**/remote/start',async route=>{queryRequest=route.request().postDataJSON();await route.fulfill({status:400,json:{error:'Synthetic BigQuery failure; no fallback'}});});
  await page.locator('#runBtn').click();await expect(page.locator('#results')).toContainText('Synthetic BigQuery failure');
  expect(queryRequest.sql).toContain('remote_answer');expect(queryRequest.connection).toBeTruthy();
  await page.locator('#tabs .tab').filter({hasText:'+'}).last().click();
  await expect(page.getByRole('button',{name:'SQL connection',exact:true})).toHaveText('Local DuckDB');
  await page.locator('#projectFiles .file-row').filter({hasText:'lookup.csv'}).click();
  await page.getByRole('button',{name:'Upload to BigQuery…',exact:true}).click();
  await expect(dialog).toContainText('Uploads this data to Google BigQuery');
  await dialog.getByLabel('Destination dataset').fill('sandbox');
  await expect(dialog.locator('.remote-target')).toHaveText('example-project.sandbox.lookup');
  await expect(dialog.getByRole('button',{name:'Upload new table'})).toBeEnabled();
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.screenshot({path:'/tmp/mds-bigquery-preview.png',fullPage:true});
  expect(errors).toEqual([]);
});

test('read-only Postgres and Snowflake browse sources and open blank provider-specific queries',async({page,studio})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await open(page,studio.url);
  const dialog=page.locator('dialog[open]');
  const configs=[{label:'Postgres',id:'postgres',fields:{'Connection name':'Research PG','Local Postgres service profile':'research_reader'}},
    {label:'Snowflake',id:'snowflake',fields:{'Connection name':'Research SF','Account identifier':'org-account','User':'reader','Read-only role':'READER','Warehouse':'COMPUTE_WH','Database':'ANALYTICS'}}];
  const catalogCalls=[];
  await page.route('**/remote/catalog',async route=>{
    const data=route.request().postDataJSON();catalogCalls.push(data);
    await route.fulfill({json:data.dataset?{tables:[{name:'Observations',kind:'VIEW',qualified:'"PUBLIC"."Observations"',sql:'SELECT *\nFROM "PUBLIC"."Observations"\nLIMIT 1000;'}]}:{datasets:['PUBLIC']}});
  });
  for(const config of configs){
    await page.getByRole('button',{name:'Connect '+config.label,exact:true}).click();
    for(const [name,value] of Object.entries(config.fields))await dialog.getByLabel(name,{exact:true}).fill(value);
    await expect(dialog).toContainText('Read-only access');
    await expect(dialog.locator('input[type=password]')).toHaveCount(0);
    await dialog.getByRole('button',{name:'Save connection',exact:true}).click();
    const panel=page.locator('#'+config.id+'Panel');
    await panel.locator('.remote-connection > summary').click();
    await panel.getByRole('button',{name:'New query',exact:true}).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('#editorWrap .CodeMirror-code')).not.toContainText('SELECT');
    await expect(page.getByRole('button',{name:'SQL connection',exact:true})).toHaveText(config.label+' · '+config.fields['Connection name']);
    await expect(page.locator('.remote-model-bar')).toBeHidden();
    await panel.locator('.remote-connection > summary').hover();await panel.getByRole('button',{name:'Connect / refresh',exact:true}).click();
    await panel.getByText('PUBLIC',{exact:true}).click();
    await panel.getByRole('button',{name:'Observations',exact:true}).click();
    await expect(page.locator('#editorWrap .CodeMirror-code')).toContainText('"PUBLIC"."Observations"');
    await page.locator('#formatBtn').click();
    await expect(page.locator('#results')).not.toContainText('Format failed');
    await page.reload();await expect(page.locator('#status')).toContainText('Ready');
    await expect(page.getByRole('button',{name:'SQL connection',exact:true})).toHaveText(config.label+' · '+config.fields['Connection name']);
    let sent;
    await page.route('**/remote/start',async route=>{sent=route.request().postDataJSON();await route.fulfill({status:400,json:{error:'Synthetic read-only connection error'}});});
    await page.locator('#runBtn').click();await expect(page.locator('#results')).toContainText('Synthetic read-only connection error');
    expect(sent.connection).toBe(catalogCalls.at(-1).connection);
    expect(sent.sql).toContain('Observations');
    await page.unroute('**/remote/start');
  }
  await page.screenshot({path:'/tmp/mds-readonly-connectors.png',fullPage:true});
  expect(catalogCalls).toHaveLength(4);expect(errors).toEqual([]);
});

test('Snowflake password MFA selects Keychain metadata without browser secret entry',async({page,studio})=>{
  await open(page,studio.url);
  let managed=false,saved;
  await page.route('**/remote/credentials',route=>route.fulfill({json:{available:true,credentials:[{id:'dummy-password-id',name:'Snowflake password'}]}}));
  await page.route('**/remote/manage-credentials',route=>{managed=true;return route.fulfill({json:{opened:true}});});
  page.on('request',request=>{if(request.url().endsWith('/remote/save'))saved=request.postDataJSON();});
  await page.getByRole('button',{name:'Connect Snowflake',exact:true}).click();
  const dialog=page.locator('dialog[open]');
  await dialog.getByLabel('Sign-in method').selectOption('password_mfa');
  await expect(dialog.getByLabel('Keychain password')).toContainText('Snowflake password');
  await dialog.getByRole('button',{name:'Manage credentials…'}).click();expect(managed).toBe(true);
  await dialog.getByLabel('Keychain password').selectOption('dummy-password-id');
  await dialog.getByLabel('MFA method').selectOption('passcode');
  for(const [label,value] of Object.entries({'Connection name':'Password MFA','Account identifier':'org-account','User':'analyst','Read-only role':'READER','Warehouse':'WH','Database':'DB'}))await dialog.getByLabel(label,{exact:true}).fill(value);
  await expect(dialog.locator('input[type=password]')).toHaveCount(0);
  await dialog.getByRole('button',{name:'Save connection',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  expect(saved.connection.authentication).toBe('password_mfa');expect(saved.connection.credentialId).toBe('dummy-password-id');expect(saved.connection.mfaMethod).toBe('passcode');
  expect(saved.connection.password).toBeUndefined();expect(saved.connection.passcode).toBeUndefined();
  await page.locator('#snowflakeList .remote-connection > summary').click();
  await page.locator('#snowflakeList .remote-connection > summary').hover();await page.locator('#snowflakeList').getByRole('button',{name:'Settings',exact:true}).click();
  await expect(dialog.getByLabel('Sign-in method')).toHaveValue('password_mfa');
  await expect(dialog.getByLabel('Keychain password')).toHaveValue('dummy-password-id');
  await expect(dialog.getByLabel('MFA method')).toHaveValue('passcode');
  await page.screenshot({path:'/tmp/mds-snowflake-mfa-settings.png',fullPage:true});
});

test('remote result uses one full-output dialog with CSV default and both destinations',async({page,studio})=>{
  const {execFileSync}=await import('node:child_process');
  const arrow=rows=>execFileSync(process.env.MDS_TEST_PYTHON||'.venv/bin/python',['-c',`import sys,pyarrow as p;t=p.table({'id':range(${rows})});s=p.BufferOutputStream();w=p.ipc.new_stream(s,t.schema);w.write_table(t);w.close();sys.stdout.buffer.write(s.getvalue().to_pybytes())`]);
  const initial=arrow(1000),expanded=arrow(1200);
  await open(page,studio.url);
  await page.getByRole('button',{name:'Connect BigQuery',exact:true}).click();
  const dialog=page.locator('dialog[open]');
  await dialog.getByLabel('Connection name').fill('Preview warehouse');
  await dialog.getByLabel('Google Cloud project ID').fill('example-project');
  await dialog.getByRole('button',{name:'Save connection',exact:true}).click();
  await page.getByRole('button',{name:'SQL connection',exact:true}).click();
  await page.getByRole('option',{name:'BigQuery · Preview warehouse',exact:true}).click();
  let runs=0,full=false,oversized=false;
  await page.route('**/remote/start',route=>{runs++;return route.fulfill({json:{id:'test-job'}});});
  await page.route('**/remote/status',route=>route.fulfill({json:{id:'test-job',state:'done',totalRows:oversized?100001:1200,provider:'bigquery'}}));
  await page.route('**/remote/result',route=>route.fulfill({contentType:'application/vnd.apache.arrow.stream',body:route.request().postDataJSON().limit?expanded:initial}));
  await page.route('**/remote/transfer-plan',route=>route.fulfill({json:{rows:oversized?100001:1200,estimatedBytes:12000,rerun:false,retrieval:'Reads the original result; SQL is not rerun.'}}));
  await page.route('**/remote/transfer-start',route=>{const body=route.request().postDataJSON();expect(body.confirmed).toBe(true);expect(body.maxBytes).toBe(1000000000);full=true;return route.fulfill({json:{id:'transfer'}});});
  await page.route('**/remote/transfer-status',route=>route.fulfill({json:{state:'done',phase:'Complete',rows:1200,bytes:12000,destination:'exports/query_result_all.csv'}}));
  await edit(page,'SELECT * FROM source');await page.locator('#runBtn').click();
  await expect(page.locator('#meta')).toContainText('Showing first 1,000 of 1,200');
  await expect(page.locator('#csvBtn')).toBeHidden();
  await expect(page.locator('#createTableBtn')).toBeHidden();
  await expect(page.getByRole('button',{name:'Fetch more rows',exact:true})).toHaveCount(0);
  await expect(page.locator('#remoteExportBtn')).toHaveText('Save full output…');
  await page.locator('#remoteExportBtn').click();await expect(dialog).toContainText('SQL is not rerun');expect(full).toBe(false);
  await expect(dialog.getByRole('radio',{name:'CSV',exact:true})).toBeChecked();
  await expect(dialog.getByLabel('DuckDB table name')).toBeHidden();
  await dialog.getByRole('button',{name:'Start full transfer',exact:true}).click();
  await expect(dialog).toContainText('Saved 1,200 rows');await dialog.getByRole('button',{name:'Close',exact:true}).click();
  expect(full).toBe(true);expect(runs).toBe(1);
  oversized=true;await page.locator('#runBtn').click();
  await expect(page.locator('#meta')).toContainText('100,001');
  await expect(page.locator('#remoteExportBtn')).toBeEnabled();
  await page.route('**/remote/transfer-plan',route=>route.fulfill({json:{rows:null,estimatedBytes:null,rerun:true,retrieval:'Postgres must run this SELECT again.'}}));
  let started=false,cancelled=false;
  await page.route('**/remote/transfer-start',route=>{expect(route.request().postDataJSON().allowRerun).toBe(true);expect(route.request().postDataJSON().kind).toBe('both');expect(route.request().postDataJSON().csvName).toBe('download.csv');expect(route.request().postDataJSON().tableName).toBe('analysis');started=true;return route.fulfill({json:{id:'transfer-two'}});});
  await page.route('**/remote/transfer-status',route=>route.fulfill({json:cancelled?{state:'cancelled',error:'Transfer cancelled. No output was published.'}:{state:'running',phase:'Downloading',rows:5000,bytes:40000}}));
  await page.route('**/remote/transfer-cancel',route=>{cancelled=true;return route.fulfill({json:{ok:true}});});
  await page.locator('#remoteExportBtn').click();
  await dialog.getByRole('radio',{name:'DuckDB table',exact:true}).check();
  await expect(dialog).toContainText('Destination: Local DuckDB');
  await expect(dialog.getByLabel('CSV filename')).toBeHidden();
  await dialog.getByRole('radio',{name:'Both',exact:true}).check();
  await dialog.getByLabel('CSV filename').fill('download.csv');
  await dialog.getByLabel('DuckDB table name').fill('analysis');
  await dialog.getByRole('button',{name:'Start full transfer',exact:true}).click();expect(started).toBe(false);
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button',{name:'Start full transfer',exact:true}).click();
  await expect(dialog).toContainText('5,000 rows');
  await page.screenshot({path:'/tmp/mds-full-transfer-dialog.png'});
  await dialog.getByRole('button',{name:'Cancel transfer',exact:true}).click();
  await expect(dialog).toContainText('No output was published');
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.screenshot({path:'/tmp/mds-remote-result-limits.png'});
});

test('external database grouping and Snowflake push guidance',async({page,studio})=>{
  await open(page,studio.url);
  await page.getByRole('button',{name:'Connect Snowflake',exact:true}).click();
  const dialog=page.locator('dialog[open]');
  for(const [label,value] of Object.entries({'Connection name':'Research warehouse','Account identifier':'org-account','User':'reader','Read-only role':'READER','Warehouse':'WH','Database':'FORESTRY'}))await dialog.getByLabel(label,{exact:true}).fill(value);
  await dialog.getByRole('button',{name:'Save connection',exact:true}).click();
  const group=page.locator('#externalDatabases');
  await group.locator(':scope > summary').click();await expect(page.locator('#snowflakePanel')).toBeHidden();
  await group.locator(':scope > summary').click();
  await page.locator('#snowflakeList .remote-connection > summary').click();
  let release;const gate=new Promise(resolve=>release=resolve);
  await page.route('**/remote/connection-status',route=>route.fulfill({json:{phase:'mfa_push'}}));
  await page.route('**/remote/catalog',async route=>{await gate;await route.fulfill({json:{datasets:['PUBLIC']}});});
  await page.locator('#snowflakeList .remote-connection > summary').hover();await page.locator('#snowflakeList').getByRole('button',{name:'Connect / refresh',exact:true}).click();
  const status=page.locator('#snowflakeList .remote-status');
  await expect(status).toContainText('Check your authenticator');
  await expect(status).toHaveClass(/studio-loading/);
  await expect(status).toContainText('Cached approval may skip it');
  for(const dark of [false,true]){
    if(dark)await page.locator('#themeBtn').click();
    const paint=await status.evaluate(el=>({text:getComputedStyle(el).color,marks:getComputedStyle(el,'::before').backgroundColor,mask:getComputedStyle(el,'::before').maskImage,filter:getComputedStyle(el,'::before').filter}));
    expect(paint.marks).toBe(paint.text);expect(paint.mask).toContain('studio-loading.svg');expect(paint.filter).toBe('none');
  }
  await expect(page.locator('#snowflakeList .remote-icon svg')).toHaveCount(2);
  await page.screenshot({path:'/tmp/mds-sidebar-mfa.png'});
  release();await expect(status).toHaveText('Connected');await expect(status).not.toHaveClass(/studio-loading/);
});

test('notebook connections persist and incomplete remote outputs block dependent cells',async({page,studio})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await studio.writeScript('saved_queries.json',JSON.stringify({queries:[],dashboards:[],notebooks:[{id:'remote-nb',name:'Remote notebook',cells:[
    {id:'src',type:'sql',name:'remote_input',source:'SELECT 1 AS value',view:'table'},
    {id:'consumer',type:'sql',name:'consumer',source:'SELECT count(*) AS n FROM remote_input',view:'table'}]}]}));
  await open(page,studio.url);
  await page.getByRole('button',{name:'Connect BigQuery',exact:true}).click();
  const dialog=page.locator('dialog[open]');
  await dialog.getByLabel('Connection name').fill('Notebook warehouse');
  await dialog.getByLabel('Google Cloud project ID').fill('example-project');
  await dialog.getByRole('button',{name:'Save connection',exact:true}).click();
  await page.getByRole('tab',{name:'Analyses',exact:true}).click();
  await page.locator('#nbList .saved').filter({hasText:'Remote notebook'}).click();
  const cells=page.locator('#nbCells .cell.sql');
  await cells.first().getByRole('button',{name:'Notebook SQL connection',exact:true}).click();
  await page.getByRole('option',{name:'BigQuery · Notebook warehouse',exact:true}).click();
  await expect.poll(async()=>{
    const saved=await (await page.request.get(studio.url+'/saved_queries.json')).json();return saved.notebooks[0].cells[0].connection;
  }).toBeTruthy();
  await page.reload();await expect(cells.first().getByRole('button',{name:'Notebook SQL connection',exact:true})).toHaveText('BigQuery · Notebook warehouse');
  await page.route('**/remote/start',r=>r.fulfill({json:{id:'mock'}}));
  await page.route('**/remote/status',r=>r.fulfill({json:{state:'done'}}));
  await page.route('**/remote/notebook-result',async route=>{
    const request=route.request().postDataJSON();
    const response=await page.request.post(studio.url+'/db/query?session='+request.session,{headers:{Origin:studio.url,'X-Client':route.request().headers()['x-client']||''},data:{sql:'CREATE OR REPLACE TEMP TABLE remote_input AS SELECT range AS value FROM range(1200)'}});
    expect(response.ok(),await response.text()).toBeTruthy();await route.fulfill({json:{rows:1200}});
  });
  await cells.first().getByRole('button',{name:'▶ Run',exact:true}).click();
  await expect(cells.first().locator('.cell-meta')).toContainText('1,200');
  await expect(cells.nth(1).locator('.cell-out')).toContainText('1,200');
  await page.locator('#nbCells .adder.end').getByRole('button',{name:'+ Python',exact:true}).click();
  const py=page.locator('#nbCells .cell.python');await py.locator('.CodeMirror').click();
  await page.keyboard.insertText('assert len(remote_input) == 1200\nremote_input.tail(1)');
  await py.getByRole('button',{name:'▶ Run',exact:true}).click();
  await expect(py.locator('.cell-out')).toContainText('1,199');
  if(process.env.MDS_TEST_R==='1'){
    await page.locator('#nbCells .adder.end').getByRole('button',{name:'+ R',exact:true}).click();
    const r=page.locator('#nbCells .cell.r');await r.locator('.CodeMirror').click();
    await page.keyboard.insertText('stopifnot(nrow(remote_input) == 1200)\ntail(remote_input, 1)');
    await r.getByRole('button',{name:'▶ Run',exact:true}).click();
    await expect(r.locator('.cell-out')).toContainText('1,199');
  }
  await page.unroute('**/remote/notebook-result');
  await page.route('**/remote/notebook-result',r=>r.fulfill({status:400,json:{error:'This result is incomplete or too large for transfer.'}}));
  await cells.first().getByRole('button',{name:'▶ Run',exact:true}).click();
  await expect(cells.first()).toContainText('Downstream cells cannot use this output');
  await cells.nth(1).getByRole('button',{name:'▶ Run',exact:true}).click();
  await expect(cells.nth(1)).toContainText('Run remote_input first');
  expect(errors).toEqual([]);
});

test('BigQuery accounts are selected per connection and status controls reveal on hover',async({page,studio})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await studio.writeGoogleProfile('a'.repeat(32),'Work','alice@example.com');
  await studio.writeGoogleProfile('b'.repeat(32),'Client B','bob@example.com');
  await open(page,studio.url);
  for(const [name,profile] of [['Warehouse A','Work · alice@example.com'],['Warehouse B','Client B · bob@example.com']]){
    await page.getByRole('button',{name:'Connect BigQuery',exact:true}).click();
    const dialog=page.locator('dialog[open]');
    await dialog.getByLabel('Connection name').fill(name);await dialog.getByLabel('Google Cloud project ID').fill('example-project');
    await dialog.getByRole('button',{name:'Google authentication profile',exact:true}).click();
    await page.getByRole('option',{name:profile,exact:true}).click();
    await expect(dialog).toContainText('Google account: '+(name.endsWith('A')?'alice':'bob')+'@example.com');
    await dialog.getByRole('button',{name:'Save connection',exact:true}).click();
  }
  await page.reload();await expect(page.locator('#status')).toContainText('Ready');
  const connections=page.locator('#bigqueryList .remote-connection');
  for(let i=0;i<2;i++){
    const c=connections.nth(i);await c.locator(':scope > summary').click();
    await expect(c.locator('.remote-account')).toContainText(i?'bob@example.com':'alice@example.com');
  }
  const c=connections.first(),header=c.locator(':scope > summary');
  await page.locator('#status').hover();await expect(c.locator('.remote-header-actions')).toHaveCSS('opacity','0');
  await header.hover();await expect(c.locator('.remote-header-actions')).toHaveCSS('opacity','1');
  await page.route('**/remote/catalog',r=>r.fulfill({json:{datasets:[]}}));
  await c.getByRole('button',{name:'Connect / refresh',exact:true}).click();
  await expect(c).toHaveAttribute('data-phase','connected');await expect(c.locator('.remote-connection-name')).toHaveCSS('color','rgb(24, 116, 68)');
  await page.unroute('**/remote/catalog');await page.route('**/remote/catalog',r=>r.fulfill({status:400,json:{error:'Synthetic connection failure'}}));
  await header.hover();await c.getByRole('button',{name:'Connect / refresh',exact:true}).click();
  await expect(c).toHaveAttribute('data-phase','error');
  await header.hover();await c.getByRole('button',{name:'Settings',exact:true}).click();
  const dialog=page.locator('dialog[open]');
  await expect(dialog.getByRole('button',{name:'Google authentication profile',exact:true})).toHaveText('Work · alice@example.com');
  await dialog.getByText('Add or reconnect an account',{exact:true}).click();
  await dialog.getByLabel('Profile name',{exact:true}).fill('New account');
  await page.route('**/remote/google-profile-start',r=>r.fulfill({json:{id:'fake-login'}}));
  await page.route('**/remote/google-profile-status',r=>r.fulfill({json:{state:'error',error:'Google sign-in cancelled; existing accounts unchanged.'}}));
  await dialog.getByRole('button',{name:'Add Google account…',exact:true}).click();
  await expect(dialog).toContainText('Google sign-in cancelled');
  await expect(dialog.getByRole('button',{name:'Google authentication profile',exact:true})).toHaveText('Work · alice@example.com');
  await page.screenshot({path:'/tmp/mds-google-profiles.png',fullPage:true});
  expect(errors).toEqual([]);
});
