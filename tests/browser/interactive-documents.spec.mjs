import {test,expect,open,edit} from './fixtures.mjs';
test('interactive scenario saves code, inputs and results; sandbox has no host access',async({page,studio})=>{
 await open(page,studio.url);
 await page.locator('#explorerAnalysesTab').click();
 await page.getByRole('button',{name:'New interactive document',exact:true}).click();

 const frame=page.frameLocator('#interactiveDocument iframe');
 await expect(frame.locator('h1')).toHaveText('Compare growth scenarios');
 await frame.locator('#growthA').fill('35');
 await frame.locator('#simulate').click();
 await expect(frame.locator('table')).toContainText('135,000');
 await page.screenshot({path:'/tmp/mds-interactive-preview.png',fullPage:true});
 await page.locator('#interactiveDocument [data-action=save]').click();
 await expect(page.locator('.interactive-status')).toHaveText('Saved');
 await page.reload();await expect(page.locator('#status')).toContainText('Ready');
 await page.locator('#explorerAnalysesTab').click();
 await page.locator('#interactiveList .saved').click();

 await expect(frame.locator('#growthA')).toHaveValue('35');
 await expect(frame.locator('table')).toContainText('135,000');
 // The frame cannot read the host DOM or call the loopback API.
 const isolated=await page.frames().find(f=>f.url()==='about:srcdoc').evaluate(async()=>{
 let parentBlocked=false,fetchBlocked=false;
 try{parent.document.body;}catch{parentBlocked=true;}
 try{await fetch('http://localhost:1/project-health');}catch{fetchBlocked=true;}
 return {parentBlocked,fetchBlocked};
 });
 expect(isolated).toEqual({parentBlocked:true,fetchBlocked:true});
 await page.locator('#interactiveDocument [data-action=edit]').click();
 await page.getByRole('textbox',{name:'JavaScript',exact:true}).fill('throw Error("visible failure")');
 await page.locator('#interactiveDocument [data-action=preview]').click();
 await expect(page.locator('.interactive-status')).toContainText('visible failure');
});

test('input snapshot is explicit and ordinary query still works',async({page,studio})=>{
 await open(page,studio.url);await edit(page,'select 250000 as revenue');await page.locator('#runBtn').click();
 await expect(page.locator('#results')).toContainText('250000');
 await page.locator('#explorerAnalysesTab').click();await page.getByRole('button',{name:'New interactive document',exact:true}).click();
 await page.locator('[data-action=edit]').click();
 await page.locator('.interactive-manual-inputs summary').click();
 await page.locator('[data-action=snapshot]').click();
 await page.locator('#interactiveDocument [data-action=preview]').click();
 const frame=page.frameLocator('#interactiveDocument iframe');await expect(frame.locator('#baseline')).toContainText('250,000');
 await frame.locator('#simulate').click();await expect(frame.locator('table')).toContainText('275,000');
 await page.locator('#interactiveDocument [data-action=save]').click();await expect(page.locator('.interactive-status')).toHaveText('Saved');
 await page.locator('#tabs .tab').first().click();await expect(page.locator('#editorWrap')).toBeVisible();
 await expect(page.locator('#interactiveDocument iframe')).toHaveCount(0);
});

test('viewers can open previews but cannot save; stale revisions retain local edits',async({page,context,studio})=>{
 await open(page,studio.url);await page.locator('#explorerAnalysesTab').click();await page.getByRole('button',{name:'New interactive document',exact:true}).click();
 await page.locator('#interactiveDocument [data-action=save]').click();await expect(page.locator('.interactive-status')).toHaveText('Saved');
 const viewer=await context.newPage();await open(viewer,studio.url);await viewer.locator('#explorerAnalysesTab').click();await viewer.locator('#interactiveList .saved').click();await viewer.locator('#interactiveDocument [data-action=preview]').click();
 await expect(viewer.frameLocator('#interactiveDocument iframe').locator('h1')).toBeVisible();
 expect(await viewer.evaluate(async()=>{const state=await (await fetch('/interactive-documents')).json();return (await fetch('/interactive-documents',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(state)})).status;})).toBe(423);
 await viewer.close();
 await page.evaluate(async()=>{const state=await (await fetch('/interactive-documents')).json();await fetch('/interactive-documents',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(state)});});
 await page.locator('[data-action=edit]').click();
 await page.getByRole('textbox',{name:'HTML',exact:true}).fill('<h1>Keep my edits</h1>');
 await page.locator('#interactiveDocument [data-action=save]').click();await expect(page.locator('.interactive-status')).toContainText('changed in another window');
 await expect(page.getByRole('textbox',{name:'HTML',exact:true})).toHaveValue('<h1>Keep my edits</h1>');
});

