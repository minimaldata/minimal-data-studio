import {test,expect,open,edit} from './fixtures.mjs';
test('value axis title fits inside the chart viewport across chart modes',async({page,studio})=>{
 await page.setViewportSize({width:1440,height:1100});await open(page,studio.url);
 await edit(page,"SELECT DATE '2026-01-01' + i::INTEGER AS day, i+1 AS total_activities FROM range(12) t(i)");
 await page.locator('#runBtn').click();await expect(page.locator('#results')).toContainText('total_activities');await page.locator('#viewSeg [data-v=chart]').click();
 const bar=page.locator('#chartbar');await bar.getByRole('button',{name:/Chart settings/}).click();
 for(const type of ['bar','line','stacked','percent']){
  await bar.getByRole('combobox',{name:'Chart',exact:true}).selectOption(type);
  const title=page.locator('#chart .role-axis-title text').filter({hasText:type==='percent'?'% of total':'total_activities'});
  await expect(title).toBeVisible();
  await expect(page.locator('#chart .cohort-strip')).toHaveCount(0);
  await expect.poll(async()=>title.evaluate(el=>{
   const box=el.getBoundingClientRect(),svg=el.ownerSVGElement.getBoundingClientRect();
   return box.top-svg.top;
  })).toBeGreaterThanOrEqual(0);
 }
});
