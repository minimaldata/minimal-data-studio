import {test,expect,open} from './fixtures.mjs';
import {readFile} from 'node:fs/promises';
const root=new URL('../../examples/interactive/mdm-executive-dashboard/',import.meta.url);
test('executive dashboard saves local controls and notes without querying on interaction',async({page,studio})=>{
 for(const file of ['app.json','index.html','styles.css','dashboard.js','queries/monthly.sql','queries/bridge.sql','queries/mix.sql'])await studio.writeScript('interactive/executive/'+file,await readFile(new URL(file,root),'utf8'));
 const monthly=['2025-01-31','2025-02-28','2025-03-31'].map((month_end,i)=>({month_end,mrr_usd:1000*(i+1),arr_usd:12000*(i+1),active_accounts:10*(i+1),nrr_12m_pct:null,total_cash_collected_usd:2000*(i+1)}));
 await studio.writeScript('.studio/interactive-documents.json',JSON.stringify({format:1,revision:0,documents:[{id:'executive',name:'MDM executive dashboard',folder:'interactive/executive',inputs:{monthly,bridge:[],mix:[]},state:{}}]}));
 await open(page,studio.url);await page.locator('#explorerAnalysesTab').click();await page.getByRole('button',{name:'MDM executive dashboard',exact:true}).click();
 const frame=page.frameLocator('#interactiveDocument iframe');await expect(frame.locator('#kpis')).toContainText('$3,000');await expect(frame.locator('#kpis')).toContainText('—');
 const queries=[];page.on('request',r=>{if(/interactive-inputs\/refresh|db\/query/.test(r.url()))queries.push(r.url());});
 await frame.locator('#timeline').fill('1');await expect(frame.locator('#month')).toHaveValue('2025-02-28');await expect(frame.locator('#kpis')).toContainText('$2,000');
 await frame.locator('#window').selectOption('6');await frame.locator('#metric').selectOption('active_accounts');await frame.locator('#notes').fill('Review retention with the customer team.');
 await page.locator('[data-action=save]').click();await expect(page.locator('.interactive-status')).toHaveText('Saved');expect(queries).toEqual([]);
 await page.reload();await expect(page.locator('#status')).toContainText('Ready');await page.locator('#explorerAnalysesTab').click();await page.getByRole('button',{name:'MDM executive dashboard',exact:true}).click();
 await expect(frame.locator('#month')).toHaveValue('2025-02-28');await expect(frame.locator('#window')).toHaveValue('6');await expect(frame.locator('#metric')).toHaveValue('active_accounts');await expect(frame.locator('#notes')).toHaveValue('Review retention with the customer team.');await expect(frame.locator('#kpis')).toContainText('$2,000');
 await page.screenshot({path:'/tmp/mds-executive-test.png',fullPage:true});
});
