import {settleChartLayout} from './chart-helpers.mjs';
import {test,expect,open,edit} from './fixtures.mjs';
for(const count of [100000,500000])test(`Canvas overview and zoom inspection for ${count} points`,async({page,studio})=>{
 test.setTimeout(120000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await open(page,studio.url);
 await edit(page,`SELECT i%1000 AS x, floor(i/1000) AS y FROM range(${count}) t(i)`);
 await page.locator('#runBtn').click();await expect(page.locator('#status')).not.toContainText('Running');
 const start=Date.now();await page.locator('#viewSeg [data-v=chart]').click();const bar=page.locator('#chartbar');await bar.getByRole('button',{name:/Chart settings/}).click();await bar.getByRole('combobox',{name:'Chart',exact:true}).selectOption('scatter');await bar.getByRole('button',{name:/Chart settings/}).click();
 await expect(page.locator('#chart canvas')).toBeVisible();await expect(page.locator('#chart .scatter-focus')).toContainText('Zoom in to inspect');
 await expect(page.locator('#chart .scatter-focus')).toContainText(count.toLocaleString('en-US')+' of '+count.toLocaleString('en-US'));
 console.log(`${count} points initial chart: ${Date.now()-start} ms (${test.info().project.name})`);
 // Canvas resizing is deliberately deferred 250ms after the settings panel closes.
 await settleChartLayout(page,{canvas:true});await expect(page.locator('#chart .scatter-plot')).not.toHaveClass(/is-resizing-chart/);
 const box=await page.locator('#chart canvas').boundingBox();
 await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5);await expect(page.locator('.scatter-tooltip:not([hidden])')).toHaveCount(0);
 await page.getByRole('button',{name:'Drag to zoom',exact:true}).click();
 await page.mouse.move(box.x+box.width*.45,box.y+box.height*.45);await page.mouse.down();await page.mouse.move(box.x+box.width*.51,box.y+box.height*.51,{steps:3});await page.mouse.up();
 await expect(page.locator('#chart .scatter-focus')).toContainText('Hover over a point');
 await expect(page.getByRole('button',{name:'Drag to zoom',exact:true})).toHaveAttribute('aria-pressed','false');
 // Search a small region for one rendered point, without depending on pixel rounding.
 let found=false;for(let x=.4;x<=.6&&!found;x+=.025)for(let y=.4;y<=.6&&!found;y+=.025){await page.mouse.move(box.x+box.width*x,box.y+box.height*y);found=await page.locator('.scatter-tooltip:not([hidden])').count()>0;}
 expect(found).toBe(true);
 await page.mouse.move(box.x+3,box.y+box.height*.5);await expect(page.locator('.scatter-tooltip:not([hidden])')).toHaveCount(0);
 await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5);await page.mouse.down();await page.mouse.move(box.x+box.width*.6,box.y+box.height*.5,{steps:4});await page.mouse.up();await expect(page.locator('#chart .scatter-focus')).toContainText('points in view');
 await page.locator('#saveBtn').hover();await expect(page.locator('.scatter-tooltip:not([hidden])')).toHaveCount(0);
 await page.getByRole('button',{name:'Reset zoom',exact:true}).click();await expect(page.locator('#chart .scatter-focus')).toContainText('Zoom in to inspect');
 expect(errors).toEqual([]);
});

test('large scatter defers repaint until splitter release and ignores unrelated resize events',async({page,studio})=>{
 await open(page,studio.url);await edit(page,'SELECT i AS x, i%31 AS y FROM range(250000) t(i)');await page.locator('#runBtn').click();await expect(page.locator('#results')).toContainText('x');await page.locator('#viewSeg [data-v=chart]').click();const bar=page.locator('#chartbar');await bar.getByRole('button',{name:/Chart settings/}).click();await bar.getByRole('combobox',{name:'Chart',exact:true}).selectOption('scatter');await bar.getByRole('button',{name:/Chart settings/}).click();
 const canvas=page.locator('#chart canvas'),plot=page.locator('#chart .scatter-plot');await expect(canvas).toBeVisible();await expect(plot).not.toHaveClass(/is-resizing-chart/);await settleChartLayout(page,{canvas:true});
 const originalCanvas=await canvas.elementHandle();
 for(const expanded of [true,false]){
   await bar.getByRole('button',{name:/Chart settings/}).click();
   await expect(bar.getByRole('button',{name:/Chart settings/})).toHaveAttribute('aria-expanded',String(expanded));
   expect(await originalCanvas.evaluate(node=>node.isConnected&&node===document.querySelector('#chart canvas'))).toBe(true);
   await settleChartLayout(page,{canvas:true});await expect(plot).not.toHaveClass(/is-resizing-chart/);
 }
 const before=await canvas.getAttribute('height'),split=await page.locator('#splitter').boundingBox();
 await page.mouse.move(split.x+split.width/2,split.y+3);await page.mouse.down();await page.mouse.move(split.x+split.width/2,split.y-70,{steps:10});await settleChartLayout(page,{canvas:true});
 await expect(canvas).toHaveAttribute('height',before);await expect(plot).toHaveClass(/is-resizing-chart/);
 await page.mouse.up();await expect(canvas).not.toHaveAttribute('height',before);await expect(plot).not.toHaveClass(/is-resizing-chart/);
 const after=await canvas.getAttribute('height');await page.evaluate(()=>{for(let i=0;i<20;i++)dispatchEvent(new Event('resize'));});await settleChartLayout(page,{canvas:true});await expect(canvas).toHaveAttribute('height',after);await expect(plot).not.toHaveClass(/is-resizing-chart/);
});
