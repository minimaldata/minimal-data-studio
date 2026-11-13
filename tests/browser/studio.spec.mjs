import {test,expect,open,edit} from './fixtures.mjs';
test('formatted drafts survive reload and a new server port; SQL still runs',async({page,studio})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await open(page,studio.url);
  const code='SELECT\n  42 AS answer;';
  expect((await edit(page,code)).status()).toBe(200);
  await page.reload();await expect(page.locator('#editorWrap .CodeMirror-code')).toContainText('42 AS answer');
  await expect(page.locator('#workspaceNotice')).toBeHidden();
  await page.locator('#runBtn').click();await expect(page.locator('#results')).toContainText('42');
  const saved=await (await page.request.get(studio.url+'/editor-drafts')).json();
  expect(saved.state.tabs[0].sql).toBe(code);
  const next=await studio.restart();expect(next).not.toBe(studio.url);await open(page,next);
  await expect(page.locator('#editorWrap .CodeMirror-code')).toContainText('42 AS answer');
  await page.locator('#runBtn').click();await expect(page.locator('#results')).toContainText('42');
  expect(errors).toEqual([]);
});
test('second window follows saved code and transfers editing without overwriting',async({page,context,studio})=>{
  let originalWriter;page.on('request',r=>{if(r.url().endsWith('/editor-drafts')&&r.method()==='POST')originalWriter=r.headers()['x-client'];});
  await open(page,studio.url);const second=await context.newPage();await open(second,studio.url);
  await expect(second.locator('#workspaceNotice')).toContainText('Viewing only');
  expect((await edit(page,'SELECT 100 AS first_window;')).status()).toBe(200);
  await expect(second.locator('#editorWrap .CodeMirror-code')).toContainText('100 AS first_window');
  // Even a direct stale/missing-identity write is refused by the server.
  const denied=await second.request.post(studio.url+'/editor-drafts',{headers:{Origin:studio.url},data:{revision:0,state:{}}});expect(denied.status()).toBe(423);
  await second.getByRole('button',{name:'Edit here',exact:true}).click();
  await expect(page.locator('#workspaceNotice')).toContainText('viewing only',{ignoreCase:true});
  await expect(second.locator('#workspaceNotice')).toBeHidden();
  const stale=await page.request.post(studio.url+'/tasks/save',{headers:{Origin:studio.url,'X-Client':originalWriter},data:{}});expect(stale.status()).toBe(423);
  const dbSession=await (await page.request.post(studio.url+'/db/session',{headers:{Origin:studio.url}})).json();
  const mutation=await page.request.post(studio.url+'/db/query?session='+dbSession.session,{headers:{Origin:studio.url,'X-Client':originalWriter},data:{sql:'CREATE TABLE must_not_exist AS SELECT 1'}});expect(mutation.status()).toBe(423);
  const read=await page.request.post(studio.url+'/db/query?session='+dbSession.session,{headers:{Origin:studio.url},data:{sql:'SELECT 42'}});expect(read.status()).toBe(200);
  expect((await edit(second,'SELECT 200 AS second_window;')).status()).toBe(200);
  await expect(page.locator('#editorWrap .CodeMirror-code')).toContainText('200 AS second_window');
  await second.close();
  await page.getByRole('button',{name:'Edit here',exact:true}).click();await expect(page.locator('#workspaceNotice')).toBeHidden();
  expect((await edit(page,'SELECT 300 AS after_close;')).status()).toBe(200);
});
test('language menu anchors to its button and panels resize via keyboard',async({page,studio})=>{
  await open(page,studio.url);
  const button=page.getByRole('button',{name:'Language for Query 1',exact:true});
  await button.click();const menu=page.getByRole('listbox',{name:'Language for Query 1'});
  await expect(menu).toBeVisible();const b=await button.boundingBox(),m=await menu.boundingBox();
  expect(Math.abs(m.x-b.x)).toBeLessThan(8);expect(m.y).toBeGreaterThanOrEqual(b.y+b.height);
  await page.getByRole('option',{name:'Python',exact:true}).click();await expect(button).toHaveText('Python');
  await button.press('ArrowDown');await expect(menu).toBeVisible();await page.keyboard.press('Escape');await expect(menu).toBeHidden();
  await page.getByRole('button',{name:'Collapse explorer',exact:true}).click();await expect(page.locator('#explorerPanel')).toBeHidden();
  await page.locator('#toggleExplorer').click();await expect(page.locator('#explorerPanel')).toBeVisible();
  const handle=page.locator('#explorerResize');const before=Number(await handle.getAttribute('aria-valuenow'));
  await handle.press('ArrowRight');expect(Number(await handle.getAttribute('aria-valuenow'))).toBeGreaterThan(before);
});

