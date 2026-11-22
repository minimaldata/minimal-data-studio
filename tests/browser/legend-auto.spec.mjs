import {test,expect,open,edit} from './fixtures.mjs';
test('Auto and overrides share legend rules across line and bar charts',async({page,studio})=>{
 await page.setViewportSize({width:1440,height:1100});await open(page,studio.url);
 await edit(page,"SELECT DATE '2026-01-01' + i::INTEGER AS day, 'Agent ' || s AS agent, i+s+1 AS activities FROM range(3) t(i) CROSS JOIN range(10) a(s)");
 await page.locator('#runBtn').click();await expect(page.locator('#results')).toContainText('activities');await page.locator('#viewSeg [data-v=chart]').click();
 const bar=page.locator('#chartbar'),chart=page.locator('#chart');await bar.getByRole('button',{name:/Chart settings/}).click();await bar.getByRole('combobox',{name:'Series',exact:true}).selectOption('agent');
 for(const type of ['line','bar','stacked','percent']){
  await bar.getByRole('combobox',{name:'Chart',exact:true}).selectOption(type);
  if(type==='line')await bar.getByRole('combobox',{name:'Display series',exact:true}).selectOption('all');
  const legend=bar.getByRole('combobox',{name:'Legend style',exact:true});await legend.selectOption('auto');
  await expect(chart.locator('.line-series-tools')).toBeVisible();await expect(chart.locator('.cohort-strip')).toHaveCount(0);
  await legend.selectOption('inline');await expect(chart.locator('.clegend .citem')).toHaveCount(10);
  await legend.selectOption('strip');await expect(chart.locator('.cohort-strip')).toBeVisible();
  await chart.getByRole('button',{name:'Select all',exact:true}).click();await expect(chart.getByRole('button',{name:'Clear selection',exact:true})).toBeEnabled();
  await chart.getByRole('button',{name:'Clear selection',exact:true}).click();
  await legend.selectOption('auto');await bar.getByRole('combobox',{name:'Series meaning',exact:true}).selectOption('cohorts');await expect(chart.locator('.cohort-strip')).toBeVisible();
  await bar.getByRole('combobox',{name:'Series meaning',exact:true}).selectOption('series');await expect(chart.locator('.line-series-tools')).toBeVisible();
 }
});
