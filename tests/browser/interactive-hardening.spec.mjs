import {test,expect,open} from './fixtures.mjs';
async function setup(page,studio){
 await studio.writeScript('interactive/demo/app.json',JSON.stringify({format:1,apiVersion:1,stateVersion:1,name:'Versioned app',scripts:['main.js']}));
 await studio.writeScript('interactive/demo/index.html','<h1>Versioned app</h1><button id="remember">Remember</button>');
 await studio.writeScript('interactive/demo/main.js','document.querySelector("#remember").onclick=()=>studio.saveState({answer:42});');
 await open(page,studio.url);await page.locator('#explorerAnalysesTab').click();await page.locator('.interactive-attach summary').click();await page.getByLabel('App folder path').fill('interactive/demo');await page.getByRole('button',{name:'Open folder',exact:true}).click();
 await page.frameLocator('#interactiveDocument iframe').locator('#remember').click();await page.locator('[data-action=save]').click();await expect(page.locator('.interactive-status')).toHaveText('Saved');
}
test('incompatible app updates block execution and preserve downloadable state',async({page,studio})=>{
 await setup(page,studio);
 await studio.writeScript('interactive/demo/app.json',JSON.stringify({format:1,apiVersion:1,stateVersion:2,name:'Versioned app',scripts:['main.js']}));
 await page.locator('[data-action=preview]').click();await expect(page.locator('.interactive-status')).toContainText('requires version 2');await expect(page.locator('#interactiveDocument iframe')).toHaveCount(0);
 const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Download app state',exact:true}).click();const download=await downloadPromise;const {readFile}=await import('node:fs/promises');const doc=JSON.parse(await readFile(await download.path(),'utf8'));expect(doc.state).toEqual({answer:42});expect(doc.stateVersion).toBe(1);
 await page.locator('[data-action=save]').click();await expect(page.locator('.interactive-status')).toHaveText('Saved');
 await page.locator('.interactive-diagnostics summary').click();await expect(page.locator('.interactive-diagnostics')).toContainText('interactive/demo');await page.screenshot({path:'/tmp/mds-app-compatibility.png',fullPage:true});
});
test('failed recovery writes keep edits and show a visible backup error',async({page,studio})=>{
 await setup(page,studio);await page.route('**/interactive-recovery',async route=>{if(route.request().method()==='POST')await route.fulfill({status:507,contentType:'application/json',body:JSON.stringify({error:'Disk full'})});else await route.continue();});
 await page.frameLocator('#interactiveDocument iframe').locator('#remember').click();await expect(page.locator('.interactive-recovery')).toContainText('Draft backup failed: Disk full');
 await expect(page.locator('.interactive-status')).toContainText('unsaved');await page.locator('[data-action=save]').click();await expect(page.locator('.interactive-status')).toHaveText('Saved');
});
test('refresh failures retain the saved snapshot and report elapsed progress',async({page,studio})=>{
 await studio.writeScript('interactive/demo/app.json',JSON.stringify({format:1,name:'Inputs',inputs:{data:{sql:'data.sql'}}}));await studio.writeScript('interactive/demo/index.html','<h1>Inputs</h1>');await studio.writeScript('interactive/demo/data.sql','SELECT 42 AS value');
 await open(page,studio.url);await page.locator('#explorerAnalysesTab').click();await page.locator('.interactive-attach summary').click();await page.getByLabel('App folder path').fill('interactive/demo');await page.getByRole('button',{name:'Open folder',exact:true}).click();await page.locator('[data-action=edit]').click();await page.getByRole('button',{name:'Refresh inputs',exact:true}).click();await expect(page.locator('.interactive-bindings')).toContainText('Snapshot current');
 let release;await page.route('**/interactive-inputs/refresh',async route=>{await new Promise(resolve=>release=resolve);await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'Input query exceeded 30 seconds.'})});});
 await page.getByRole('button',{name:'Refresh inputs',exact:true}).click();await expect(page.locator('.interactive-bindings [role=status]')).toContainText('execution limit');await expect(page.getByRole('button',{name:'Refresh inputs',exact:true})).toBeDisabled();release();await expect(page.locator('.interactive-bindings [role=status]')).toContainText('Previous inputs were kept');
 await page.locator('[data-action=save]').click();await expect(page.locator('.interactive-status')).toHaveText('Saved');expect(await page.evaluate(async()=>(await(await fetch('/interactive-documents')).json()).documents[0].inputs.data)).toEqual([{value:42}]);
});
test('starter app stages parameters without replacing its snapshot',async({page,studio})=>{
 const {readFile}=await import('node:fs/promises');for(const file of ['app.json','index.html','styles.css','app.js','queries/payments.sql'])await studio.writeScript('interactive/starter/'+file,await readFile(new URL('../../examples/interactive/parameterized-review/'+file,import.meta.url),'utf8'));
 await open(page,studio.url);await page.locator('#explorerAnalysesTab').click();await page.locator('.interactive-attach summary').click();await page.getByLabel('App folder path').fill('interactive/starter');await page.getByRole('button',{name:'Open folder',exact:true}).click();await page.locator('[data-action=edit]').click();await page.getByRole('button',{name:'Apply & refresh inputs',exact:true}).click();await expect(page.locator('.interactive-bindings')).toContainText('Snapshot current');await page.locator('[data-action=preview]').click();const frame=page.frameLocator('#interactiveDocument iframe');await expect(frame.locator('#rows tr')).toHaveCount(3);
 await frame.locator('#minimum').fill('1500');await frame.locator('#stage').click();await expect(page.locator('.interactive-status')).toContainText('Input parameters changed');await expect(frame.locator('#rows tr')).toHaveCount(3);
 await page.locator('[data-action=edit]').click();await expect(page.getByLabel('Minimum amount',{exact:true})).toHaveValue('1500');await page.getByRole('button',{name:'Apply & refresh inputs',exact:true}).click();await expect(page.locator('.interactive-bindings')).toContainText('Snapshot current');await page.locator('[data-action=preview]').click();await expect(frame.locator('#rows tr')).toHaveCount(2);await page.locator('[data-action=save]').click();await expect(page.locator('.interactive-status')).toHaveText('Saved');await page.screenshot({path:'/tmp/mds-parameter-starter.png',fullPage:true});
});