test('Task editor saves files, runs, stops and retains unsaved tabs',async({page,studio})=>{
  await studio.writeScript('ingest.py',"print('Task completed', flush=True)");
  await open(page,studio.url);
  await page.getByRole('tab',{name:'Analyses',exact:true}).click();await expect(page.getByText('Query history',{exact:true})).toBeVisible();
  await page.getByRole('tab',{name:'Tasks',exact:true}).click();await page.getByRole('button',{name:'New task',exact:true}).click();
  const pane=page.locator('.task-pane:visible');
  await pane.getByLabel('Name',{exact:true}).fill('Ingest example');
  await pane.getByLabel('Use existing Python file').selectOption('ingest.py');
  await expect(pane.locator('.CodeMirror')).toContainText('Task completed');
  await pane.getByRole('button',{name:'Save and run',exact:true}).click();await expect(pane.locator('[data-status]')).toHaveText('succeeded');
  await expect(pane.getByLabel('Task output')).toContainText('Task completed');
  await pane.locator('.CodeMirror').click();await page.keyboard.press('ControlOrMeta+A');await page.keyboard.insertText("import time\nprint('Waiting',flush=True)\ntime.sleep(60)");
  await page.locator('#tabs .tab').filter({hasText:'Query 1'}).click();
  await page.locator('#tabs .tab').filter({hasText:'Ingest example'}).click();
  await expect(pane.locator('.CodeMirror')).toContainText('Waiting');
  await pane.getByRole('button',{name:'Save and run',exact:true}).click();await expect(pane.getByLabel('Task output')).toContainText('Waiting');
  await pane.getByRole('button',{name:'Stop',exact:true}).click();await expect(pane.locator('[data-status]')).toHaveText('stopped');
  await studio.writeScript('ingest.py',"print('external change')");
  await pane.locator('.CodeMirror').click();await page.keyboard.press('ControlOrMeta+A');await page.keyboard.insertText("print('my unsaved change')");
  await pane.getByRole('button',{name:'Save script',exact:true}).click();await expect(pane.locator('[data-error]')).toContainText('changed outside');
  await expect(pane.locator('.CodeMirror')).toContainText('my unsaved change');
});

test('New tasks create a Python file from an editor tab',async({page,studio})=>{
  await open(page,studio.url);await page.getByRole('tab',{name:'Tasks',exact:true}).click();await page.getByRole('button',{name:'New task',exact:true}).click();
  const pane=page.locator('.task-pane:visible');await pane.getByLabel('Name',{exact:true}).fill('Hello task');
  await expect(pane.getByLabel('Python file',{exact:true})).toHaveValue('scripts/hello_task.py');
  await pane.locator('.CodeMirror').click();await page.keyboard.insertText("print('Created in Studio')");
  await pane.getByRole('button',{name:'Save and run',exact:true}).click();await expect(pane.locator('[data-status]')).toHaveText('succeeded');
  await expect(pane.getByLabel('Task output')).toContainText('Created in Studio');
  await page.reload();await page.getByRole('tab',{name:'Tasks',exact:true}).click();await page.locator('#taskList button').filter({hasText:'Hello task'}).click();
  await expect(pane.locator('.CodeMirror')).toContainText('Created in Studio');
});

