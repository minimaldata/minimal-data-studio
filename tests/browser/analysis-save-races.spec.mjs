import {test,expect,open} from './fixtures.mjs';

test('background saved-work response preserves an open notebook assumptions menu',async({page,studio})=>{
 await studio.writeScript('saved_queries.json',JSON.stringify({queries:[],dashboards:[],notebooks:[{id:'n',name:'Race notebook',cells:[{id:'q',type:'sql',name:'q1',source:'select 1',view:'table'}]}]}));
 await open(page,studio.url);await page.getByRole('tab',{name:'Analyses',exact:true}).click();
 await page.locator('#nbList .nm').filter({hasText:'Race notebook'}).click();
 await expect.poll(async()=>{const data=await (await page.request.get(studio.url+'/saved_queries.json')).json();return data.workspace_tabs?.active;}).toBe('notebook:n');
 await expect(page.locator('#nb')).not.toHaveAttribute('inert','');
 let release,started;const held=new Promise(r=>release=r),saving=new Promise(r=>started=r);
 await page.route('**/saved_queries.json',async route=>{
  if(route.request().method()==='POST'){const response=await route.fetch();started();await held;await route.fulfill({response});}else await route.continue();
 });
 await page.locator('#nbCells .CodeMirror').click();await page.keyboard.press('ControlOrMeta+A');await page.keyboard.insertText('select 2');
 // Use an existing notebook control while an unrelated save response is pending.
 await saving;
 await page.locator('#nbCells .adder.end').getByRole('button',{name:'Add assumptions',exact:true}).click();
 const option=page.getByRole('option',{name:'Values over time',exact:true});await expect(option).toBeVisible();
 const tab=await page.locator('#tabs .analysis-tab').elementHandle();
 const response=page.waitForResponse(r=>r.url().endsWith('/saved_queries.json')&&r.request().method()==='POST');release();await response;await page.waitForFunction(el=>!el.isConnected,tab);
 await expect(option).toBeVisible();await page.unrouteAll({behavior:'wait'});await option.click();await expect(page.locator('#nbCells .cell.assumption')).toBeVisible();
});

test('opening a notebook saves its tab before it becomes interactive',async({page,studio})=>{
 await studio.writeScript('saved_queries.json',JSON.stringify({queries:[],dashboards:[],notebooks:[{id:'n',name:'Remember me',cells:[]}]}));
 let release,started;const held=new Promise(r=>release=r),saving=new Promise(r=>started=r);
 await page.route('**/saved_queries.json',async route=>{
  if(route.request().method()==='POST'){started();await held;await route.continue();}else await route.continue();
 });
 await open(page,studio.url);await page.getByRole('tab',{name:'Analyses',exact:true}).click();await page.locator('#nbList .nm').filter({hasText:'Remember me'}).click();
 await saving;await expect(page.locator('#nb')).toHaveAttribute('inert','');release();
 await expect(page.locator('#nb')).not.toHaveAttribute('inert','');
 await page.reload();await expect(page.locator('#nbTitle')).toHaveText('Remember me');
});

test('background save preserves a tab context menu when the tabs have not changed',async({page,studio})=>{
 await studio.writeScript('saved_queries.json',JSON.stringify({queries:[],dashboards:[],notebooks:[{id:'n',name:'Context notebook',cells:[{id:'q',type:'sql',name:'q1',source:'select 1',view:'table'}]}]}));
 await open(page,studio.url);await page.getByRole('tab',{name:'Analyses',exact:true}).click();await page.locator('#nbList .nm').click();
 await expect(page.locator('#nb')).not.toHaveAttribute('inert','');
 let release,started;const held=new Promise(r=>release=r),saving=new Promise(r=>started=r);
 await page.route('**/saved_queries.json',async route=>{
  if(route.request().method()==='POST'){const response=await route.fetch();started();await held;await route.fulfill({response});}else await route.continue();
 });
 await page.locator('#nbCells .CodeMirror').click();await page.keyboard.type(' ');await saving;
 await page.locator('#tabs .analysis-tab').click({button:'right'});
 const action=page.getByRole('button',{name:'Close tab',exact:true});await expect(action).toBeVisible();
 const tab=await page.locator('#tabs .analysis-tab').elementHandle();release();await page.waitForFunction(el=>!el.isConnected,tab);
 await expect(action).toBeVisible();await page.unrouteAll({behavior:'wait'});await action.click();await expect(page.locator('#tabs .analysis-tab')).toHaveCount(0);
 await expect.poll(async()=>{const data=await (await page.request.get(studio.url+'/saved_queries.json')).json();return data.workspace_tabs?.analyses;}).toEqual([]);
});
