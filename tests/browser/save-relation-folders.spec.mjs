import {test,expect,open,edit} from './fixtures.mjs';
test('table and view creation choose existing or new Database folders',async({page,studio})=>{
 await open(page,studio.url);await edit(page,'SELECT 42 AS answer');await page.locator('#runBtn').click();await expect(page.locator('#createTableBtn')).toBeEnabled();
 await page.locator('#createTableBtn').click();const dialog=page.locator('#relationDialog');await dialog.locator('#relationName').fill('saved_answer');await dialog.getByLabel('Database folder').fill('Examples/Results');await dialog.getByRole('button',{name:'Create',exact:true}).click();await expect(dialog).not.toBeVisible();
 await page.locator('#createViewBtn').click();await dialog.locator('#relationName').fill('answer_view');await dialog.getByLabel('Database folder').fill('Examples/Results');await dialog.getByRole('button',{name:'Create',exact:true}).click();await expect(dialog).not.toBeVisible();
 const locations=await page.evaluate(async()=>{const {session}=await (await fetch('/db/session',{method:'POST'})).json();try{return (await (await fetch('/db/database-folders?session='+session,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'list'})})).json()).locations;}finally{await fetch('/db/close?session='+session,{method:'POST'});}});
 expect(locations.saved_answer).toBe('Examples/Results');expect(locations.answer_view).toBe('Examples/Results');
});
