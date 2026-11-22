import {settleChartLayout,dragInPlot} from './chart-helpers.mjs';
import {test,expect,open,edit} from './fixtures.mjs';
test('scatter mappings render individual points and save with an analysis',async({page,studio})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await open(page,studio.url);
 await edit(page,"SELECT * FROM (VALUES (1,2,5,'A'),(1,3,10,'B'),(2,4,20,'A')) t(x,y,weight,category)");
 await page.locator('#runBtn').click();await expect(page.locator('#results')).toContainText('category');await page.locator('#viewSeg [data-v=chart]').click();
 const bar=page.locator('#chartbar');await bar.getByRole('button',{name:/Chart settings/}).click();await bar.getByRole('combobox',{name:'Chart',exact:true}).selectOption('scatter');
 await bar.getByRole('combobox',{name:'X',exact:true}).selectOption('x');await bar.getByRole('combobox',{name:'Y',exact:true}).selectOption('y');
 await bar.getByRole('combobox',{name:'Size',exact:true}).selectOption('weight');await bar.getByRole('combobox',{name:'Shape',exact:true}).selectOption('category');await bar.getByRole('combobox',{name:'Color',exact:true}).selectOption('category');
 await expect(page.locator('#chart')).toContainText('3 points');await expect(page.locator('#chart .mark-symbol.role-mark path')).toHaveCount(3);
 await bar.getByRole('combobox',{name:'Color',exact:true}).selectOption('weight');await expect(page.locator('#chart .mark-symbol.role-mark path')).toHaveCount(3);
 await bar.getByRole('combobox',{name:'Color',exact:true}).selectOption('');
 await bar.getByRole('combobox',{name:'Brightness',exact:true}).selectOption('x');
 await expect(page.locator('#chart')).toContainText('Brightness');
 const fills=await page.locator('#chart .mark-symbol.role-mark path').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('fill')));expect(fills[0]).toBe(fills[1]);expect(fills[2]).not.toBe(fills[0]);
 await bar.getByRole('combobox',{name:'Color',exact:true}).selectOption('weight');
 await bar.getByRole('combobox',{name:'Label',exact:true}).selectOption('category');
 const before=await page.locator('#chart .cplot').boundingBox();
 await bar.getByRole('button',{name:/Chart settings/}).click();await expect(bar.getByRole('combobox',{name:'Size',exact:true})).toBeHidden();
 await expect.poll(async()=> (await page.locator('#chart .cplot').boundingBox()).height).toBeGreaterThan(before.height);
 const point=page.locator('#chart .mark-symbol.role-mark path').nth(2);await point.hover();
 await expect(point).toHaveAttribute('stroke-width','3');await expect(page.locator('#chart .scatter-focus')).toContainText('Row 3 · A');
 await expect(page.locator('#chart .mark-symbol.role-mark path').first()).toHaveAttribute('opacity','0.22');
 const tip=page.locator('.scatter-tooltip:not([hidden])');await expect(tip).toBeVisible();
 await page.locator('#saveBtn').hover();await expect(point).toHaveAttribute('stroke-width','0');await expect(tip).toHaveCount(0);
 await point.hover();await expect(tip).toBeVisible();await page.keyboard.press('Escape');await expect(tip).toHaveCount(0);await expect(point).toHaveAttribute('stroke-width','0');
 await page.locator('#saveBtn').hover();await point.hover();await expect(tip).toBeVisible();
 await page.locator('#viewSeg [data-v=table]').click();await expect(page.locator('.scatter-tooltip')).toHaveCount(0);
 await page.locator('#viewSeg [data-v=chart]').click();await expect(tip).toHaveCount(0);
 await point.hover();await expect(tip).toBeVisible();await page.evaluate(()=>{document.dispatchEvent(new KeyboardEvent('keydown',{key:'4',metaKey:true,shiftKey:true,bubbles:true}));window.dispatchEvent(new Event('blur'));});await expect(tip).toBeVisible();
 await page.locator('#saveBtn').hover();
 await expect(page.locator('#pngBtn')).toBeEnabled();const download=page.waitForEvent('download');await page.locator('#pngBtn').click();expect((await download).suggestedFilename()).toMatch(/\.png$/);
 page.once('dialog',d=>d.accept('Scatter test'));await page.locator('#saveBtn').click();await expect(page.locator('#status')).toContainText('Saved');
 const work=await (await page.request.get(studio.url+'/saved_queries.json')).json();const c=work.queries.find(q=>q.name==='Scatter test').chart;
 expect(c).toMatchObject({type:'scatter',x:'x',y:['y'],size:'weight',shape:'category',color:'weight',brightness:'x',label:'category'});await page.reload();await expect(page.locator('#runBtn')).toBeEnabled();await page.locator('#runBtn').click();
 await expect(page.locator('#chart .mark-symbol.role-mark path')).toHaveCount(3);
 await page.locator('#chartbar').getByRole('button',{name:/Chart settings/}).click();
 for(const [name,value] of Object.entries({Chart:'scatter',X:'x',Y:'y',Size:'weight',Shape:'category',Color:'weight',Brightness:'x',Label:'category'}))await expect(page.locator('#chartbar').getByRole('combobox',{name,exact:true})).toHaveValue(value);
 expect(errors).toEqual([]);
});
test('saved scatterplots render in notebooks and dashboards',async({page,studio})=>{
 const sql="SELECT * FROM (VALUES (1,2,5,'A'),(1,3,10,'B'),(2,4,20,'A')) t(x,y,weight,category)",chart={type:'scatter',x:'x',y:['y'],size:'weight',color:'category',shape:'category',brightness:'weight'};
 await studio.writeScript('saved_queries.json',JSON.stringify({queries:[{id:'scatter',name:'Saved scatter',sql,view:'chart',chart}],notebooks:[{id:'notebook',name:'Scatter notebook',cells:[{id:'cell',type:'sql',name:'points',source:sql,view:'chart',chart}]}],dashboards:[{id:'dashboard',name:'Scatter dashboard',tiles:[{id:'tile',query_id:'scatter',x:0,y:0,w:24,h:10}]}]}));
 await open(page,studio.url);await page.getByRole('tab',{name:'Analyses',exact:true}).click();await page.locator('#nbList .nm').filter({hasText:'Scatter notebook'}).click();await page.locator('#nbRunAll').click();await expect(page.locator('#nbCells .mark-symbol.role-mark path')).toHaveCount(3);
 await page.reload();await expect(page.locator('#nbTitle')).toHaveText('Scatter notebook');await page.locator('#nbRunAll').click();await expect(page.locator('#nbCells .mark-symbol.role-mark path')).toHaveCount(3);
 await page.locator('#dashList .nm').filter({hasText:'Scatter dashboard'}).click();await expect(page.locator('#dashBody .mark-symbol.role-mark path')).toHaveCount(3);
});
test('scatter zoom changes axes only, resets and pans; leaving a point hides its tooltip',async({page,studio})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await open(page,studio.url);
 await edit(page,'SELECT i AS x, i*i AS y FROM range(12) t(i)');await page.locator('#runBtn').click();await expect(page.locator('#results')).toContainText('121');
 await page.locator('#viewSeg [data-v=chart]').click();const bar=page.locator('#chartbar');await bar.getByRole('button',{name:/Chart settings/}).click();await bar.getByRole('combobox',{name:'Chart',exact:true}).selectOption('scatter');await bar.getByRole('button',{name:/Chart settings/}).click();
 const marks=page.locator('#chart .mark-symbol.role-mark path'),point=page.locator('#chart .mark-symbol.role-mark path[aria-label*="Result row: 7"]');await expect(marks).toHaveCount(12);await expect(page.locator('#pngBtn')).toBeEnabled();
 await settleChartLayout(page);
 const start=await point.getAttribute('transform'),shape=await point.getAttribute('d'),fill=await point.getAttribute('fill');
 await page.getByRole('button',{name:'Zoom in',exact:true}).click();await expect(point).not.toHaveAttribute('transform',start);await expect(point).toHaveAttribute('d',shape);await expect(point).toHaveAttribute('fill',fill);
 await page.getByRole('button',{name:'Zoom out',exact:true}).click();await expect(point).toHaveAttribute('transform',start);
 const box=await page.locator('#chart .studioPanSurface path').first().boundingBox();
 const drag=sign=>dragInPlot(page,page.locator('#chart .studioPanSurface path').first(),[.5,.5],[.5+sign*.45,.5+sign*.45],{steps:4});
 await expect(page.locator('#chart .scatter-navigation')).toContainText('Zoom in to pan');await expect(page.getByRole('button',{name:'Zoom out',exact:true})).toBeDisabled();await drag(1);await expect(point).toHaveAttribute('transform',start);
 await page.getByRole('button',{name:'Zoom in',exact:true}).click();await expect(point).not.toHaveAttribute('transform',start);
 const position=()=>page.locator('#chart [aria-roledescription="axis"]').evaluateAll(ns=>ns.map(n=>n.getAttribute('aria-label'))),zoomedPosition=await position();
 await drag(1);await drag(1);const edge=await position();expect(edge[0]).not.toBe(zoomedPosition[0]);expect(edge[1]).not.toBe(zoomedPosition[1]);await drag(1);expect(await position()).toEqual(edge);
 await drag(-1);await drag(-1);await drag(-1);const opposite=await position();expect(opposite[0]).not.toBe(edge[0]);expect(opposite[1]).not.toBe(edge[1]);await drag(-1);expect(await position()).toEqual(opposite);
 await page.getByRole('button',{name:'Reset zoom',exact:true}).click();await expect(point).toHaveAttribute('transform',start);await expect(point).toHaveAttribute('d',shape);await expect(point).toHaveAttribute('fill',fill);
 const magnify=page.getByRole('button',{name:'Drag to zoom',exact:true});await magnify.click();await expect(magnify).toHaveAttribute('aria-pressed','true');
 await page.mouse.move(box.x+box.width*.2,box.y+box.height*.2);await page.mouse.down();await page.mouse.move(box.x+box.width*.8,box.y+box.height*.8,{steps:4});
 await expect(page.locator('.scatter-zoom-selection')).toBeVisible();await page.mouse.up();await expect(point).not.toHaveAttribute('transform',start);await expect(page.locator('.scatter-zoom-selection')).toBeHidden();await expect(magnify).toHaveAttribute('aria-pressed','false');await expect(page.locator('#chart .scatter-plot')).not.toHaveClass(/is-box-zoom/);
 await page.getByRole('button',{name:'Reset zoom',exact:true}).click();await expect(point).toHaveAttribute('transform',start);
 await magnify.click();
 await page.mouse.move(box.x+box.width*.2,box.y+box.height*.2);await page.mouse.down();await page.mouse.move(box.x+box.width*.7,box.y+box.height*.7);await page.keyboard.press('Escape');await page.mouse.up();await expect(point).toHaveAttribute('transform',start);await expect(page.locator('.scatter-zoom-selection')).toBeHidden();
 await magnify.click();await expect(magnify).toHaveAttribute('aria-pressed','false');
 await point.hover();await expect(page.locator('.scatter-tooltip:not([hidden])')).toBeVisible();
 await page.mouse.move(box.x+box.width*.1,box.y+box.height*.1);await expect(page.locator('.scatter-tooltip:not([hidden])')).toHaveCount(0);await expect(point).toHaveAttribute('stroke-width','0');
 expect(errors).toEqual([]);
});