test('Required credential indicator and manager link',async({page,studio})=>{
  let connected=false,managed=false;
  await page.route('**/tasks/credentials',route=>route.fulfill({json:{credentials:connected?[{id:'test-key',name:'CFBD_API_KEY'}]:[]}}));
  await page.route('**/tasks/manage-credentials',route=>{managed=true;return route.fulfill({json:{opened:true}});});
  await open(page,studio.url);await page.getByRole('tab',{name:'Tasks',exact:true}).click();await page.getByRole('button',{name:'New task',exact:true}).click();
  const pane=page.locator('.task-pane:visible');await expect(pane.getByRole('button',{name:'Credentials: none selected'})).toBeVisible();
  await pane.getByLabel('Name',{exact:true}).fill('Requires CFBD');await pane.getByLabel('Required environment names').fill('CFBD_API_KEY');
  await expect(pane.getByRole('button',{name:'Required credential missing'})).toBeVisible();await expect(pane.getByRole('button',{name:'Save and run',exact:true})).toBeDisabled();
  await pane.getByRole('button',{name:'Save script',exact:true}).click();
  await pane.getByRole('button',{name:'Manage credentials…',exact:true}).click();expect(managed).toBe(true);
  connected=true;await pane.getByRole('button',{name:'Check credentials',exact:true}).click();await pane.locator('[data-credentials] input[type=checkbox]').check();
  await expect(pane.getByRole('button',{name:'1 credential connected'})).toBeVisible();await expect(pane.getByRole('button',{name:'Save and run',exact:true})).toBeEnabled();
  await pane.getByRole('button',{name:'Save script',exact:true}).click();await page.reload();await page.getByRole('tab',{name:'Tasks',exact:true}).click();await page.locator('#taskList button').filter({hasText:'Requires CFBD'}).click();
  await expect(pane.getByRole('button',{name:'1 credential connected'})).toBeVisible();await pane.getByRole('button',{name:'1 credential connected'}).click();await expect(pane.getByLabel('Required environment names')).toHaveValue('CFBD_API_KEY');
  connected=false;await pane.getByRole('button',{name:'Check credentials',exact:true}).click();await expect(pane.getByRole('button',{name:'Run',exact:true})).toBeDisabled();await expect(pane.getByRole('button',{name:'Required credential missing'})).toBeVisible();
});

test('Task schedule requires a successful run, shows next run and pauses',async({page,studio})=>{
  await open(page,studio.url);await page.getByRole('tab',{name:'Tasks',exact:true}).click();await page.getByRole('button',{name:'New task',exact:true}).click();
  const pane=page.locator('.task-pane:visible'),schedule=pane.locator('.task-schedule');
  await pane.getByLabel('Name',{exact:true}).fill('Scheduled hello');await pane.locator('.CodeMirror').click();await page.keyboard.insertText("print('hello')");
  await pane.getByRole('button',{name:'Save script',exact:true}).click();await schedule.locator('summary').click();
  await schedule.getByRole('button',{name:'Enable schedule',exact:true}).click();await expect(schedule.locator('[data-schedule-error]')).toContainText('successfully once');
  await pane.getByRole('button',{name:'Run',exact:true}).click();await expect(pane.locator('[data-status]')).toHaveText('succeeded');
  await schedule.getByRole('combobox',{name:'Repeat',exact:true}).selectOption('weekly');await schedule.getByLabel('Time zone',{exact:true}).fill('America/New_York');
  await schedule.getByRole('button',{name:'Enable schedule',exact:true}).click();await expect(schedule.locator('[data-next]')).toContainText('Next run:');
  await schedule.getByRole('button',{name:'Pause schedule',exact:true}).click();await expect(schedule.locator('[data-next]')).toContainText('Schedule paused');
  await schedule.getByRole('button',{name:'Resume schedule',exact:true}).click();await expect(schedule.locator('[data-next]')).toContainText('Next run:');
  await page.reload();await page.getByRole('tab',{name:'Tasks',exact:true}).click();await page.locator('#taskList button').filter({hasText:'Scheduled hello'}).click();await schedule.locator('summary').click();await expect(schedule.getByRole('combobox',{name:'Repeat',exact:true})).toHaveValue('weekly');await expect(schedule.locator('[data-next]')).toContainText('America/New_York');
  await schedule.getByRole('button',{name:'Pause schedule',exact:true}).click();
});

