import {test,expect,open,edit} from './fixtures.mjs';
import {readFile} from 'node:fs/promises';
for(const type of ['bar','stacked','percent','line'])test(`${type} exports a complete PNG`,async({page,studio})=>{
 await open(page,studio.url);
 await edit(page,"SELECT DATE '2026-01-01'+i::INTEGER AS day, i+1 AS amount FROM range(12)t(i)");
 await page.locator('#runBtn').click();await expect(page.locator('#results')).toContainText('amount');
 await page.locator('#viewSeg [data-v=chart]').click();
 const bar=page.locator('#chartbar');await bar.getByRole('button',{name:/Chart settings/}).click();
 await bar.getByRole('combobox',{name:'Chart',exact:true}).selectOption(type);
 const pending=page.waitForEvent('download');await page.locator('#pngBtn').click();
 const download=await pending;expect(download.suggestedFilename()).toMatch(/\.png$/);
 const bytes=await readFile(await download.path());expect(bytes.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');expect(bytes.length).toBeGreaterThan(1000);
});
