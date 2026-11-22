import {test,expect,open,edit} from './fixtures.mjs';
test('Y measures redraw only on Apply and cancel keeps the applied selection',async({page,studio})=>{
 await open(page,studio.url);await edit(page,"SELECT DATE '2026-01-01' + i::INTEGER AS day, i AS first, i*2 AS second, i*3 AS third FROM range(10) t(i)");
 await page.locator('#runBtn').click();await expect(page.locator('#results')).toContainText('first');await page.locator('#viewSeg [data-v=chart]').click();
 const chart=page.locator('#chart');await expect(chart.locator('.mark-line path').first()).toBeVisible();
 await page.locator('#chartbar').getByRole('button',{name:/Chart settings/}).click();
 const picker=page.locator('#chartbar .chart-measures');await picker.locator('summary').click();
 const before=await picker.getByRole('checkbox').evaluateAll(items=>items.map(i=>i.checked));
 await picker.getByRole('checkbox',{name:'second',exact:true}).uncheck();await picker.getByRole('checkbox',{name:'third',exact:true}).uncheck();
 // The existing rendered chart is untouched while staging selections.
 await expect(chart.locator('.mark-line path')).toHaveCount(3);
 await picker.getByRole('button',{name:'Cancel',exact:true}).click();await picker.locator('summary').click();
 expect(await picker.getByRole('checkbox').evaluateAll(items=>items.map(i=>i.checked))).toEqual(before);
 for(const box of await picker.getByRole('checkbox').all())await box.uncheck();await expect(picker.getByRole('button',{name:'Apply',exact:true})).toBeDisabled();
 await picker.getByRole('checkbox',{name:'second',exact:true}).check();await picker.getByRole('button',{name:'Apply',exact:true}).click();
 await expect(chart.locator('.mark-line path')).toHaveCount(1);await expect(picker.locator('summary')).toContainText('second');
 await picker.locator('summary').click();await picker.getByRole('checkbox',{name:'third',exact:true}).check();await page.keyboard.press('Escape');
 await picker.locator('summary').click();await expect(picker.getByRole('checkbox',{name:'third',exact:true})).not.toBeChecked();
});
