import {test,expect,open} from './fixtures.mjs';
async function app(studio){
 await studio.writeScript('interactive/demo/app.json',JSON.stringify({format:1,name:'Parameter app',parameters:{amount:{type:'number',label:'Amount',default:10}},inputs:{data:{sql:'data.sql',columns:{value:'number'}}}}));
 await studio.writeScript('interactive/demo/index.html','<h1>Parameter app</h1>');
 await studio.writeScript('interactive/demo/data.sql','SELECT $amount AS value');
}
async function attach(page){await page.locator('#explorerAnalysesTab').click();await page.locator('.interactive-attach summary').click();await page.getByLabel('App folder path').fill('interactive/demo');await page.getByRole('button',{name:'Open folder',exact:true}).click();await page.locator('[data-action=edit]').click();}
test('SQL draft recovers across restart and parameters require explicit Apply',async({page,studio})=>{
 await app(studio);await open(page,studio.url);await attach(page);
 await page.getByRole('button',{name:'Apply & refresh inputs',exact:true}).click();await expect(page.locator('.interactive-bindings')).toContainText('Snapshot current');
 await page.getByLabel('Amount',{exact:true}).fill('42');await expect(page.locator('.interactive-bindings')).toContainText('Parameters changed — Apply needed');
 const previous=await page.evaluate(async()=>{const r=await fetch('/interactive-documents');return (await r.json()).documents;});expect(previous).toEqual([]);
 await page.getByRole('button',{name:'Apply & refresh inputs',exact:true}).click();await expect(page.locator('.interactive-bindings')).toContainText('Snapshot current');
 await page.locator('[data-action=save]').click();await expect(page.locator('.interactive-status')).toHaveText('Saved');
 await page.getByRole('button',{name:'Inspect SQL',exact:true}).click();const editor=page.locator('.input-sql-preview .CodeMirror');await editor.click();await page.keyboard.press('ControlOrMeta+A');await page.keyboard.insertText('SELECT $amount * 2 AS value');
 await expect(page.locator('.interactive-recovery')).toContainText('Draft backed up');
 await studio.restartSamePort();page.once('dialog',dialog=>dialog.accept());await page.reload();await expect(page.locator('#status')).toContainText('Ready');await page.locator('#explorerAnalysesTab').click();await page.getByRole('button',{name:'Restore draft',exact:true}).click();
 await page.locator('[data-action=edit]').click();await page.getByRole('button',{name:'Inspect SQL',exact:true}).click();expect(await editor.evaluate(e=>e.CodeMirror.getValue())).toBe('SELECT $amount * 2 AS value');await expect(page.getByLabel('Amount',{exact:true})).toHaveValue('42');
 await page.getByRole('button',{name:'Save SQL',exact:true}).click();await expect(page.locator('.interactive-bindings')).toContainText('SQL changed — refresh needed');
 await page.getByRole('button',{name:'Apply & refresh inputs',exact:true}).click();await expect(page.locator('.interactive-bindings')).toContainText('Snapshot current');await page.locator('[data-action=save]').click();await expect(page.locator('.interactive-status')).toHaveText('Saved');
 const saved=await page.evaluate(async()=>await(await fetch('/interactive-documents')).json());expect(saved.documents[0].inputs.data).toEqual([{value:84}]);
 await expect(page.locator('.interactive-recovery')).toContainText('All interactive work saved');
});
test('recovery does not replace a newer saved revision',async({page,studio})=>{
 await studio.writeScript('.studio/interactive-recovery/draft.json',JSON.stringify({revision:0,documents:[],sqlDrafts:[]}));
 await studio.writeScript('.studio/interactive-documents.json',JSON.stringify({format:1,revision:2,documents:[]}));
 await open(page,studio.url);await page.locator('#explorerAnalysesTab').click();await expect(page.getByRole('button',{name:'Restore draft',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Download recovery',exact:true})).toBeVisible();
});
test('unsaved scenario assumptions and results recover after a reload',async({page,studio})=>{
 await open(page,studio.url);await page.locator('#explorerAnalysesTab').click();await page.getByRole('button',{name:'New interactive document',exact:true}).click();
 const frame=page.frameLocator('#interactiveDocument iframe');await frame.locator('#growthA').fill('27');await frame.locator('#simulate').click();await expect(frame.locator('table')).toContainText('127,000');await expect(page.locator('.interactive-recovery')).toContainText('Draft backed up');
 page.once('dialog',d=>d.accept());await page.reload();await expect(page.locator('#status')).toContainText('Ready');await page.locator('#explorerAnalysesTab').click();await page.getByRole('button',{name:'Restore draft',exact:true}).click();await expect(frame.locator('#growthA')).toHaveValue('27');await expect(frame.locator('table')).toContainText('127,000');await page.locator('[data-action=save]').click();await expect(page.locator('.interactive-status')).toHaveText('Saved');
});