test('scatter appearance controls save, restore and export',async({page,studio})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await open(page,studio.url);
 await edit(page,'SELECT i AS x,i*i AS y FROM range(5) t(i)');await page.locator('#runBtn').click();await expect(page.locator('#results')).toContainText('16');await page.locator('#viewSeg [data-v=chart]').click();
 const bar=page.locator('#chartbar');await bar.getByRole('button',{name:/Chart settings/}).click();await bar.getByRole('combobox',{name:'Chart',exact:true}).selectOption('scatter');await bar.locator('summary').filter({hasText:'Style'}).click();
 await bar.getByRole('combobox',{name:'Point size',exact:true}).selectOption('2');await bar.getByRole('combobox',{name:'Opacity',exact:true}).selectOption('0.5');await bar.getByLabel('Point outlines',{exact:true}).check();await bar.getByLabel('Gridlines',{exact:true}).uncheck();await bar.getByLabel('Show legends',{exact:true}).uncheck();
 await expect(page.locator('#chart .mark-symbol.role-mark path').first()).toHaveAttribute('opacity','0.5');await expect(page.locator('#chart .mark-symbol.role-mark path').first()).toHaveAttribute('stroke-width','1');
 page.once('dialog',d=>d.accept('Styled scatter'));await page.locator('#saveBtn').click();await expect(page.locator('#status')).toContainText('Saved');
 const work=await (await page.request.get(studio.url+'/saved_queries.json')).json();expect(work.queries.find(q=>q.name==='Styled scatter').chart.scatterStyle).toMatchObject({size:2,opacity:.5,outline:true,grid:false,legend:false});
 await page.reload();await page.locator('#runBtn').click();await expect(page.locator('#chart .mark-symbol.role-mark path').first()).toHaveAttribute('opacity','0.5');
 await expect(page.locator('#pngBtn')).toBeEnabled();const download=page.waitForEvent('download');await page.locator('#pngBtn').click();expect((await download).suggestedFilename()).toMatch(/\.png$/);expect(errors).toEqual([]);
});

