import {test,expect,open} from './fixtures.mjs';
async function addAssumption(page,label='Values over time'){
  await page.locator('#nbCells .adder.end').getByRole('button',{name:'Add assumptions',exact:true}).click();
  await page.getByRole('option',{name:label,exact:true}).click();
}

test('assumption cell fixes history, saves future parameters and passes them to Python',async({page,studio})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await open(page,studio.url);await page.getByRole('tab',{name:'Analyses',exact:true}).click();
  page.once('dialog',d=>d.accept('Assumption example'));await page.locator('#newNotebook').click();
  const sql=page.locator('#nbCells .cell.sql');await sql.locator('.CodeMirror').click();await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText("SELECT * FROM (VALUES (DATE '2026-10-01',100.0), (DATE '2026-11-01',110.0)) AS t(month, rainfall)");
  await page.locator('#nbRunAll').click();await expect(page.locator('#nbStatus')).toHaveText('');await expect(sql.locator('.cell-meta')).toContainText('2 rows');
  await addAssumption(page);
  const cell=page.locator('#nbCells .cell.assumption');
  async function choose(label,option){await cell.getByRole('button',{name:label,exact:true}).click();await page.getByRole('option',{name:option,exact:true}).click();}
  await choose('History cell','q1');
  await choose('Date column','month');await choose('Value column','rainfall');
  await cell.getByRole('button',{name:'Load / refresh history',exact:true}).click();
  await expect(cell.locator('svg')).toHaveCount(1);
  const point=cell.locator('.assumption-plot').first().locator('circle').last();await point.scrollIntoViewIfNeeded();const handle=await point.boundingBox();
  await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(handle.x+handle.width/2,handle.y-25,{steps:5});await page.mouse.up();
  await expect(cell.getByLabel('Future value 2027-02-01',{exact:true})).not.toHaveValue('110');
  await cell.getByRole('button',{name:'Undo',exact:true}).first().click();await expect(cell.getByLabel('Future value 2027-02-01',{exact:true})).toHaveValue('110');
  await cell.getByLabel('Future value 2026-12-01',{exact:true}).fill('120');await cell.getByLabel('Future value 2026-12-01',{exact:true}).press('Tab');
  await cell.getByRole('button',{name:'▶ Run',exact:true}).click();await expect(cell.locator('.cell-meta')).toContainText('5 rows');
  await page.locator('#nbCells .adder.end').getByRole('button',{name:'+ Python',exact:true}).click();
  const py=page.locator('#nbCells .cell.python');await py.locator('.CodeMirror').click();
  await page.keyboard.insertText("assert assumption1.loc[assumption1.segment == 'actual', 'value'].tolist() == [100, 110]\nassumption1[['segment', 'value']]");await py.getByRole('button',{name:'▶ Run',exact:true}).click();
  await expect(py.locator('.cell-meta')).toContainText('5 rows');await expect(py.locator('.cell-out')).toContainText('120');
  await cell.getByLabel('Future value 2026-12-01',{exact:true}).fill('125');await cell.getByLabel('Future value 2026-12-01',{exact:true}).press('Tab');
  await expect(py.locator('.cstate')).toContainText('rerun');await py.getByRole('button',{name:'▶ Run',exact:true}).click();await expect(py.locator('.error')).toContainText('Run assumption1 first');
  await expect.poll(async()=>{const work=await (await page.request.get(studio.url+'/saved_queries.json')).json();return work.notebooks.find(n=>n.name==='Assumption example')?.cells.find(c=>c.type==='assumption')?.assumption.points;}).toContainEqual(['2026-12-01',125]);
  await page.reload();await expect(cell).toBeVisible();await page.locator('#nbRunAll').click();await expect(py.locator('.cell-meta')).toContainText('5 rows');await expect(py.locator('.cell-out')).toContainText('125');
  if(process.env.MDS_TEST_R==='1'){
    await page.locator('#nbCells .adder.end').getByRole('button',{name:'+ R',exact:true}).click();
    const r=page.locator('#nbCells .cell.r');await r.locator('.CodeMirror').click();await page.keyboard.insertText('assumption1[, c("segment", "value")]');
    await r.getByRole('button',{name:'▶ Run',exact:true}).click();await expect(r.locator('.cell-meta')).toContainText('5 rows');await expect(r.locator('.cell-out')).toContainText('125');
  }
  expect(errors).toEqual([]);
});