test('folder apps expose nested read-only sources; saving state never overwrites agent files',async({page,studio})=>{
 await studio.writeScript('interactive/demo/app.json',JSON.stringify({format:1,name:'Folder simulator',entry:'index.html',styles:['styles.css'],scripts:['components/model.js']}));
 await studio.writeScript('interactive/demo/index.html','<h1>Folder app</h1><button id="add">Add one</button><output id="count"></output>');
 await studio.writeScript('interactive/demo/styles.css','body {font-family:system-ui;padding:20px}');
 const script='const state=studio.state; const render=()=>document.querySelector("#count").textContent=state.count||0;document.querySelector("#add").onclick=()=>{state.count=(state.count||0)+1;studio.saveState(state);render()};render();';
 await studio.writeScript('interactive/demo/components/model.js',script);
 await open(page,studio.url);await page.locator('#explorerAnalysesTab').click();
 await page.locator('.interactive-attach summary').click();await page.getByLabel('App folder path').fill('interactive/demo');await page.getByRole('button',{name:'Open folder',exact:true}).click();
 await page.getByRole('button',{name:'Show files for Folder simulator'}).click();
 await expect(page.locator('.interactive-files')).toBeVisible();await page.locator('.interactive-files summary').filter({hasText:'components'}).click();
 await page.getByRole('button',{name:'model.js',exact:true}).click();expect(await page.locator('.interactive-source .CodeMirror').evaluate(el=>el.CodeMirror.getValue())).toBe(script);
 await expect(page.locator('#tabs .tab.active')).toContainText('model.js');await expect(page.locator('.interactive-source')).toContainText('Read-only source');
 await expect(page.locator('.interactive-source .cm-keyword').first()).toBeVisible();await page.getByRole('button',{name:'Wrap lines',exact:true}).click();await expect(page.getByRole('button',{name:'Wrap lines',exact:true})).toHaveAttribute('aria-pressed','true');expect(await page.locator('.interactive-source .CodeMirror').evaluate(el=>el.CodeMirror.getOption('readOnly'))).toBe(true);expect(await page.locator('.interactive-source .CodeMirror').evaluate(el=>el.CodeMirror.getValue())).toBe(script);
 await expect(page.locator('#tabs .tab.active')).toHaveClass(/preview-tab/);
 await page.getByRole('button',{name:'styles.css',exact:true}).click();
 await expect(page.locator('#tabs .tab').filter({hasText:'model.js'})).toHaveCount(0);
 await expect(page.locator('#tabs .tab.active')).toContainText('styles.css');
 await page.getByRole('button',{name:'Keep styles.css open',exact:true}).click();
 await page.getByRole('button',{name:'model.js',exact:true}).click();
 await expect(page.locator('#tabs .tab').filter({hasText:'styles.css'})).toHaveCount(1);
 await expect(page.locator('#tabs .tab.active')).toHaveClass(/preview-tab/);
 await page.evaluate(()=>document.documentElement.dataset.theme='dark');
 expect(await page.locator('#tabs').evaluate(el=>getComputedStyle(el).colorScheme)).toBe('dark');
 expect(await page.locator('.source-code').evaluate(el=>getComputedStyle(el).colorScheme)).toBe('dark');
 await page.screenshot({path:'/tmp/mds-source-dark.png',fullPage:true});
 await page.evaluate(()=>document.documentElement.dataset.theme='light');
 expect(await page.locator('#tabs').evaluate(el=>getComputedStyle(el).colorScheme)).toBe('light');
 await page.getByRole('button',{name:'Open app',exact:true}).click();await page.locator('[data-action=preview]').click();
 const frame=page.frameLocator('#interactiveDocument iframe');await expect(frame.locator('h1')).toHaveText('Folder app');await frame.locator('#add').click();await expect(frame.locator('#count')).toHaveText('1');
 await page.locator('[data-action=save]').click();await expect(page.locator('.interactive-status')).toHaveText('Saved');
 await studio.writeScript('interactive/demo/index.html','<h1>Agent updated app</h1><button id="add">Add one</button><output id="count"></output>');
 await page.locator('[data-action=preview]').click();await expect(frame.locator('h1')).toHaveText('Agent updated app');await expect(frame.locator('#count')).toHaveText('1');
 await page.reload();await expect(page.locator('#status')).toContainText('Ready');await page.locator('#explorerAnalysesTab').click();await page.locator('#interactiveList .saved').click();await page.locator('[data-action=preview]').click();await expect(frame.locator('#count')).toHaveText('1');
 await page.getByRole('button',{name:'Show files for Folder simulator'}).click();await page.getByRole('button',{name:'index.html',exact:true}).click();expect(await page.locator('.interactive-source .CodeMirror').evaluate(el=>el.CodeMirror.getValue())).toContain('Agent updated app');
 await page.screenshot({path:'/tmp/mds-interactive-files.png',fullPage:true});
});