test('category styling and numeric mapping rules persist and reject invalid ranges',async({page,studio})=>{
 await open(page,studio.url);await edit(page,"SELECT * FROM (VALUES (1,2,5,'A'),(2,4,20,'B')) t(x,y,weight,category)");await page.locator('#runBtn').click();await expect(page.locator('#results')).toContainText('category');await page.locator('#viewSeg [data-v=chart]').click();const bar=page.locator('#chartbar');await bar.getByRole('button',{name:/Chart settings/}).click();await bar.getByRole('combobox',{name:'Chart',exact:true}).selectOption('scatter');
 for(const [name,value] of [['Color','category'],['Shape','category'],['Size','weight'],['Brightness','weight']])await bar.getByRole('combobox',{name,exact:true}).selectOption(value);
 await bar.locator('summary').filter({hasText:/^Style$/}).click();await bar.getByLabel('Color legend',{exact:true}).uncheck();await bar.getByLabel('Brightness legend',{exact:true}).uncheck();await expect(bar.getByLabel('Shape legend',{exact:true})).toBeChecked();await expect(bar.getByLabel('Size legend',{exact:true})).toBeChecked();await bar.locator('summary').filter({hasText:'Category colors'}).click();await bar.getByLabel('color for A',{exact:true}).fill('#ff0000');await bar.getByRole('button',{name:'Apply category colors',exact:true}).click();
 await bar.locator('summary').filter({hasText:'Category shapes'}).click();await bar.getByRole('combobox',{name:'shape for B',exact:true}).selectOption('diamond');await bar.getByRole('button',{name:'Apply category shapes',exact:true}).click();
 await bar.locator('summary').filter({hasText:'Size mapping'}).click();await bar.getByLabel('Size mapping input minimum',{exact:true}).fill('30');await bar.getByLabel('Size mapping input maximum',{exact:true}).fill('10');await bar.getByRole('button',{name:'Apply size mapping',exact:true}).click();await expect(bar.getByRole('alert')).toBeVisible();
 await bar.getByLabel('Size mapping input minimum',{exact:true}).fill('0');await bar.getByLabel('Size mapping input maximum',{exact:true}).fill('20');await bar.getByLabel('Size mapping minimum area',{exact:true}).fill('50');await bar.getByLabel('Size mapping maximum area',{exact:true}).fill('500');await bar.getByRole('button',{name:'Apply size mapping',exact:true}).click();
 await bar.locator('summary').filter({hasText:'Brightness mapping'}).click();await bar.getByLabel('Brightness mapping minimum lightness',{exact:true}).fill('20');await bar.getByLabel('Brightness mapping maximum lightness',{exact:true}).fill('80');await expect(bar.getByRole('img',{name:'Lightness preview: low values 20%, high values 80%',exact:true})).toBeVisible();await bar.locator('summary').filter({hasText:'Brightness mapping'}).locator('..').getByRole('checkbox',{name:'Reverse mapping'}).check();await expect(bar.getByRole('img',{name:'Lightness preview: low values 80%, high values 20%',exact:true})).toBeVisible();await bar.getByRole('button',{name:'Apply brightness mapping',exact:true}).click();
 page.once('dialog',d=>d.accept('Mapped scatter'));await page.locator('#saveBtn').click();await expect(page.locator('#status')).toContainText('Saved');const work=await (await page.request.get(studio.url+'/saved_queries.json')).json(),c=work.queries.find(q=>q.name==='Mapped scatter').chart;
 expect(c.scatterStyle.legends).toEqual({color:false,brightness:false});
 expect(c.categoryStyles.color.category.A).toBe('#ff0000');expect(c.categoryStyles.shape.category.B).toBe('diamond');expect(c.scatterRules.size.outputMax).toBe(500);expect(c.scatterRules.brightness.reverse).toBe(true);
 await page.reload();await page.locator('#runBtn').click();await expect(page.locator('#chart .mark-symbol.role-mark path')).toHaveCount(2);
});