test('date-range assumptions run without history and retain axis controls',async({page,studio})=>{
  await open(page,studio.url);await page.getByRole('tab',{name:'Analyses',exact:true}).click();
  page.once('dialog',d=>d.accept('Date range example'));await page.locator('#newNotebook').click();
  await addAssumption(page);
  const cell=page.locator('#nbCells .cell.assumption');
  await cell.getByRole('button',{name:'Start from',exact:true}).click();await page.getByRole('option',{name:'Date range',exact:true}).click();
  await expect(cell.getByRole('button',{name:'History cell',exact:true})).toBeHidden();
  await cell.getByLabel('Start date',{exact:true}).fill('2026-01-01');await cell.getByLabel('Start date',{exact:true}).press('Tab');
  await cell.getByRole('button',{name:'Update chart',exact:true}).click();
  await cell.locator('.assumption-axis summary').first().click();
  await cell.getByLabel('Value Y min',{exact:true}).fill('-10');await cell.getByLabel('Value Y min',{exact:true}).press('Tab');
  await cell.getByLabel('Value Y max',{exact:true}).fill('200');await cell.getByLabel('Value Y max',{exact:true}).press('Tab');
  await cell.getByLabel('Value Snap increment',{exact:true}).fill('0.5');await cell.getByLabel('Value Snap increment',{exact:true}).press('Tab');
  await cell.getByLabel('Future value 2026-02-01',{exact:true}).fill('7.3');await cell.getByLabel('Future value 2026-02-01',{exact:true}).press('Tab');
  await expect(cell.getByLabel('Future value 2026-02-01',{exact:true})).toHaveValue('7.3');
  await cell.getByRole('button',{name:'▶ Run',exact:true}).click();await expect(cell.locator('.cell-meta')).toContainText('3 rows');
  await page.locator('#nbCells .adder.end').getByRole('button',{name:'+ Python',exact:true}).click();
  const py=page.locator('#nbCells .cell.python');await py.locator('.CodeMirror').click();await page.keyboard.insertText("assert (assumption1.segment == 'future').all()\nassumption1");
  await py.getByRole('button',{name:'▶ Run',exact:true}).click();await expect(py.locator('.cell-meta')).toContainText('3 rows');
  await expect.poll(async()=>{const work=await (await page.request.get(studio.url+'/saved_queries.json')).json();return work.notebooks.find(n=>n.name==='Date range example')?.cells.find(c=>c.type==='assumption')?.assumption.meanAxis;}).toEqual({min:-10,max:200,snap:.5});
  await page.reload();await expect(cell.locator('svg')).toHaveCount(1);await cell.locator('.assumption-axis summary').click();
  await expect(cell.getByLabel('Value Y max',{exact:true})).toHaveValue('200');
  await expect(cell.getByLabel('Value Snap increment',{exact:true})).toHaveValue('0.5');
  await cell.getByLabel('Value Y max',{exact:true}).fill('-20');await cell.getByLabel('Value Y max',{exact:true}).press('Tab');await expect(cell.getByRole('status')).toContainText('less than');
  await cell.getByRole('button',{name:'Auto',exact:true}).click();await expect(cell.locator('[role=status]')).toHaveText('');
  await cell.getByRole('button',{name:'Interval',exact:true}).click();await page.getByRole('option',{name:'Yearly',exact:true}).click();
  await cell.getByRole('button',{name:'Update chart',exact:true}).click();
  await expect(cell.getByLabel('Future value 2028-01-01',{exact:true})).toBeVisible();
  await cell.getByRole('button',{name:'▶ Run',exact:true}).click();await expect(cell.locator('.cell-meta')).toContainText('3 rows');
});

