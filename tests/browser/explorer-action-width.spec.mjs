import {test,expect,open,edit} from './fixtures.mjs';
test('database names reclaim hidden action space and retain keyboard actions',async({page,studio})=>{
 await open(page,studio.url);await edit(page,'CREATE TABLE a_long_table_name_for_the_explorer AS SELECT 1 AS value');await page.locator('#runBtn').click();
 const name=page.locator('.relation-name').filter({hasText:'a_long_table_name_for_the_explorer'}),row=name.locator('..');await expect(name).toBeVisible();
 await page.locator('#runBtn').hover();const resting=await name.boundingBox(),rowHeight=(await row.boundingBox()).height;
 await expect(row.locator('.relation-open').first()).toBeHidden();await row.hover();await expect(row.locator('.relation-open').first()).toBeVisible();
 expect((await name.boundingBox()).width).toBeLessThan(resting.width);expect((await row.boundingBox()).height).toBe(rowHeight);
 await name.focus();await page.locator('#runBtn').hover();await expect(row.locator('.relation-open').first()).toBeVisible();await page.keyboard.press('Tab');await expect(row.locator('.relation-open').first()).toBeFocused();
});
