import {test,expect,open,edit} from './fixtures.mjs';
test('result footer stays below scrolling results and retains table controls',async({page,studio})=>{
 await page.setViewportSize({width:1440,height:900});await open(page,studio.url);await edit(page,'SELECT i AS amount FROM range(250)t(i)');await page.locator('#runBtn').click();await expect(page.locator('#results')).toContainText('amount');const footer=page.getByRole('group',{name:'Result controls'});
 await expect(footer.locator('#pager')).toContainText('1–100');await expect(footer.getByLabel('Copy as')).toBeVisible();const before=await footer.boundingBox(),results=await page.locator('#results').boundingBox();expect(before.y).toBeGreaterThanOrEqual(results.y+results.height-1);
 await page.locator('#results').evaluate(el=>el.scrollTop=el.scrollHeight);expect(await footer.boundingBox()).toEqual(before);
 await footer.locator('#filter').fill('249');await expect(page.locator('#results tbody tr')).toHaveCount(1);await expect(page.locator('#results')).toContainText('249');await footer.locator('#filter').fill('');
 await page.locator('#viewSeg [data-v=chart]').click();await expect(footer).toBeVisible();await expect(footer.locator('#pager')).toBeHidden();await expect(footer.locator('#filter')).toBeHidden();await page.locator('#viewSeg [data-v=table]').click();await expect(footer.locator('#filter')).toBeVisible();
 await page.screenshot({path:`/tmp/mds-results-footer-${test.info().project.name}.png`});
});