test('categorical scatter keeps labels through zoom, export and reload',async({page,studio})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await open(page,studio.url);
 await edit(page,"SELECT * FROM (VALUES ('Oak',12),('Beech',8),('Oak',12),('Maple',17)) t(species,diameter)");
 await page.locator('#runBtn').click();await expect(page.locator('#results')).toContainText('Beech');
 await page.locator('#viewSeg [data-v=chart]').click();const bar=page.locator('#chartbar');await bar.getByRole('button',{name:/Chart settings/}).click();await bar.getByRole('combobox',{name:'Chart',exact:true}).selectOption('scatter');
 await expect(bar.getByRole('combobox',{name:'X',exact:true})).toHaveValue('species');
 const points=page.locator('#chart .mark-symbol.role-mark path');await expect(points).toHaveCount(4);
 await expect(page.locator('#chart')).toContainText('Beech');
 await bar.getByRole('combobox',{name:'Category order',exact:true}).selectOption('alphabetical');
 await bar.getByRole('button',{name:/Chart settings/}).click();await settleChartLayout(page);
 await points.first().hover();await expect(page.locator('.scatter-tooltip:not([hidden])')).toContainText('Oak');await expect(page.locator('#chart .scatter-focus')).toContainText('species: Oak');
 await page.getByRole('button',{name:'Zoom in',exact:true}).click();await page.getByRole('button',{name:'Reset zoom',exact:true}).click();
 await expect(page.locator('#pngBtn')).toBeEnabled();const download=page.waitForEvent('download');await page.locator('#pngBtn').click();expect((await download).suggestedFilename()).toMatch(/\.png$/);
 page.once('dialog',d=>d.accept('Species scatter'));await page.locator('#saveBtn').click();await expect(page.locator('#status')).toContainText('Saved');
 await page.reload();await page.locator('#runBtn').click();await expect(points).toHaveCount(4);await expect(page.locator('#chart')).toContainText('Beech');expect(errors).toEqual([]);
});

