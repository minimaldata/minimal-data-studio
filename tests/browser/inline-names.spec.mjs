import {test,expect,open} from './fixtures.mjs';
test('saved queries notebooks and dashboards rename in their explorer row',async({page,studio})=>{
 const dialogs=[],errors=[];page.on('dialog',async d=>{dialogs.push(d.message());await d.dismiss();});page.on('pageerror',e=>errors.push(e.message));
 await studio.writeScript('saved_queries.json',JSON.stringify({queries:[{id:'q',name:'Original query',sql:'select 1',lang:'sql'}],notebooks:[{id:'n',name:'Original notebook',cells:[]}],dashboards:[{id:'d',name:'Original dashboard',tiles:[]}]}));
 await open(page,studio.url);await page.getByRole('tab',{name:'Analyses',exact:true}).click();
 for(const [selector,label,name] of [['#saved','Rename saved query','Renamed query'],['#nbList','Rename notebook','Renamed notebook'],['#dashList','Rename dashboard','Renamed dashboard']]){
  const row=page.locator(selector+' .saved');await row.hover();await row.locator('[title="Rename"]').click();const input=page.getByRole('textbox',{name:label,exact:true});await expect(input).toBeFocused();await expect(row.locator('.inline-name-input')).toHaveCount(1);
  await input.fill('Cancelled name');await input.press('Escape');await expect(input).toHaveCount(0);await expect(row).not.toContainText('Cancelled name');
  await row.hover();await row.locator('[title="Rename"]').click();await input.fill(name);
  if(selector==='#nbList')await page.locator('#editorWrap .CodeMirror').click();else await input.press('Enter');
  await expect(input).toHaveCount(0);await expect(row.locator('.nm span')).toHaveText(name);
 }
 await page.reload();await page.getByRole('tab',{name:'Analyses',exact:true}).click();await expect(page.locator('#saved .nm span')).toHaveText('Renamed query');await expect(page.locator('#nbList .nm span')).toHaveText('Renamed notebook');await expect(page.locator('#dashList .nm span')).toHaveText('Renamed dashboard');expect(dialogs).toEqual([]);expect(errors).toEqual([]);
});
test('query tab rename is inline and Escape preserves its name',async({page,studio})=>{
 await open(page,studio.url);const tab=page.locator('#tabs .tab').filter({hasText:'Query 1'});await tab.locator('span').first().dblclick();const input=page.getByRole('textbox',{name:'Rename query tab',exact:true});
 await input.fill('Scratch work');await input.press('Enter');await expect(page.locator('#tabs .tab').filter({hasText:'Scratch work'})).toHaveCount(1);
 await page.locator('#tabs .tab').filter({hasText:'Scratch work'}).locator('span').first().dblclick();await input.fill('Nope');await input.press('Escape');await expect(page.locator('#tabs .tab').filter({hasText:'Scratch work'})).toHaveCount(1);
});
