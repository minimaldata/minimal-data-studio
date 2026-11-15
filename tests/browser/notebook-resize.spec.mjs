import {resizeCellSection,readSavedWork} from './chart-helpers.mjs';
import {test,expect,open} from './fixtures.mjs';
test('notebook code and output heights resize independently, persist and reset',async({page,studio})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width:1400,height:1100});
 await studio.writeScript('saved_queries.json',JSON.stringify({queries:[],dashboards:[],notebooks:[{id:'sizing',name:'Sizing',cells:[{id:'sized',type:'sql',name:'q1',source:'SELECT i AS x,i*2 AS y FROM range(12)t(i)',view:'chart',chart:{type:'scatter',x:'x',y:['y']}}]}]}));
 await open(page,studio.url);await page.getByRole('tab',{name:'Analyses',exact:true}).click();await page.locator('#nbList .nm').filter({hasText:'Sizing'}).click();await page.locator('#nbRunAll').click();
 const cell=page.locator('#nbCells .cell'),code=cell.locator('.CodeMirror'),out=cell.locator('.cell-out');await expect(out.locator('.mark-symbol.role-mark path')).toHaveCount(12);
 const drag=(name,delta)=>resizeCellSection(page,cell,name,delta);
 const first=await code.evaluate(n=>n.offsetHeight);await drag('Resize cell code',120);await expect.poll(()=>code.evaluate(n=>n.offsetHeight)).toBeGreaterThan(first+100);
 const codeHeight=await code.evaluate(n=>n.offsetHeight);await drag('Resize cell output',150);await expect.poll(()=>out.evaluate(n=>n.offsetHeight)).toBeGreaterThan(450);const outputHeight=await out.evaluate(n=>n.offsetHeight);
 const saved=async()=>(await readSavedWork(page,studio)).notebooks[0].cells[0];await expect.poll(async()=>(await saved()).outputHeight).toBeTruthy();await expect.poll(async()=>(await saved()).codeHeight).toBeTruthy();
 await page.reload();await expect(page.locator('#nbTitle')).toHaveText('Sizing');await page.locator('#nbRunAll').click();await expect(out.locator('.mark-symbol.role-mark path')).toHaveCount(12);await expect.poll(()=>code.evaluate(n=>n.offsetHeight)).toBe(codeHeight);await expect.poll(()=>out.evaluate(n=>n.offsetHeight)).toBe(outputHeight);
 await cell.getByRole('button',{name:'Show the result as a table or a chart'}).click();await page.getByRole('option',{name:'Table',exact:true}).click();await expect(out.locator('table')).toBeVisible();expect(await out.evaluate(n=>n.offsetHeight)).toBe(outputHeight);await cell.getByRole('button',{name:'Show the result as a table or a chart'}).click();await page.getByRole('option',{name:'Chart',exact:true}).click();await expect(out.locator('.mark-symbol.role-mark path')).toHaveCount(12);await page.screenshot({path:`/tmp/mds-notebook-resize-${test.info().project.name}.png`});
 await cell.getByRole('separator',{name:'Resize cell code'}).dblclick();await expect.poll(async()=>(await saved()).codeHeight).toBeUndefined();await expect.poll(()=>code.evaluate(n=>n.offsetHeight)).toBe(first);
 await cell.getByRole('separator',{name:'Resize cell output'}).dblclick();await expect.poll(async()=>(await saved()).outputHeight).toBeUndefined();await expect.poll(()=>out.evaluate(n=>n.offsetHeight)).toBe(340);expect(errors).toEqual([]);
});