test('beeswarm packs categorical points, repacks on resize and exports',async({page,studio})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await open(page,studio.url);
 await edit(page,"SELECT 'Oak' AS species, 12 AS diameter FROM range(8)");await page.locator('#runBtn').click();await expect(page.locator('#results')).toContainText('Oak');await page.locator('#viewSeg [data-v=chart]').click();
 const bar=page.locator('#chartbar');await bar.getByRole('button',{name:/Chart settings/}).click();await bar.getByRole('combobox',{name:'Chart',exact:true}).selectOption('scatter');await bar.getByRole('combobox',{name:'Point layout',exact:true}).selectOption('beeswarm');
 await expect(page.locator('#chart')).toContainText('Beeswarm:');const points=page.locator('#chart .mark-symbol.role-mark path');await expect(points).toHaveCount(8);
 await bar.getByRole('button',{name:/Chart settings/}).click(); await settleChartLayout(page,{canvas:true}); const positions=await points.evaluateAll(ns=>ns.map(n=>n.getAttribute('transform')));expect(new Set(positions).size).toBe(8);
 await expect(points).toHaveCount(8);
 await page.getByRole('button',{name:'Zoom in',exact:true}).click();await page.getByRole('button',{name:'Reset zoom',exact:true}).click();
 const dl=page.waitForEvent('download');await page.locator('#pngBtn').click();expect((await dl).suggestedFilename()).toMatch(/png$/);expect(errors).toEqual([]);
});

