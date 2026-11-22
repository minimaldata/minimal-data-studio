import {test,expect,open} from './fixtures.mjs';
for(const provider of ['BigQuery','Snowflake','Supabase'])test(`${provider} guides fields, permits incomplete navigation and blocks saving`,async({page,studio})=>{
 await open(page,studio.url);let writes=0;let saved;
 await page.route('**/remote/credentials',r=>r.fulfill({json:{available:true,credentials:[{id:'dummy',name:'Database password'}]}}));
 await studio.writeGoogleProfile('a'.repeat(32),'Work','test@example.com');
 await page.route('**/remote/connection-save',async r=>{writes++;saved=r.request().postDataJSON().connection;await r.continue();});
 await page.getByRole('button',{name:'Add connection',exact:true}).click();await page.getByRole('button',{name:`Connect ${provider}`,exact:true}).click();
 const d=page.locator('dialog[open]'),step=n=>d.locator('.setup-progress button').nth(n-1);
 await d.getByRole('button',{name:'Next',exact:true}).click();await expect(d).toContainText('Step 2 of 4');
 await expect(d.getByLabel('Connection name')).toBeHidden();
 await step(4).click();await expect(d.getByRole('button',{name:'Save connection',exact:true})).toBeDisabled();await expect(step(1)).toHaveAttribute('data-invalid','true');
 await d.locator('form').evaluate(form=>form.requestSubmit());expect(writes).toBe(0);
 await step(1).click();await expect(d.getByLabel('Connection name')).toHaveAttribute('aria-invalid','true');await d.getByLabel('Connection name').fill('Guided '+provider);
 const fields=provider==='BigQuery'?{'Google Cloud project ID':'example-project'}:provider==='Snowflake'?{'Account identifier':'org-account','User':'reader'}:{'Database host':'aws-0-us-west-2.pooler.supabase.com','Database username':'reader.project'};
 for(const [label,value] of Object.entries(fields))await d.getByLabel(label,{exact:true}).fill(value);
 await expect(step(1)).toHaveAttribute('data-invalid','false');
 await step(2).click();
 if(provider==='Snowflake'){
  await d.getByLabel('Sign-in method').selectOption('password_mfa');await step(4).click();await expect(step(2)).toHaveAttribute('data-invalid','true');
  await step(2).click();await d.getByLabel('Keychain password').selectOption('dummy');
 }else if(provider==='Supabase')await d.getByLabel('Database password in Keychain').selectOption('dummy');
 else {await d.getByRole('button',{name:'Google authentication profile',exact:true}).click();await page.getByRole('option',{name:'Work · test@example.com',exact:true}).click();}
 await step(3).click();
 if(provider==='Snowflake')for(const [label,value] of Object.entries({'Read-only role':'READER','Warehouse':'WH','Database':'DB'}))await d.getByLabel(label,{exact:true}).fill(value);
 if(provider==='BigQuery'){
  await d.getByLabel('Maximum bytes billed per query').fill('0');await step(4).click();await expect(step(3)).toHaveAttribute('data-invalid','true');await expect(d.getByRole('button',{name:'Save connection',exact:true})).toBeDisabled();await step(3).click();await d.getByLabel('Maximum bytes billed per query').fill('1000000000');
 }
 await step(4).click();await expect(d.getByRole('button',{name:'Save connection',exact:true})).toBeEnabled();await expect(d.locator('.connection-review')).toContainText('Guided '+provider);
 if(test.info().project.name==='chromium'){await page.screenshot({path:`/tmp/mds-${provider.toLowerCase()}-wizard.png`});await page.setViewportSize({width:390,height:844});expect(await d.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);}
 await d.getByRole('button',{name:'Save connection',exact:true}).click();await expect(d).toHaveCount(0);expect(writes).toBe(1);
 expect(saved.password).toBeUndefined();if(provider==='BigQuery')expect(saved.authProfile).toBe('a'.repeat(32));else expect(saved.credentialId).toBe('dummy');
});
