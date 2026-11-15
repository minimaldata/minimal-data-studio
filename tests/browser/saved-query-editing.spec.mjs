import {test,expect,open} from './fixtures.mjs';
test('saved query edits update the original and tab renames share its identity',async({page,studio})=>{
 await studio.writeScript('saved_queries.json',JSON.stringify({queries:[{id:'q',name:'Revenue',folder:'Reports',sql:'select 1 as value',lang:'sql',view:'chart',chart:{type:'bar',x:'value',y:['value']}}],notebooks:[],dashboards:[]}));
 const dialogs=[];page.on('dialog',async d=>{dialogs.push(d.message());await d.dismiss();});await open(page,studio.url);
 await page.getByRole('tab',{name:'Analyses',exact:true}).click();await page.locator('#saved .folder .nm').click();const savedRow=page.locator('#saved [data-query-id="q"]');await savedRow.locator('.nm').click();await expect(page.locator('#runBtn')).toBeEnabled();
 const tab=page.locator('#tabs [data-tab-key="saved:q"]');
 await page.locator('#editorWrap .CodeMirror').evaluate(el=>el.CodeMirror.setValue('select 2 as value'));await expect(tab.locator('.dot')).toBeVisible();
 await savedRow.locator('.nm').click();await expect(page.locator('#tabs [data-tab-key="saved:q"]')).toHaveCount(1);await expect(page.locator('#editorWrap .CodeMirror')).toContainText('select 2 as value');
 await page.locator('#saveBtn').click();await expect(tab.locator('.dot')).toHaveCount(0);
 const read=async()=>(await (await page.request.get(studio.url+'/saved_queries.json')).json()).queries;
 await expect.poll(async()=>(await read())[0].sql).toBe('select 2 as value');expect(await read()).toHaveLength(1);expect((await read())[0].folder).toBe('Reports');expect((await read())[0].chart.type).toBe('bar');
 await tab.locator('span').first().dblclick();const name=page.getByRole('textbox',{name:'Rename query tab',exact:true});await name.fill('Net revenue');await name.press('Enter');
 await expect(savedRow.locator('.nm span')).toHaveText('Net revenue');await expect.poll(async()=>(await read())[0].name).toBe('Net revenue');expect((await read())[0].id).toBe('q');
 await page.reload();await expect(page.locator('#tabs [data-tab-key="saved:q"]')).toContainText('Net revenue');expect(dialogs).toEqual([]);
});