test('box overlay shows full summaries while filtering outliers and sorting medians',async({page,studio})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await open(page,studio.url);
 await edit(page,"SELECT * FROM (VALUES ('Oak',1),('Oak',2),('Oak',3),('Oak',4),('Oak',5),('Oak',100),('Beech',10)) t(species,diameter)");
 await page.locator('#runBtn').click();await expect(page.locator('#results')).toContainText('Beech');await page.locator('#viewSeg [data-v=chart]').click();
 const bar=page.locator('#chartbar');await bar.getByRole('button',{name:/Chart settings/}).click();await bar.getByRole('combobox',{name:'Chart',exact:true}).selectOption('scatter');
 await bar.locator('summary').filter({hasText:'Distribution'}).click();await bar.getByRole('combobox',{name:'Summary',exact:true}).selectOption('box');
 await expect(page.locator('#chart .studioBoxBody path')).toHaveCount(2);await expect(page.locator('#chart .studioBoxCounts')).toContainText('n=6');
 await bar.getByRole('combobox',{name:'Category order',exact:true}).selectOption('medianAsc');
 await bar.getByRole('combobox',{name:'Show points',exact:true}).selectOption('outliers');
 await expect(page.locator('#chart .mark-symbol.role-mark path')).toHaveCount(1);
 await bar.getByRole('button',{name:/Chart settings/}).click();await settleChartLayout(page);
 await page.locator('#chart .studioBoxCounts text').first().hover();await expect(page.locator('.scatter-tooltip:not([hidden])')).toContainText('Median');
 await page.getByRole('button',{name:'Zoom in',exact:true}).click();await expect(page.locator('#chart .studioBoxCounts')).toContainText('n=6');await page.getByRole('button',{name:'Reset zoom',exact:true}).click();
 const dl=page.waitForEvent('download');await page.locator('#pngBtn').click();expect((await dl).suggestedFilename()).toMatch(/png$/);
 page.once('dialog',d=>d.accept('Box test'));await page.locator('#saveBtn').click();await expect(page.locator('#status')).toContainText('Saved');await page.reload();await page.locator('#runBtn').click();await expect(page.locator('#chart .studioBoxBody path')).toHaveCount(2);await expect(page.locator('#chart .mark-symbol.role-mark path')).toHaveCount(1);expect(errors).toEqual([]);
});

test('box statistics controls update summaries and persist',async({page,studio})=>{
 await open(page,studio.url);await edit(page,"SELECT 'Oak' AS species, i AS diameter FROM range(11) t(i)");await page.locator('#runBtn').click();await expect(page.locator('#results')).toContainText('Oak');await page.locator('#viewSeg [data-v=chart]').click();
 const bar=page.locator('#chartbar');await bar.getByRole('button',{name:/Chart settings/}).click();await bar.getByRole('combobox',{name:'Chart',exact:true}).selectOption('scatter');await bar.locator('summary').filter({hasText:'Distribution'}).click();await bar.getByRole('combobox',{name:'Summary',exact:true}).selectOption('box');
 await bar.getByRole('combobox',{name:'Center line',exact:true}).selectOption('mean');
 await bar.getByLabel('Box lower percentile',{exact:true}).fill('10');await bar.getByLabel('Box lower percentile',{exact:true}).press('Tab');await expect(bar.getByLabel('Box lower percentile',{exact:true})).toHaveValue('10');await expect(bar.getByLabel('Box upper percentile',{exact:true})).toHaveValue('75');
 await bar.getByLabel('Box upper percentile',{exact:true}).fill('90');await bar.getByLabel('Box upper percentile',{exact:true}).press('Tab');await expect(bar.getByLabel('Box upper percentile',{exact:true})).toHaveValue('90');
 await bar.getByRole('combobox',{name:'Whiskers',exact:true}).selectOption('range');await bar.getByRole('combobox',{name:'Show points',exact:true}).selectOption('outliers');await expect(page.locator('#chart .mark-symbol.role-mark path')).toHaveCount(0);
 await bar.getByRole('combobox',{name:'Whiskers',exact:true}).selectOption('percentile');await expect(page.locator('#chart .mark-symbol.role-mark path')).toHaveCount(2);
 await bar.getByRole('combobox',{name:'Show points',exact:true}).selectOption('none');await expect(page.locator('#chart .mark-symbol.role-mark path')).toHaveCount(0);await expect(page.locator('#chart .studioBoxBody path')).toHaveCount(1);
 await bar.locator('summary').filter({hasText:'Distribution'}).click();await expect(bar.getByRole('combobox',{name:'Show points',exact:true})).toBeHidden();await expect(bar.locator('.scatter-distribution')).toContainText('No points');
 await bar.getByRole('button',{name:/Chart settings/}).click();await settleChartLayout(page);await page.locator('#chart .studioBoxCounts text').hover();await expect(page.locator('.scatter-tooltip:not([hidden])')).toContainText('Mean');await expect(page.locator('.scatter-tooltip:not([hidden])')).toContainText('Box lower (P10)');
 page.once('dialog',d=>d.accept('Custom boxes'));await page.locator('#saveBtn').click();await expect(page.locator('#status')).toContainText('Saved');await page.reload();await page.locator('#runBtn').click();await expect(page.locator('#chart')).toContainText('Box: P10–P90');await expect(page.locator('#chart .mark-symbol.role-mark path')).toHaveCount(0);await expect(page.locator('#chart .studioBoxBody path')).toHaveCount(1);
});

