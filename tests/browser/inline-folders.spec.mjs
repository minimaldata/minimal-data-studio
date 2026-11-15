import {test,expect,open} from './fixtures.mjs';
test('database folders create inline, keep errors inline, and cancel with Escape',async({page,studio})=>{
 const dialogs=[];page.on('dialog',async d=>{dialogs.push(d.message());await d.dismiss();});await open(page,studio.url);
 await page.getByRole('button',{name:'New Database folder',exact:true}).click();
 const form=page.locator('#databasePanel .inline-folder-form'),input=form.getByRole('textbox');
 await input.fill('Examples');await input.press('Enter');await expect(form).toHaveCount(0);
 await expect(page.locator('.database-folder[data-folder="Examples"]')).toHaveCount(1);
 await page.getByRole('button',{name:'New subfolder in Examples',exact:true}).click();await input.fill('Nested');await input.press('Enter');await expect(page.locator('.database-folder[data-folder="Examples/Nested"]')).toHaveCount(1);
 await page.getByRole('button',{name:'New Database folder',exact:true}).click();await input.fill('Examples');await input.press('Enter');await expect(form.getByRole('alert')).not.toBeEmpty();await input.press('Escape');await expect(form).toHaveCount(0);expect(dialogs).toEqual([]);
});
test('analysis folders create and rename inline without losing the name on redraw',async({page,studio})=>{
 await open(page,studio.url);await page.getByRole('tab',{name:'Analyses',exact:true}).click();
 for(const [button,panel] of [['New notebook folder','#nbPanel'],['New dashboard folder','#dashPanel'],['New saved query folder','#savedPanel']]){
  await page.getByRole('button',{name:button,exact:true}).click();const form=page.locator(panel+' .inline-folder-form');await form.getByRole('textbox').fill('Lessons');await form.getByRole('textbox').press('Enter');await expect(form).toHaveCount(0);await expect(page.locator(panel+' .folder .nm')).toContainText('Lessons');
 }
 const row=page.locator('#nbPanel .folder');await row.hover();await row.locator('[title="New folder inside this one"]').click();
 const form=page.locator('#nbPanel .inline-folder-form');await form.getByRole('textbox').fill('Week 1');await form.getByRole('textbox').press('Enter');await expect(page.locator('#nbPanel .folder')).toHaveCount(2);
 await page.locator('#nbPanel .folder').filter({hasText:'Week 1'}).hover();await page.locator('#nbPanel .folder').filter({hasText:'Week 1'}).locator('[title="Rename"]').click();await form.getByRole('textbox').fill('Week 2');await form.getByRole('textbox').press('Enter');await expect(page.locator('#nbPanel .folder').filter({hasText:'Week 2'})).toHaveCount(1);
 await expect.poll(async()=>{const r=await page.request.get(studio.url+'/saved_queries.json');return (await r.json()).folders?.notebooks||[];}).toContain('Lessons/Week 2');
 await page.reload();await page.getByRole('tab',{name:'Analyses',exact:true}).click();await expect(page.locator('#nbPanel .folder').filter({hasText:'Week 2'})).toHaveCount(1);
});
test('new folder is an editable tree row, commits on blur and survives tree redraw',async({page,studio})=>{
 await open(page,studio.url);await page.getByRole('button',{name:'New Database folder',exact:true}).click();
 const row=page.locator('#schema > .inline-folder-form');await expect(row).toBeVisible();await expect(row.locator('button')).toHaveCount(0);
 await row.getByRole('textbox').fill('Parent');await page.locator('#editorWrap .CodeMirror').click();await expect(page.locator('.database-folder[data-folder="Parent"]')).toHaveCount(1);
 await page.getByRole('button',{name:'New subfolder in Parent',exact:true}).click();await expect(page.locator('.database-folder[data-folder="Parent"] > .database-folder-contents > .inline-folder-form')).toBeVisible();await page.getByRole('textbox',{name:'New Database folder',exact:true}).press('Escape');await expect(page.locator('.inline-folder-form')).toHaveCount(0);
 await page.getByRole('tab',{name:'Analyses',exact:true}).click();await page.getByRole('button',{name:'New notebook folder',exact:true}).click();await expect(page.locator('#nbList > .inline-folder-form')).toBeVisible();
 await page.locator('#nbList .inline-folder-form input').fill('Notes');
 // Opening another analysis section does not dismiss the naming row before its blur save.
 await page.locator('#editorWrap .CodeMirror').click();await expect(page.locator('#nbList .folder')).toContainText('Notes');
});
