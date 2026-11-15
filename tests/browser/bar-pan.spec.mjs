import {dragInPlot,settleChartLayout} from './chart-helpers.mjs';
import {test,expect,open,edit} from './fixtures.mjs';
for(const type of ['bar','stacked','percent'])for(const horizontal of [false,true])test(`${type} ${horizontal?'horizontal':'vertical'} pan stays inside zoomed data`,async({page,studio})=>{
 await page.setViewportSize({width:1440,height:1100});await open(page,studio.url);
 await edit(page,"SELECT 'Category '||i AS category, i+1 AS value FROM range(12)t(i)");await page.locator('#runBtn').click();await expect(page.locator('#results')).toContainText('category');await page.locator('#viewSeg [data-v=chart]').click();
 const chart=page.locator('#chart'),bar=page.locator('#chartbar');await bar.getByRole('button',{name:/Chart settings/}).click();await bar.getByRole('combobox',{name:'Chart',exact:true}).selectOption(type);
 if(horizontal){await bar.locator('summary').filter({hasText:/^Style/}).click();await bar.getByLabel('Horizontal bars',{exact:true}).check();}
 await bar.getByRole('button',{name:/Chart settings/}).click();await settleChartLayout(page);
 const marks=chart.locator('path[aria-roledescription="bar"]'),geometry=()=>marks.evaluateAll(ns=>ns.map(n=>{const b=n.getBBox();return [b.x,b.y,b.width,b.height].map(v=>Math.round(v*1000)/1000);})),initial=await geometry();
 const drag=sign=>dragInPlot(page,chart.locator('.studioPanSurface path'),[.5,.5],[.5+sign*.45,.5+sign*.45]);
 await expect(chart.locator('.scatter-note')).toContainText('Zoom in to pan');await expect(chart.getByRole('button',{name:'Zoom out',exact:true})).toBeDisabled();await drag(1);expect(await geometry()).toEqual(initial);
 await chart.getByRole('button',{name:'Zoom in',exact:true}).click();await expect.poll(geometry).not.toEqual(initial);
 const measure=()=>marks.evaluateAll((ns,h)=>ns.map(n=>{const b=n.getBBox();return h?[b.x,b.width]:[b.y,b.height];}),horizontal),before=await measure();
 await drag(1);await drag(1);const edge=await geometry();await drag(1);expect(await geometry()).toEqual(edge);expect(await measure()).toEqual(before);
 await drag(-1);await drag(-1);await drag(-1);const other=await geometry();expect(other).not.toEqual(edge);await drag(-1);expect(await geometry()).toEqual(other);expect(await measure()).toEqual(before);
 await chart.getByRole('button',{name:'Zoom out',exact:true}).click();await expect.poll(geometry).toEqual(initial);await expect(chart.getByRole('button',{name:'Zoom out',exact:true})).toBeDisabled();await drag(-1);expect(await geometry()).toEqual(initial);
});