test('violin distributions combine with boxes, hide points, zoom and save',async({page,studio})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await open(page,studio.url);await edit(page,"SELECT CASE WHEN i<30 THEN 'Oak' ELSE 'Beech' END species, (i%7)*(i%7) diameter FROM range(60) t(i)");await page.locator('#runBtn').click();await expect(page.locator('#results')).toContainText('Beech');await page.locator('#viewSeg [data-v=chart]').click();
 const bar=page.locator('#chartbar');await bar.getByRole('button',{name:/Chart settings/}).click();await bar.getByRole('combobox',{name:'Chart',exact:true}).selectOption('scatter');await bar.locator('summary').filter({hasText:'Distribution'}).click();await bar.getByRole('combobox',{name:'Summary',exact:true}).selectOption('violin');
 const violins=page.locator('#chart .studioViolinArea path');await expect(violins).toHaveCount(2);await expect(page.locator('#chart .studioBoxBody path')).toHaveCount(0);
 await bar.getByRole('combobox',{name:'Show points',exact:true}).selectOption('none');await expect(page.locator('#chart .mark-symbol.role-mark path')).toHaveCount(0);
 await bar.getByRole('checkbox',{name:'Show box summary'}).check();await expect(page.locator('#chart .studioBoxCenter path')).toHaveCount(2);await bar.getByRole('checkbox',{name:'Show box summary'}).uncheck();await expect(page.locator('#chart .studioBoxCenter path')).toHaveCount(0);await bar.getByRole('checkbox',{name:'Show box summary'}).check();await expect(page.locator('#chart .studioBoxBody path')).toHaveCount(0);await expect(page.locator('#chart .studioBoxInner line')).toHaveCount(2);await expect(page.locator('#chart .studioBoxCenter path')).toHaveCount(2);
 await bar.getByRole('button',{name:/Chart settings/}).click();await settleChartLayout(page);const start=await violins.first().getAttribute('d');expect(start.length).toBeGreaterThan(100);
 await page.getByRole('button',{name:'Zoom in',exact:true}).click();await expect(violins.first()).not.toHaveAttribute('d',start);await page.getByRole('button',{name:'Reset zoom',exact:true}).click();await expect(violins.first()).toHaveAttribute('d',start);
 await page.screenshot({path:'/tmp/mds-violin-test.png'});
 const dl=page.waitForEvent('download');await page.locator('#pngBtn').click();expect((await dl).suggestedFilename()).toMatch(/png$/);
 page.once('dialog',d=>d.accept('Violin test'));await page.locator('#saveBtn').click();await expect(page.locator('#status')).toContainText('Saved');await page.reload();await page.locator('#runBtn').click();await expect(violins).toHaveCount(2);await expect(page.locator('#chart .studioBoxBody path')).toHaveCount(0);await expect(page.locator('#chart .studioBoxInner line')).toHaveCount(2);await expect(page.locator('#chart .studioBoxCenter path')).toHaveCount(2);expect(errors).toEqual([]);
});
