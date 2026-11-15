import {test,expect,open} from './fixtures.mjs';
test('preview tabs replace, keep open, search and close without deleting documents',async({page,studio})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await studio.writeScript('saved_queries.json',JSON.stringify({queries:[],dashboards:[],notebooks:['Alpha','Beta','Gamma'].map(name=>({id:name,name,cells:[]}))}));
 await open(page,studio.url);await page.getByRole('tab',{name:'Analyses',exact:true}).click();
 const choose=async name=>{await page.locator('#nbList .nm').filter({hasText:name}).click();await expect(page.locator('#nbTitle')).toHaveText(name);};
 await choose('Alpha');await expect(page.locator('#tabs .preview-tab')).toContainText('Alpha');await expect(page.locator('#tabs .preview-tab')).toHaveCSS('border-top-style','dashed');await expect(page.locator('#tabs .tab-preview-badge')).toHaveCount(0);await page.locator('#tabs .preview-tab').hover();await expect(page.getByRole('button',{name:'Keep Alpha open',exact:true})).toBeVisible();
 await choose('Beta');await expect(page.locator('#tabs .analysis-tab')).toHaveCount(1);await expect(page.locator('#tabs .preview-tab')).toContainText('Beta');
 await page.locator('#tabs .analysis-tab').dblclick();await expect(page.locator('#tabs .preview-tab')).toHaveCount(0);
 await choose('Gamma');await expect(page.locator('#tabs .analysis-tab')).toHaveCount(2);
 await page.getByRole('button',{name:'Search open tabs',exact:true}).click();await page.getByRole('textbox',{name:'Search open tabs'}).fill('beta');
 await page.locator('#openTabMenu button').filter({hasText:'Beta'}).click();await expect(page.locator('#nbTitle')).toHaveText('Beta');
 await page.locator('#tabs .analysis-tab').filter({hasText:'Beta'}).click({button:'right'});
 await page.getByRole('button',{name:'Close to the right',exact:true}).click();await expect(page.locator('#tabs .analysis-tab')).toHaveCount(1);
 await page.locator('#tabs .analysis-tab button').click();await expect(page.locator('#tabs .analysis-tab')).toHaveCount(0);
 const saved=await (await page.request.get(studio.url+'/saved_queries.json')).json();expect(saved.notebooks).toHaveLength(3);expect(errors).toEqual([]);
});
test('edited preview stays open and bulk close asks before dropping query code',async({page,studio})=>{
 await studio.writeScript('saved_queries.json',JSON.stringify({queries:[],dashboards:[],notebooks:['Alpha','Beta'].map(name=>({id:name,name,cells:[{id:name,type:'sql',name:'q1',source:'select 1'}]}))}));
 await open(page,studio.url);await page.getByRole('tab',{name:'Analyses',exact:true}).click();
 await page.locator('#nbList .nm').filter({hasText:'Alpha'}).click();
 await page.locator('#nbCells .CodeMirror').evaluate(el=>el.CodeMirror.setValue('select 2'));
 // CodeMirror programmatic edits exercise the same persistence path as typing.
 await page.locator('#nbCells .CodeMirror').click();await page.keyboard.press('End');await page.keyboard.type(' ');
 await page.locator('#nbList .nm').filter({hasText:'Beta'}).click();await expect(page.locator('#tabs .analysis-tab')).toHaveCount(2);
 await page.locator('#tabs .tab').filter({hasText:'Query 1'}).click();
 await page.locator('#editorWrap .CodeMirror').evaluate(el=>el.CodeMirror.setValue('select 42'));
 let asked=false;page.on('dialog',async d=>{asked=true;await d.dismiss();});
 await page.locator('#tabs .analysis-tab').filter({hasText:'Beta'}).click({button:'right'});await page.getByRole('button',{name:'Close others',exact:true}).click();
 await expect.poll(()=>asked).toBe(true);await expect(page.locator('#tabs .tab').filter({hasText:'Query 1'})).toHaveCount(1);
});
test('saved query previews replace until explicitly run or edited',async({page,studio})=>{
 await studio.writeScript('saved_queries.json',JSON.stringify({queries:['One','Two','Three'].map((name,i)=>({id:name,name,sql:`select ${i} as value`,lang:'sql'})),notebooks:[],dashboards:[]}));
 await open(page,studio.url);await page.getByRole('tab',{name:'Analyses',exact:true}).click();
 const choose=async name=>{await page.locator('#saved .nm').filter({hasText:name}).click();await expect(page.locator('#runBtn')).toBeEnabled();};
 await choose('One');await expect(page.locator('#tabs .preview-tab')).toContainText('One');
 await choose('Two');await expect(page.locator('#tabs .tab').filter({hasText:'One'})).toHaveCount(0);await expect(page.locator('#tabs .preview-tab')).toContainText('Two');
 await page.locator('#runBtn').click();await expect(page.locator('#runBtn')).toBeEnabled();
 await choose('Three');await expect(page.locator('#tabs .tab').filter({hasText:'Two'})).toHaveCount(1);
 await page.screenshot({path:'/tmp/mds-tab-previews.png'});
});
test('files share the preview slot with analyses and Keep open retains them',async({page,studio})=>{
 await studio.writeScript('first.csv','x\n1\n');await studio.writeScript('second.csv','x\n2\n');
 await studio.writeScript('saved_queries.json',JSON.stringify({queries:[],dashboards:[],notebooks:[{id:'n',name:'Notebook',cells:[]}]}));
 await open(page,studio.url);
 await page.locator('#projectFiles .file-row').filter({hasText:'first.csv'}).click();await expect(page.locator('#tabs .preview-tab')).toContainText('first.csv');
 await page.locator('#projectFiles .file-row').filter({hasText:'second.csv'}).click();await expect(page.locator('#tabs .tab').filter({hasText:'first.csv'})).toHaveCount(0);
 await page.getByRole('button',{name:'Keep second.csv open',exact:true}).click();await expect(page.locator('#tabs .tab-preview-badge')).toHaveCount(0);
 await page.locator('#projectFiles .file-row').filter({hasText:'first.csv'}).click();
 await page.getByRole('tab',{name:'Analyses',exact:true}).click();await page.locator('#nbList .nm').filter({hasText:'Notebook'}).click();
 await expect(page.locator('#tabs .tab').filter({hasText:'first.csv'})).toHaveCount(0);await expect(page.locator('#tabs .tab').filter({hasText:'second.csv'})).toHaveCount(1);
});
test('tab menu closes in place, selects across search and supports keyboard switching',async({page,studio})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await open(page,studio.url);
 const add=page.locator('#tabs > .tab').filter({hasText:/^\+$/});
 await add.click();await add.click();
 await page.getByRole('button',{name:'Search open tabs',exact:true}).click();
 let menu=page.locator('#openTabMenu');await expect(menu.locator('[aria-current="page"]')).toContainText('Query 3');
 await menu.getByRole('button',{name:'Close Query 1',exact:true}).click();await expect(menu).toBeVisible();await expect(menu.locator('.tab-menu-open')).toHaveCount(2);await expect(page.locator('#tabs .active')).toContainText('Query 3');
 await menu.getByRole('checkbox',{name:'Select Query 2',exact:true}).check();
 await menu.getByRole('textbox',{name:'Search open tabs',exact:true}).fill('3');await menu.getByRole('checkbox',{name:'Select Query 3',exact:true}).check();
 await expect(menu).toContainText('2 selected');await menu.getByRole('button',{name:'Close selected',exact:true}).click();
 await menu.getByRole('textbox',{name:'Search open tabs',exact:true}).fill('');await expect(menu.locator('.tab-menu-open')).toHaveCount(1);await expect(menu.locator('.tab-menu-open')).toContainText('Query 1');
 await menu.getByRole('textbox',{name:'Search open tabs',exact:true}).press('Escape');await expect(menu).toHaveCount(0);
 await add.click();await page.getByRole('button',{name:'Search open tabs',exact:true}).click();
 await page.getByRole('textbox',{name:'Search open tabs',exact:true}).press('ArrowDown');await expect(page.locator('#openTabMenu .tab-menu-open').first()).toBeFocused();await page.keyboard.press('Enter');
 await expect(menu).toHaveCount(0);await expect(page.locator('#tabs .active')).toContainText('Query 1');expect(errors).toEqual([]);
});
test('tab menu reports unsaved code and keeps a declined close selected',async({page,studio})=>{
 await open(page,studio.url);await page.locator('#editorWrap .CodeMirror').evaluate(el=>el.CodeMirror.setValue('select 42'));
 await page.getByRole('button',{name:'Search open tabs',exact:true}).click();const menu=page.locator('#openTabMenu');
 await expect(menu.locator('.tab-menu-status')).toContainText('Unsaved');await menu.getByRole('checkbox',{name:'Select Query 1',exact:true}).check();
 page.once('dialog',d=>d.dismiss());await menu.getByRole('button',{name:'Close selected',exact:true}).click();
 await expect(menu.locator('.tab-menu-open')).toHaveCount(1);await expect(menu.getByRole('checkbox',{name:'Select Query 1',exact:true})).toBeChecked();await expect(page.locator('#tabs .active')).toContainText('Query 1');
 await page.screenshot({path:'/tmp/mds-tab-manager-menu.png'});
});
test('running query is labeled and cannot be closed from the tab menu',async({page,studio})=>{
 await open(page,studio.url);await page.locator('#editorWrap .CodeMirror').evaluate(el=>el.CodeMirror.setValue('select 73 as guarded'));
 let release;const gate=new Promise(resolve=>release=resolve);
 await page.route('**/db/query**',async route=>{if(route.request().postData()?.includes('guarded'))await gate;await route.continue();});
 try{
  await page.locator('#runBtn').click();await expect(page.locator('#runBtn')).toBeDisabled();
  await page.locator('#tabs > .tab').filter({hasText:/^\+$/}).click();
  await page.getByRole('button',{name:'Search open tabs',exact:true}).click();const menu=page.locator('#openTabMenu');await expect(menu.locator('.tab-menu-row').filter({hasText:'Query 1'}).locator('.tab-menu-status')).toContainText('Running');
  let warning='';page.once('dialog',async d=>{warning=d.message();await d.dismiss();});await menu.getByRole('button',{name:'Close Query 1',exact:true}).click();
  await expect.poll(()=>warning).toContain('finish');await expect(menu.locator('.tab-menu-open')).toHaveCount(2);
 }finally{release();}
 await expect(page.locator('#runBtn')).toBeEnabled();await expect(page.locator('#openTabMenu .tab-menu-row').filter({hasText:'Query 1'}).locator('.tab-menu-status')).not.toContainText('Running');
});
test('select all respects search and clear selection includes hidden tabs',async({page,studio})=>{
 await open(page,studio.url);const add=page.locator('#tabs > .tab').filter({hasText:/^\+$/});await add.click();await add.click();
 await page.getByRole('button',{name:'Search open tabs',exact:true}).click();const menu=page.locator('#openTabMenu');const search=menu.getByRole('textbox',{name:'Search open tabs',exact:true});
 const all=menu.getByRole('button',{name:'Select all',exact:true}),clear=menu.getByRole('button',{name:'Clear selection',exact:true});
 await expect(clear).toBeDisabled();await all.click();await expect(menu.locator('input:checked')).toHaveCount(3);await expect(all).toBeDisabled();
 await search.fill('2');await clear.click();await expect(menu).not.toContainText('3 selected');await search.fill('');await expect(menu.locator('input:checked')).toHaveCount(0);
 await search.fill('2');await all.click();await search.fill('');await expect(menu.locator('input:checked')).toHaveCount(1);await expect(menu.getByRole('checkbox',{name:'Select Query 2',exact:true})).toBeChecked();
 await search.fill('no match');await expect(all).toBeDisabled();await clear.click();await expect(menu.getByRole('button',{name:'Close selected',exact:true})).toBeDisabled();
 await search.fill('');await all.click();await menu.getByRole('button',{name:'Close selected',exact:true}).click();await expect(menu.locator('.tab-menu-open')).toHaveCount(1);await expect(menu.locator('input:checked')).toHaveCount(0);
});
test('open-tabs button toggles the menu with mouse and keyboard',async({page,studio})=>{
 await open(page,studio.url);const button=page.getByRole('button',{name:'Search open tabs',exact:true}),menu=page.locator('#openTabMenu');
 await button.click();await expect(menu).toBeVisible();await expect(button).toHaveAttribute('aria-expanded','true');
 await button.click();await expect(menu).toHaveCount(0);await expect(button).toHaveAttribute('aria-expanded','false');
 await button.click();await expect(menu).toBeVisible();await button.focus();await button.press('Enter');await expect(menu).toHaveCount(0);
 await button.press('Enter');await expect(menu).toBeVisible();await menu.getByRole('textbox').press('Escape');await expect(button).toHaveAttribute('aria-expanded','false');
});