test('Notebook and dashboard tabs retain state and closing keeps saved documents',async({page,studio})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await open(page,studio.url);
  await page.getByRole('tab',{name:'Analyses',exact:true}).click();
  async function create(button,name){page.once('dialog',d=>d.accept(name));await page.locator(button).click();}
  const tab=name=>page.locator('#tabs .analysis-tab').filter({hasText:name});
  await create('#newNotebook','Notebook A');await expect(tab('Notebook A')).toBeVisible();
  const editor=page.locator('#nbCells .CodeMirror').first();
  await editor.click();await page.keyboard.press('ControlOrMeta+A');await page.keyboard.insertText('SELECT 111 AS original;');
  await page.locator('#nbRunAll').click();await expect(page.locator('#nbCells')).toContainText('111');await expect(page.locator('#nbStatus')).toHaveText('');
  await page.locator('#tabs .tab').filter({hasText:'Query 1'}).click();await expect(page.locator('#editorWrap')).toBeVisible();
  await tab('Notebook A').click();await expect(editor).toContainText('111 AS original');await expect(page.locator('#nbCells .stat')).toContainText('111');
  await create('#newNotebook','Notebook B');await expect(tab('Notebook B')).toBeVisible();
  await editor.click();await page.keyboard.press('ControlOrMeta+A');await page.keyboard.insertText('SELECT 222 AS other;');
  await page.locator('#nbRunAll').click();await expect(page.locator('#nbCells .stat')).toContainText('222');await expect(page.locator('#nbStatus')).toHaveText('');
  await tab('Notebook A').click();await expect(page.locator('#nbCells .stat')).toContainText('111');
  // q1 must still refer to A's complete temporary table after visiting B.
  await page.locator('#tabs .tab').filter({hasText:'Query 1'}).click();await edit(page,'SELECT * FROM q1;');await page.locator('#runBtn').click();await expect(page.locator('#results')).toContainText('111');
  await create('#newDashboard','Dashboard A');await expect(tab('Dashboard A')).toBeVisible();await expect(page.locator('#dashEditBtn')).toHaveText('Done');
  await page.locator('#dashAdd').selectOption({label:'Average sepal length by species'});
  await expect(page.locator('#dashBody .tile')).toHaveCount(1);
  await expect(page.locator('#dashBody .tile .empty')).toHaveCount(0);
  await tab('Notebook A').click();await expect(editor).toContainText('111 AS original');
  await tab('Dashboard A').click();await expect(page.locator('#dashEditBtn')).toHaveText('Done');
  await create('#newDashboard','Dashboard B');await expect(tab('Dashboard B')).toBeVisible();
  await tab('Dashboard A').click();await expect(page.locator('#dashEditBtn')).toHaveText('Done');
  await expect(page.locator('#dashBody .tile')).toHaveCount(1);await expect(page.locator('#dashBody .tile .empty')).toHaveCount(0);
  await page.getByRole('button',{name:'Close Notebook A',exact:true}).click();await expect(tab('Notebook A')).toHaveCount(0);
  await expect(page.locator('#nbList')).toContainText('Notebook A');
  await page.locator('#nbList .saved').filter({hasText:'Notebook A'}).click();await expect(editor).toContainText('111 AS original');
  await page.getByRole('button',{name:'Close Dashboard A',exact:true}).click();await expect(tab('Dashboard A')).toHaveCount(0);await expect(page.locator('#dashList')).toContainText('Dashboard A');
  const work=await (await page.request.get(studio.url+'/saved_queries.json')).json();
  expect(work.notebooks.find(n=>n.name==='Notebook A').cells[0].source).toBe('SELECT 111 AS original;');
  expect(work.dashboards.find(d=>d.name==='Dashboard A').tiles).toHaveLength(1);
  await page.reload();await expect(page.locator('#nbList')).toContainText('Notebook A');await expect(page.locator('#dashList')).toContainText('Dashboard A');
  expect(errors).toEqual([]);
});