test('opening previews directly; fullscreen and fallback preserve scenario state',async({page,studio})=>{
 await open(page,studio.url);await page.locator('#explorerAnalysesTab').click();await page.getByRole('button',{name:'New interactive document',exact:true}).click();
 const frame=page.frameLocator('#interactiveDocument iframe');await expect(frame.locator('h1')).toBeVisible();await frame.locator('#growthA').fill('42');
 await page.getByRole('button',{name:'Enter fullscreen',exact:true}).click();await expect(page.getByRole('button',{name:'Exit fullscreen',exact:true})).toBeVisible();
 await expect(frame.locator('#growthA')).toHaveValue('42');await page.getByRole('button',{name:'Exit fullscreen',exact:true}).click();
 await expect(page.getByRole('button',{name:'Enter fullscreen',exact:true})).toBeVisible();await expect(frame.locator('#growthA')).toHaveValue('42');
 await page.locator('#interactiveDocument').evaluate(el=>el.requestFullscreen=undefined);
 await page.getByRole('button',{name:'Enter fullscreen',exact:true}).click();await expect(page.locator('#interactiveDocument')).toHaveClass(/interactive-expanded/);
 await frame.locator('#growthA').press('Escape');await expect(page.locator('#interactiveDocument')).not.toHaveClass(/interactive-expanded/);
 await expect(frame.locator('#growthA')).toHaveValue('42');
});

