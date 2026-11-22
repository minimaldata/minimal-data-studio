import {test,expect,open} from './fixtures.mjs';
test('each connector provides directions in every setup step',async({page,studio})=>{
 await open(page,studio.url);
 for(const name of ['BigQuery','Snowflake','Postgres','Supabase']){
  await page.getByRole('button',{name:'Add connection',exact:true}).click();await page.getByRole('button',{name:'Connect '+name,exact:true}).click();
  const dialog=page.locator('dialog[open]'),steps=dialog.locator('.setup-progress').first().getByRole('button');
  await expect(steps).toHaveCount(name==='Postgres'?5:4);
  for(let i=0;i<await steps.count();i++){
   await steps.nth(i).click();const panel=dialog.locator('.postgres-setup > section:visible');await expect(panel).toHaveCount(1);await expect(panel.locator('p').first()).not.toBeEmpty();await expect(steps.nth(i)).toHaveAttribute('aria-current','step');
  }
  await expect(dialog.getByRole('button',{name:'Save connection',exact:true})).toBeDisabled();await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
 }
});