test('Open analysis tabs restore across reload and server ports; closed tabs stay closed',async({page,studio})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await studio.writeScript('saved_queries.json',JSON.stringify({queries:[],notebooks:[
    {id:'n1',name:'Notes one',cells:[{id:'c1',type:'sql',name:'q1',source:'SELECT 987654 AS never_auto_run;',view:'table'}]},
    {id:'n2',name:'Notes two',cells:[]}
  ],dashboards:[{id:'d1',name:'Dashboard one',tiles:[]},{id:'d2',name:'Dashboard two',tiles:[]}]}));
  await open(page,studio.url);await edit(page,'SELECT 123 AS keep_query;');
  await page.getByRole('tab',{name:'Analyses',exact:true}).click();
  const tab=name=>page.locator('#tabs .analysis-tab').filter({hasText:name});
  for(const name of ['Notes one','Dashboard one','Notes two','Dashboard two']){
    await page.locator('#nbList .saved, #dashList .saved').filter({hasText:name}).click();await expect(tab(name)).toBeVisible();
  }
  await tab('Notes one').click();await expect(page.locator('#nbTitle')).toHaveText('Notes one');
  async function saved(url,active,count){await expect.poll(async()=>{
    const work=await (await page.request.get(url+'/saved_queries.json')).json();return [work.workspace_tabs?.active,work.workspace_tabs?.analyses.length];
  }).toEqual([active,count]);}
  await saved(studio.url,'notebook:n1',4);
  await page.reload();await expect(page.locator('#tabs .analysis-tab')).toHaveCount(4);
  await expect(page.locator('#nbTitle')).toHaveText('Notes one');await expect(page.locator('#nbCells')).toContainText('Not run yet');
  await expect(page.locator('#nbCells .CodeMirror')).toContainText('never_auto_run');
  await page.getByRole('button',{name:'Close Notes two',exact:true}).click();await expect(tab('Notes two')).toHaveCount(0);
  await tab('Dashboard one').click();await saved(studio.url,'dashboard:d1',3);
  const url=await studio.restart();await open(page,url);
  await expect(page.locator('#tabs .analysis-tab')).toHaveCount(3);await expect(page.locator('#dash')).toBeVisible();await expect(page.locator('#dashTitle')).toHaveText('Dashboard one');
  await expect(tab('Notes two')).toHaveCount(0);await expect(page.locator('#nbList')).toContainText('Notes two');
  await page.locator('#tabs .tab').filter({hasText:'Query 1'}).click();await saved(url,null,3);
  await page.reload();await expect(page.locator('#editorWrap')).toBeVisible();await expect(page.locator('#editorWrap .CodeMirror')).toContainText('123 AS keep_query');
  // An externally deleted document must not reappear as a broken tab.
  const work=await (await page.request.get(url+'/saved_queries.json')).json();work.notebooks=[];
  await studio.writeScript('saved_queries.json',JSON.stringify(work));await page.reload();await expect(page.locator('#tabs .analysis-tab')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('editing transfer waits for unsaved task code and can be cancelled',async({page,context,studio})=>{
  await open(page,studio.url);await page.getByRole('tab',{name:'Tasks',exact:true}).click();await page.getByRole('button',{name:'New task',exact:true}).click();
  const pane=page.locator('.task-pane:visible');await pane.getByLabel('Name',{exact:true}).fill('Keep this task');
  await pane.locator('.CodeMirror').click();await page.keyboard.insertText("print('unsaved script')");
  const second=await context.newPage();await open(second,studio.url);await second.getByRole('button',{name:'Edit here',exact:true}).click();
  await expect(page.locator('#workspaceNotice')).toContainText('Save or close unsaved task scripts');
  await expect(pane.locator('.CodeMirror')).toContainText('unsaved script');
  await second.getByRole('button',{name:'Cancel request',exact:true}).click();await expect(page.locator('#workspaceNotice')).toBeHidden();
  await pane.getByRole('button',{name:'Save script',exact:true}).click();await expect(pane.locator('[data-status]')).toHaveText('Not run');
  await second.getByRole('button',{name:'Edit here',exact:true}).click();await expect(second.locator('#workspaceNotice')).toBeHidden();
  await second.getByRole('tab',{name:'Tasks',exact:true}).click();await second.locator('#taskList button').filter({hasText:'Keep this task'}).click();
  await expect(second.locator('.task-pane:visible .CodeMirror')).toContainText('unsaved script');
});

test('a newly opened tab cannot inherit editing from copied session storage',async({page,studio})=>{
  await open(page,studio.url);
  const popupPromise=page.waitForEvent('popup');
  await page.evaluate(()=>window.open(location.href,'_blank'));
  const popup=await popupPromise;
  await expect(popup.locator('#status')).toContainText('Ready');
  await expect(popup.locator('#workspaceNotice')).toContainText('Viewing only');
  await expect(page.locator('#workspaceNotice')).toBeHidden();
  expect((await edit(page,'SELECT 88 AS original_writer;')).status()).toBe(200);
  await popup.reload();
  await expect(popup.locator('#workspaceNotice')).toContainText('Viewing only');
});

test('native runtime checks retain narrowly scoped access while browser writes are locked',async({page,studio})=>{
  await open(page,studio.url);
  const headers={Origin:studio.url};
  const denied=await page.request.post(studio.url+'/kernel/input?run=native-probe&name=probe',{headers,data:'test'});
  expect(denied.status()).toBe(423);
  headers['X-Studio-Token']=await studio.managerToken();
  const allowed=await page.request.post(studio.url+'/kernel/input?run=native-probe&name=probe',{headers,data:'test'});
  expect(allowed.status()).toBe(204);
  const unrelated=await page.request.post(studio.url+'/tasks/save',{headers,data:{}});
  expect(unrelated.status()).toBe(423);
});

test('overflowing tabs leave room for overlay scrollbars and remain usable',async({page,studio})=>{
  await open(page,studio.url);
  for(let i=0;i<12;i++)await page.locator('#tabs [title="New tab"]').click();
  const strip=page.locator('#tabs');
  const geometry=await strip.evaluate(el=>{const tab=el.querySelector('.tab'),r=el.getBoundingClientRect(),t=tab.getBoundingClientRect();return {overflow:el.scrollWidth>el.clientWidth,gap:r.bottom-t.bottom};});
  expect(geometry.overflow).toBe(true);expect(geometry.gap).toBeGreaterThanOrEqual(16);
  await strip.locator('.tab').filter({hasText:/^Query 1SQL/}).first().click();
  await expect(strip.locator('.tab.active')).toContainText('Query 1');
  await strip.locator('.tab').filter({hasText:/^Query 13SQL/}).click();
  await expect(strip.locator('.tab.active')).toContainText('Query 13');
  await strip.locator('.tab.active .x').click();await expect(strip.locator('.tab').filter({hasText:/^Query 13SQL/})).toHaveCount(0);
  await page.screenshot({path:'/tmp/mds-tab-scrollbar.png'});
});


test('SQL definition long lines preserve editor caret geometry',async({page,studio})=>{
  await open(page,studio.url);
  await edit(page,'CREATE VIEW caret_example AS SELECT 1 AS answer;');
  await page.locator('#runBtn').click();
  await page.getByRole('button',{name:'caret_example',exact:true}).hover();
  await page.getByRole('button',{name:'Open caret_example',exact:true}).click();
  const editor=page.locator('.object-code-host .CodeMirror');
  await expect(editor).toBeVisible();
  await editor.click();await page.keyboard.press('ControlOrMeta+A');
  const sql="SELECT '"+'long value '.repeat(50)+"' AS answer;";
  await page.keyboard.insertText(sql);
  const geometry=await editor.evaluate(el=>{
    const cm=el.CodeMirror;
    const line=el.querySelector('.CodeMirror-code pre');
    const caret=cm.cursorCoords(null,'local');
    return {whiteSpace:getComputedStyle(line).whiteSpace,lineHeight:line.getBoundingClientRect().height,
      textHeight:cm.defaultTextHeight(),caretHeight:caret.bottom-caret.top,code:cm.getValue()};
  });
  expect(geometry.code).toBe(sql);
  expect(geometry.whiteSpace).toBe('pre');
  expect(geometry.lineHeight).toBeLessThan(geometry.textHeight*1.2);
  expect(geometry.caretHeight).toBeLessThan(geometry.textHeight*1.2);
  await page.keyboard.press('ArrowLeft');await page.keyboard.insertText('X');
  expect(await editor.evaluate(el=>el.CodeMirror.getValue())).toBe(sql.slice(0,-1)+'X;');
});