test('named bindings refresh explicitly, preserve scenarios, and flag changed data',async({page,studio})=>{
 const {readFile}=await import('node:fs/promises');
 for(const file of ['app.json','index.html','styles.css','components/simulation.js','queries/history.sql'])await studio.writeScript('interactive/mdm/'+file,await readFile(new URL('../../examples/interactive/mdm-revenue-simulator/'+file,import.meta.url),'utf8'));
 await open(page,studio.url);
 async function sql(code){return await page.evaluate(async sql=>{const session=await (await fetch('/db/session',{method:'POST'})).json();try{const r=await fetch('/db/query?session='+session.session,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sql})});if(!r.ok)throw Error(await r.text());}finally{await fetch('/db/close?session='+session.session,{method:'POST'});}},code);}
 await sql("CREATE TABLE input_data AS SELECT DATE '2028-12-31' month_end, 100000::DECIMAL(20,2) mrr_usd");await sql('CREATE VIEW saas_subscription_kpis AS SELECT * FROM input_data');
 await page.locator('#explorerAnalysesTab').click();await page.locator('.interactive-attach summary').click();await page.getByLabel('App folder path').fill('interactive/mdm');await page.getByRole('button',{name:'Open folder',exact:true}).click();
 await page.locator('[data-action=edit]').click();
 await expect(page.locator('.interactive-input-requirements')).toContainText('month_end · date');
 await expect(page.locator('.interactive-binding-row')).toContainText('SQL file · queries/history.sql');
 await expect(page.getByRole('button',{name:'Connect source',exact:true})).toBeHidden();
 const tabCount=await page.locator('#tabs .tab').count();
 await page.getByRole('button',{name:'Inspect SQL',exact:true}).click();
 await expect(page.locator('.interactive-binding-row .CodeMirror')).toContainText('FROM saas_subscription_kpis');
 expect(await page.locator('.input-sql-preview .CodeMirror').evaluate(el=>el.CodeMirror.getOption('readOnly'))).toBe(false);
 await expect(page.locator('#tabs .tab')).toHaveCount(tabCount);
 await expect(page.locator('.interactive-bindings')).toBeVisible();
 await page.locator('.input-sql-preview .CodeMirror').evaluate(el=>el.CodeMirror.setValue('SELECT month_end, mrr_usd * 100000 AS mrr_usd FROM saas_subscription_kpis'));
 await page.getByRole('button',{name:'Run SQL',exact:true}).click();
 await expect(page.locator('.sql-results')).toContainText('10000000000');await expect(page.locator('.sql-results summary')).toHaveText('SQL preview results');
 await expect(page.locator('.sql-edit-status')).toContainText('Preview only');
 await expect(page.locator('.interactive-binding-row > small')).toHaveText('Not refreshed');
 await page.locator('.input-sql-preview .CodeMirror').evaluate(el=>el.CodeMirror.setValue('SELECT month_end, mrr_usd FROM saas_subscription_kpis ORDER BY month_end; -- edited'));
 await page.getByRole('button',{name:'Hide SQL',exact:true}).click();await page.getByRole('button',{name:'Inspect SQL',exact:true}).click();
 await expect(page.locator('.input-sql-preview .CodeMirror')).toContainText('-- edited');
 await page.getByRole('button',{name:'Save SQL',exact:true}).click();await expect(page.locator('.sql-edit-status')).toContainText('SQL saved. Inputs have not been refreshed');
 await page.getByRole('button',{name:'Save & refresh',exact:true}).click();await expect(page.locator('.sql-edit-status')).toContainText('SQL saved and inputs refreshed');
 await expect(page.locator('.sql-results')).toContainText('100000');await expect(page.locator('.interactive-binding-row > small')).toContainText('1 rows');
 await page.screenshot({path:'/tmp/mds-inline-sql.png',fullPage:true});
 await page.getByRole('button',{name:'Hide SQL',exact:true}).click();
 await expect(page.locator('.input-sql-preview')).toBeHidden();
 await expect(page.locator('#tabs .tab')).toHaveCount(tabCount);
 await page.getByRole('button',{name:'Refresh inputs',exact:true}).click();await expect(page.locator('.interactive-binding-row')).toContainText('1 rows');
 await page.locator('[data-action=preview]').click();const frame=page.frameLocator('#interactiveDocument iframe');await expect(frame.locator('#baseline')).toContainText('$100,000');await frame.locator('#run').click();await expect(frame.locator('#notice')).toContainText('matches');
 await frame.getByRole('button',{name:'Save results as table',exact:true}).click();
 const exportDialog=page.locator('#interactiveResultTableDialog');await expect(exportDialog).toContainText('12 rows');
 await exportDialog.getByLabel('Table name').fill('input_data');await exportDialog.getByRole('button',{name:'Create table',exact:true}).click();
 await expect(exportDialog.getByRole('alert')).toContainText('already exists');
 await exportDialog.getByLabel('Database folder').fill('Scenarios/Revenue');await exportDialog.getByLabel('Table name').fill('scenario_revenue');await exportDialog.getByRole('button',{name:'Create table',exact:true}).click();
 await expect(exportDialog).toHaveCount(0);await expect(page.locator('.interactive-status')).toContainText('Created scenario_revenue · 12 rows');
 expect(await page.evaluate(async()=>{const r=await fetch('/db/session',{method:'POST'});const {session}=await r.json();try{return (await (await fetch('/db/database-folders?session='+session,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'list'})})).json()).locations.scenario_revenue;}finally{await fetch('/db/close?session='+session,{method:'POST'});}})).toBe('Scenarios/Revenue');
 await frame.locator('#duplicate').click();await frame.locator('#name').fill('Expansion');await frame.locator('#name').press('Tab');await frame.locator('#growth').fill('2');await frame.locator('#run').click();
 await page.locator('[data-action=save]').click();await expect(page.locator('.interactive-status')).toHaveText('Saved');
 const savedRun=await frame.locator('#result-details').textContent();
 const savedComparison=await frame.locator('#comparison').textContent();
 await page.reload();await expect(page.locator('#status')).toContainText('Ready');await page.locator('#explorerAnalysesTab').click();await page.locator('#interactiveList .saved').click();
 await expect(frame.locator('#name')).toHaveValue('Expansion');await expect(frame.locator('#growth')).toHaveValue('2');await expect(frame.locator('#months')).toHaveValue('12');
 await expect(frame.locator('#comparison')).toHaveText(savedComparison);await expect(frame.locator('#result-details')).toHaveText(savedRun);await expect(frame.locator('#notice')).toContainText('matches');
 // An identical refresh changes its timestamp, not the result's validity.
 await page.locator('[data-action=edit]').click();await page.getByRole('button',{name:'Refresh inputs',exact:true}).click();await expect(page.locator('.interactive-bindings [role=status]')).toContainText('Complete snapshot');await page.locator('[data-action=preview]').click();
 await expect(frame.locator('#notice')).toContainText('matches');await expect(frame.locator('#result-details')).toHaveText(savedRun);
 // Contract failures keep the last complete snapshot and the scenario state.
 await sql('CREATE OR REPLACE VIEW saas_subscription_kpis AS SELECT month_end FROM input_data');
 await page.locator('[data-action=edit]').click();await page.getByRole('button',{name:'Refresh inputs',exact:true}).click();
 await expect(page.locator('.interactive-bindings [role=status]')).toContainText('mrr_usd');
 await expect(page.locator('.interactive-bindings [role=status]')).toContainText('Previous inputs were kept');
 await page.locator('[data-action=preview]').click();await expect(frame.locator('#baseline')).toContainText('$100,000');await expect(frame.locator('#result-details')).toHaveText(savedRun);
 await sql('CREATE OR REPLACE VIEW saas_subscription_kpis AS SELECT * FROM input_data');
 await sql('UPDATE input_data SET mrr_usd=200000');
 // Reloading the app uses the saved snapshot, not the changed table.
 await page.locator('[data-action=preview]').click();await expect(frame.locator('#baseline')).toContainText('$100,000');
 await page.locator('[data-action=edit]').click();await page.getByRole('button',{name:'Refresh inputs',exact:true}).click();await expect(page.locator('.interactive-bindings [role=status]')).toContainText('Complete snapshot');await page.locator('[data-action=preview]').click();await expect(frame.locator('#baseline')).toContainText('$200,000');await expect(frame.locator('#notice')).toContainText('Inputs changed');await expect(frame.locator('#notice')).toContainText('Previous results are retained');await expect(frame.locator('#result-details')).toContainText('Baseline: $100,000');await expect(frame.locator('#comparison')).toContainText('Expansion');
 await page.locator('[data-action=save]').click();await expect(page.locator('.interactive-status')).toHaveText('Saved');await page.reload();await expect(page.locator('#status')).toContainText('Ready');await page.locator('#explorerAnalysesTab').click();await page.locator('#interactiveList .saved').click();await expect(frame.locator('#baseline')).toContainText('$200,000');await expect(frame.locator('#comparison')).toContainText('Expansion');await expect(frame.locator('#notice')).toContainText('Inputs changed');
 await expect(frame.locator('#growth')).toHaveValue('2');await expect(frame.locator('#result-details')).toContainText('Baseline: $100,000');
 await frame.locator('#run').click();await expect(frame.locator('#notice')).toContainText('matches');await expect(frame.locator('#result-details')).toContainText('Baseline: $200,000');
 // Re-running only replaces the selected scenario; the other run is still outdated.
 await expect(frame.locator('#comparison .stale')).toHaveCount(1);
 await frame.locator('#growth').fill('3');await expect(frame.locator('#notice')).toContainText('Assumptions changed');
 await frame.locator('#growth').fill('2');await expect(frame.locator('#notice')).toContainText('matches');
 await page.locator('[data-action=save]').click();await expect(page.locator('.interactive-status')).toHaveText('Saved');
 await page.screenshot({path:'/tmp/mds-scenario-lifecycle.png',fullPage:true});
});