test('named series isolate editing and feed Python and R after reload',async({page,studio})=>{
  await open(page,studio.url);await page.getByRole('tab',{name:'Analyses',exact:true}).click();
  page.once('dialog',d=>d.accept('Multiple inputs'));await page.locator('#newNotebook').click();
  await addAssumption(page);
  const cell=page.locator('#nbCells .cell.assumption');
  await cell.getByRole('button',{name:'Start from',exact:true}).click();await page.getByRole('option',{name:'Date range',exact:true}).click();
  await cell.getByLabel('Start date',{exact:true}).fill('2026-01-01');await cell.getByLabel('Start date',{exact:true}).press('Tab');
  await cell.getByRole('button',{name:'Update chart',exact:true}).click();
  await cell.getByLabel('Series name',{exact:true}).fill('Rainfall');await cell.getByLabel('Series name',{exact:true}).press('Tab');
  await cell.getByLabel('Future value 2026-03-01',{exact:true}).fill('20');await cell.getByLabel('Future value 2026-03-01',{exact:true}).press('Tab');
  await cell.getByRole('button',{name:'+ Series',exact:true}).click();
  await cell.getByLabel('Series name',{exact:true}).fill('Temperature');await cell.getByLabel('Series name',{exact:true}).press('Tab');
  await cell.getByLabel('Future value 2026-03-01',{exact:true}).fill('30');await cell.getByLabel('Future value 2026-03-01',{exact:true}).press('Tab');
  await cell.getByRole('button',{name:'Update chart',exact:true}).click();
  await expect(cell.locator('.assumption-plot').first().locator('path[stroke-opacity]')).toHaveCount(2);
  await cell.getByRole('button',{name:'Rainfall',exact:true}).click();
  await expect(cell.getByRole('button',{name:'Rainfall',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(cell.getByLabel('Future value 2026-03-01',{exact:true})).toHaveValue('20');
  await expect(cell.locator('.assumption-plot')).toHaveCount(1);
  await cell.getByLabel('Series name',{exact:true}).fill('temperature');await cell.getByLabel('Series name',{exact:true}).press('Tab');
  await expect(cell.getByRole('status')).toContainText('unique name');await expect(cell.getByLabel('Series name',{exact:true})).toHaveValue('Rainfall');
  await cell.getByRole('button',{name:'▶ Run',exact:true}).click();await expect(cell.locator('.cell-meta')).toContainText('6 rows');
  await page.locator('#nbCells .adder.end').getByRole('button',{name:'+ Python',exact:true}).click();const py=page.locator('#nbCells .cell.python');
  await py.locator('.CodeMirror').click();await page.keyboard.insertText("assert set(assumption1.series) == {'Rainfall', 'Temperature'}\nassert assumption1.loc[assumption1.series == 'Rainfall', 'value'].iloc[-1] == 20\nassert assumption1.loc[assumption1.series == 'Temperature', 'value'].iloc[-1] == 30\nassumption1");
  await py.getByRole('button',{name:'▶ Run',exact:true}).click();await expect(py.locator('.cell-meta')).toContainText('6 rows');
  await page.reload();await expect(cell.getByRole('button',{name:'Temperature',exact:true})).toBeVisible();
  await cell.getByRole('button',{name:'▶ Run',exact:true}).click();await py.getByRole('button',{name:'▶ Run',exact:true}).click();await expect(py.locator('.cell-meta')).toContainText('6 rows');
  if(process.env.MDS_TEST_R==='1'){
    await page.locator('#nbCells .adder.end').getByRole('button',{name:'+ R',exact:true}).click();const r=page.locator('#nbCells .cell.r');await r.locator('.CodeMirror').click();
    await page.keyboard.insertText('stopifnot(length(unique(assumption1$series)) == 2)\nassumption1');await r.getByRole('button',{name:'▶ Run',exact:true}).click();await expect(r.locator('.cell-meta')).toContainText('6 rows');
  }
  await cell.getByRole('button',{name:'Temperature',exact:true}).click();page.once('dialog',d=>d.accept());
  await cell.getByRole('button',{name:'Remove series',exact:true}).click();await expect(cell.getByRole('button',{name:'Temperature',exact:true})).toHaveCount(0);
  await cell.getByRole('button',{name:'▶ Run',exact:true}).click();await expect(cell.locator('.cell-meta')).toContainText('3 rows');
  await cell.getByRole('button',{name:'Value monotonicity',exact:true}).click();await page.getByRole('option',{name:'Non-decreasing',exact:true}).click();
  const plot=cell.locator('.assumption-plot').first(),handle=plot.locator('circle').first();await handle.scrollIntoViewIfNeeded();
  const a=await handle.boundingBox(),b=await plot.locator('circle').last().boundingBox();
  await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(a.x+a.width/2,b.y-25,{steps:8});await page.mouse.up();
  await expect(cell.getByLabel('Future value 2026-01-01',{exact:true})).toHaveValue('20');await expect(cell.locator('[role=status]')).toHaveText('');
  await cell.getByRole('button',{name:'Undo',exact:true}).first().click();await expect(cell.getByLabel('Future value 2026-01-01',{exact:true})).toHaveValue('0');
  await handle.scrollIntoViewIfNeeded();const left=await handle.boundingBox(),right=await plot.locator('circle').last().boundingBox();
  const clickX=(left.x+right.x+left.width)/2,clickY=right.y-25;
  await page.mouse.move(clickX,clickY);
  await expect(plot.locator('.assumption-add-preview circle')).toHaveCount(1);
  const proposed=await plot.locator('.assumption-add-preview circle').boundingBox();expect(Math.abs(proposed.y-right.y)).toBeLessThan(2);
  await page.mouse.click(clickX,clickY);
  await expect(cell.getByLabel('Future value 2026-02-01',{exact:true})).toHaveValue('20');await expect(cell.locator('[role=status]')).toHaveText('');
  await cell.getByRole('button',{name:'Undo',exact:true}).first().click();await expect(cell.getByLabel('Future value 2026-02-01',{exact:true})).toHaveValue('10');
  await cell.getByLabel('Future value 2026-02-01',{exact:true}).fill('50');await cell.getByLabel('Future value 2026-02-01',{exact:true}).press('Tab');
  await expect(cell.getByRole('status')).toContainText('monotonicity');await expect(cell.getByLabel('Future value 2026-02-01',{exact:true})).toHaveValue('10');
  await cell.getByRole('button',{name:'Value monotonicity',exact:true}).click();await page.getByRole('option',{name:'Non-increasing',exact:true}).click();
  await expect(cell.getByRole('status')).toContainText('Existing points');
  await expect(cell.getByRole('button',{name:'Value monotonicity',exact:true})).toContainText('Non-decreasing');
  await expect.poll(async()=>{const w=await (await page.request.get(studio.url+'/saved_queries.json')).json();return w.notebooks.find(n=>n.name==='Multiple inputs')?.cells.find(c=>c.type==='assumption')?.assumption.series[0].monotonicity;}).toBe('ascending');
  await page.reload();await expect(cell.getByRole('button',{name:'Value monotonicity',exact:true})).toContainText('Non-decreasing');
});

test('saved Normal inputs migrate to named values with no distribution controls',async({page,studio})=>{
  const work={queries:[],dashboards:[],notebooks:[{id:'legacy',name:'Legacy inputs',cells:[{id:'input',type:'assumption',name:'inputs',view:'table',assumption:{format:1,basis:'range',startDate:'2026-01-01',grain:'month',horizon:3,mode:'normal',points:[['2026-01-01',10],['2026-03-01',20]],spread:[['2026-01-01',2],['2026-03-01',4]]}}]}]};
  await studio.writeScript('saved_queries.json',JSON.stringify(work));await open(page,studio.url);await page.getByRole('tab',{name:'Analyses',exact:true}).click();await page.getByText('Legacy inputs',{exact:false}).click();
  const cell=page.locator('#nbCells .cell.assumption');await expect(cell.getByRole('button',{name:'Input type',exact:true})).toHaveCount(0);await expect(cell.locator('svg')).toHaveCount(1);
  await cell.getByRole('button',{name:'Series 1 standard deviation',exact:true}).click();await expect(cell.getByLabel('Future value 2026-03-01',{exact:true})).toHaveValue('4');
  await cell.getByRole('button',{name:'▶ Run',exact:true}).click();await expect(cell.locator('.cell-meta')).toContainText('6 rows');
  await expect(cell.locator('.cell-out th').filter({hasText:/^sd/})).toHaveCount(0);
  await page.reload();await expect(cell.getByRole('button',{name:'Series 1 standard deviation',exact:true})).toHaveCount(1);
});

test('percent-total chart edits shares, runs and restores after reload',async({page,studio})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const assumption={format:1,chartType:'percent',valueSeries:true,basis:'range',startDate:'2026-01-01',grain:'month',horizon:3,mode:'values',points:[],spread:[],series:[30,70].map((v,i)=>({id:'s'+i,name:'Share '+i,color:i?'#51b99a':'#478bf5',mode:'values',points:[['2026-01-01',v]],spread:[]}))};
  await studio.writeScript('saved_queries.json',JSON.stringify({queries:[],dashboards:[],notebooks:[{id:'allocation',name:'Allocation test',cells:[{id:'a',type:'assumption',name:'allocation',view:'table',assumption}]}]}));
  await open(page,studio.url);await page.getByRole('tab',{name:'Analyses',exact:true}).click();await page.getByText('Allocation test',{exact:false}).click();
  const cell=page.locator('#nbCells .cell.assumption');await expect(cell.getByRole('button',{name:'Chart type',exact:true})).toHaveCount(0);
  await expect(cell.locator('svg[aria-label="Editable allocation boundaries"]')).toHaveCount(1);
  const input=cell.getByLabel('Future value 2026-02-01',{exact:true});await input.fill('40');await input.press('Tab');
  await cell.getByRole('button',{name:'Share 1',exact:true}).click();await expect(input).toHaveValue('60');
  await cell.getByRole('button',{name:'▶ Run',exact:true}).click();await expect(cell.locator('.cell-meta')).toContainText('6 rows');
  await expect.poll(async()=>{const w=await (await page.request.get(studio.url+'/saved_queries.json')).json();return w.notebooks[0].cells[0].assumption.series[1].points;}).toContainEqual(['2026-02-01',60]);
  await page.reload();await expect(cell.locator('.kind')).toHaveText('% of total');await cell.getByRole('button',{name:'Share 1',exact:true}).click();await expect(input).toHaveValue('60');
  await cell.screenshot({path:'/tmp/mds-percentage-chart.png'});expect(errors).toEqual([]);
});


test('new value and allocation cells have separate fixed types',async({page,studio})=>{
  await open(page,studio.url);await page.getByRole('tab',{name:'Analyses',exact:true}).click();
  page.once('dialog',d=>d.accept('Separate assumptions'));await page.locator('#newNotebook').click();
  const add=page.locator('#nbCells .adder.end');
  await add.getByRole('button',{name:'Add assumptions',exact:true}).press('ArrowDown');
  await page.getByRole('option',{name:'Values over time',exact:true}).press('Escape');
  await expect(page.getByRole('listbox',{name:'Add assumptions'})).toHaveCount(0);
  await addAssumption(page);
  await addAssumption(page,'% of total');
  const cells=page.locator('#nbCells .cell.assumption');
  await expect(cells.locator('.kind')).toHaveText(['Values over time','% of total']);
  await expect(cells.getByRole('button',{name:'Chart type',exact:true})).toHaveCount(0);
  const allocation=cells.last();
  await expect(allocation.getByRole('button',{name:'Series 1',exact:true})).toBeVisible();
  await expect(allocation.getByRole('button',{name:'Series 2',exact:true})).toBeVisible();
  const inputs=allocation.locator('.assumption-inputs');
  await inputs.locator('summary').click();await expect(allocation.getByLabel('Start date',{exact:true})).toBeHidden();
  await expect(allocation.getByRole('button',{name:'Series 2',exact:true})).toBeVisible();
  await expect(allocation.locator('.assumption-plot')).toBeVisible();
  await inputs.locator('summary').focus();await page.keyboard.press('Enter');await expect(allocation.getByLabel('Start date',{exact:true})).toBeVisible();
  await allocation.screenshot({path:'/tmp/mds-inputs-expanded.png'});
  const values=allocation.locator('.assumption-values input');await expect(values).toHaveCount(3);
  for(const input of await values.all())await expect(input).toHaveValue('50');
  const handle=allocation.locator('.assumption-plot circle').last();await handle.scrollIntoViewIfNeeded();const bounds=await handle.boundingBox();
  await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await page.mouse.down();await page.mouse.move(bounds.x+bounds.width/2,bounds.y-30,{steps:5});await page.mouse.up();
  await expect(values.last()).not.toHaveValue('50');
  await allocation.getByRole('button',{name:'Undo',exact:true}).click();await expect(values.last()).toHaveValue('50');

  await expect.poll(async()=>{const w=await (await page.request.get(studio.url+'/saved_queries.json')).json();return w.notebooks.find(n=>n.name==='Separate assumptions')?.cells.filter(c=>c.type==='assumption').map(c=>c.assumption.chartType);}).toEqual(['values','percent']);
  await page.reload();await expect(cells.locator('.kind')).toHaveText(['Values over time','% of total']);
});
