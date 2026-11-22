import {test,expect,open} from './fixtures.mjs';
test.beforeEach(async({page})=>{await page.addInitScript(()=>{window.webkit={messageHandlers:{studioProject:{postMessage(){}}}};});});
test('native reload flushes recent code before permitting the reload',async({page,studio})=>{
 await open(page,studio.url);await page.waitForFunction(()=>typeof window.studioPrepareReload==='function');
 await page.locator('#editorWrap .CodeMirror').click();await page.keyboard.insertText('select 42 as answer');
 expect(await page.evaluate(()=>window.studioPrepareReload())).toEqual({ok:true});
 expect(await page.locator('body').evaluate(el=>el.inert)).toBe(true);
 await page.reload();await expect(page.locator('#editorWrap .CodeMirror')).toContainText('select 42 as answer');
 await page.locator('#runBtn').click();await expect(page.locator('#results')).toContainText('42');
});
test('native reload preserves unsaved task scripts and unlocks the interface',async({page,studio})=>{
 await open(page,studio.url);await page.getByRole('tab',{name:'Tasks',exact:true}).click();await page.getByRole('button',{name:'New task',exact:true}).click();
 const editor=page.locator('.task-pane:visible .CodeMirror');await editor.click();await page.keyboard.insertText("print('keep me')");
 const result=await page.evaluate(()=>window.studioPrepareReload());expect(result.ok).toBe(false);expect(result.error).toContain('unsaved task');
 expect(await page.locator('body').evaluate(el=>el.inert)).toBe(false);await expect(editor).toContainText('keep me');
});
test('native reload refuses failed autosaves without discarding code',async({page,studio})=>{
 await open(page,studio.url);await page.waitForFunction(()=>typeof window.studioPrepareReload==='function');
 await page.route('**/editor-drafts',route=>route.request().method()==='POST'?route.fulfill({status:500,body:'{"error":"Save failed"}',contentType:'application/json'}):route.continue());
 await page.locator('#editorWrap .CodeMirror').click();await page.keyboard.insertText('select 99');
 const result=await page.evaluate(()=>window.studioPrepareReload());expect(result.ok).toBe(false);
 await expect(page.locator('#editorWrap .CodeMirror')).toContainText('select 99');expect(await page.locator('body').evaluate(el=>el.inert)).toBe(false);
});