test('restart can resume unsaved interactive state without reloading',async({page,studio})=>{
 await open(page,studio.url);await page.locator('#explorerAnalysesTab').click();await page.getByRole('button',{name:'New interactive document',exact:true}).click();
 const frame=page.frameLocator('#interactiveDocument iframe');await expect(frame.locator('#growthA')).toBeVisible();
 await page.locator('[data-action=save]').click();await expect(page.locator('.interactive-status')).toHaveText('Saved');
 await page.waitForResponse(r=>r.url().endsWith('/workspace-access')&&r.request().postDataJSON()?.action==='heartbeat');
 await frame.locator('#growthA').fill('42');await frame.locator('#simulate').click();await expect(page.locator('.interactive-status')).toContainText('unsaved');
 const before=await frame.locator('table').textContent();await studio.restartSamePort();
 await expect(page.getByRole('button',{name:'Resume editing',exact:true})).toBeVisible({timeout:15000});
 await page.getByRole('button',{name:'Resume editing',exact:true}).click();await expect(page.locator('#workspaceNotice')).toBeHidden();
 await expect(frame.locator('#growthA')).toHaveValue('42');await expect(frame.locator('table')).toHaveText(before);
 await page.locator('[data-action=save]').click();await expect(page.locator('.interactive-status')).toHaveText('Saved');
});
