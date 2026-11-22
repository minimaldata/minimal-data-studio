import {test,expect,open,edit} from './fixtures.mjs';
for(const type of ['bar','stacked','percent','line'])test(type+' horizontal scrollbar tracks zoom, preserves Y, and keeps ticks in the plot',async({page,studio})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width:1440,height:1100});await open(page,studio.url);
 await edit(page,"SELECT DATE '2025-11-01' + i::INTEGER AS day, i%20+1 AS activities FROM range(365)t(i)");await page.locator('#runBtn').click();await expect(page.locator('#results')).toContainText('activities');await page.locator('#viewSeg [data-v=chart]').click();
 const chart=page.locator('#chart'),bar=page.locator('#chartbar');await bar.getByRole('button',{name:/Chart settings/}).click();await bar.getByRole('combobox',{name:'Chart',exact:true}).selectOption(type);await bar.getByRole('button',{name:/Chart settings/}).click();
 const scroll=chart.getByRole('scrollbar',{name:'Horizontal chart position'}),y=chart.locator('[aria-roledescription="axis"][aria-label^="Y-axis"]');const originalY=await y.getAttribute('aria-label');
 await expect(scroll).toBeHidden();for(let i=0;i<6;i++)await chart.getByRole('button',{name:'Zoom in',exact:true}).click();await expect(scroll).toBeVisible();
 await scroll.focus();await page.keyboard.press('Home');await expect(scroll).toHaveAttribute('aria-valuenow',await scroll.getAttribute('aria-valuemin'));
 await page.keyboard.press('End');await expect(scroll).toHaveAttribute('aria-valuenow',await scroll.getAttribute('aria-valuemax'));await expect(y).toHaveAttribute('aria-label',originalY);
 const before=Number(await scroll.getAttribute('aria-valuenow'));const thumb=await scroll.locator('.chart-scrollbar-thumb').boundingBox();await page.mouse.move(thumb.x+thumb.width/2,thumb.y+thumb.height/2);await page.mouse.down();await page.mouse.move(thumb.x-100,thumb.y+thumb.height/2,{steps:4});await page.mouse.up();await expect.poll(async()=>Number(await scroll.getAttribute('aria-valuenow'))).toBeLessThan(before);
 const surface=await chart.locator('.studioPanSurface path').boundingBox();const labels=await chart.locator('[aria-roledescription="axis"][aria-label^="X-axis"] .role-axis-label text').evaluateAll(ns=>ns.filter(n=>n.textContent.trim()&&Number(getComputedStyle(n).opacity)>0).map(n=>{const b=n.getBoundingClientRect();return {x:b.x,width:b.width,text:n.textContent};}));
 expect(labels.length).toBeGreaterThan(1);for(const label of labels){expect(label.x+label.width/2).toBeGreaterThanOrEqual(surface.x-2);expect(label.x+label.width/2).toBeLessThanOrEqual(surface.x+surface.width+2);}
 const centers=labels.map(l=>l.x+l.width/2).sort((a,b)=>a-b);for(let i=1;i<centers.length;i++)expect(centers[i]-centers[i-1]).toBeGreaterThan(5);
 if(type==='stacked')await page.screenshot({path:`/tmp/mds-scrollbar-${test.info().project.name}.png`});
 await chart.getByRole('button',{name:'Reset zoom'}).click();await expect(scroll).toBeHidden();expect(errors).toEqual([]);
});
