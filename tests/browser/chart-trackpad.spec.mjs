import {test,expect,open,edit} from './fixtures.mjs';
for(const type of ['bar','stacked','percent','line'])test(type+' trackpad scroll preserves Y and native vertical gestures',async({page,studio})=>{
 await page.setViewportSize({width:1440,height:1100});await open(page,studio.url);
 await edit(page,"SELECT DATE '2025-11-01' + i::INTEGER AS day, i%20+1 AS activities FROM range(365)t(i)");await page.locator('#runBtn').click();await expect(page.locator('#results')).toContainText('activities');await page.locator('#viewSeg [data-v=chart]').click();
 const chart=page.locator('#chart'),bar=page.locator('#chartbar');await bar.getByRole('button',{name:/Chart settings/}).click();await bar.getByRole('combobox',{name:'Chart',exact:true}).selectOption(type);await bar.getByRole('button',{name:/Chart settings/}).click();
 for(let i=0;i<4;i++)await chart.getByRole('button',{name:'Zoom in',exact:true}).click();
 const scroll=chart.getByRole('scrollbar'),y=chart.locator('[aria-roledescription="axis"][aria-label^="Y-axis"]');await expect(scroll).toBeVisible();const yBefore=await y.getAttribute('aria-label');
 const surface=chart.locator('.studioPanSurface path');await expect(surface).toHaveCSS('cursor','grab');const box=await surface.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);const before=Number(await scroll.getAttribute('aria-valuenow'));await page.mouse.wheel(180,0);await expect.poll(async()=>Number(await scroll.getAttribute('aria-valuenow'))).toBeGreaterThan(before);await expect(y).toHaveAttribute('aria-label',yBefore);
 await page.mouse.down();await page.mouse.move(box.x+box.width/2+15,box.y+box.height/2,{steps:3});await expect(surface).toHaveCSS('cursor','grabbing');await page.mouse.up();await expect(surface).toHaveCSS('cursor','grab');
 // Synthetic cancelability checks cover gestures that should stay with the page/browser.
 for(const options of [{deltaX:0,deltaY:60}])expect(await surface.evaluate((el,options)=>el.dispatchEvent(new WheelEvent('wheel',{...options,bubbles:true,cancelable:true})),options)).toBe(true);
});
