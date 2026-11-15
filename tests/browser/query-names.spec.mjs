import {test,expect,open} from './fixtures.mjs';
test('duplicate rename stays inline with the existing query location',async({page,studio})=>{
 await studio.writeScript('saved_queries.json',JSON.stringify({queries:[{id:'a',name:'Revenue',folder:'Reports',sql:'select 1',lang:'sql'},{id:'b',name:'Other',sql:'select 2',lang:'sql'}],notebooks:[],dashboards:[]}));
 await open(page,studio.url);await page.getByRole('tab',{name:'Analyses',exact:true}).click();
 await page.locator('#saved [data-query-id="b"] .nm').click();
 await expect(page.locator('#runBtn')).toBeEnabled();
 const tab=page.locator('#tabs [data-tab-key="saved:b"]');await tab.hover();await tab.locator('.tab-keep-open').click();await tab.locator('span').first().dblclick();
 const input=page.getByRole('textbox',{name:'Rename query tab',exact:true});await input.fill(' revenue ');await input.press('Enter');
 await expect(input).toHaveAttribute('aria-invalid','true');await expect(page.locator('.inline-name-error')).toContainText('Saved queries / Reports');
 await input.fill('Costs');await input.press('Enter');await expect(input).toHaveCount(0);
 await expect.poll(async()=>(await (await page.request.get(studio.url+'/saved_queries.json')).json()).queries.find(q=>q.id==='b').name).toBe('Costs');
});
