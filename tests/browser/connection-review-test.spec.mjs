import {test,expect,open} from './fixtures.mjs';
import {connectionField,reviewConnection} from './connection-helpers.mjs';
for(const provider of ['BigQuery','Snowflake','Supabase','Postgres'])test(`${provider} review tests without saving and invalidates stale success`,async({page,studio})=>{
 await open(page,studio.url);let saves=0,attempts=0,submitted,release;
 await page.route('**/remote/credentials',r=>r.fulfill({json:{available:true,credentials:[{id:'dummy',name:'Password'}]}}));
 page.on('request',r=>{if(r.url().includes('/remote/connection-save'))saves++;});
 await page.route('**/remote/connection-draft-test-status',r=>r.fulfill({json:{phase:'credentials'}}));
 await page.route('**/remote/connection-draft-test',async r=>{attempts++;submitted=r.request().postDataJSON();if(attempts===1){await new Promise(resolve=>release=resolve);await r.fulfill({json:{phase:'connected',message:'Connected · browsing access verified. Nothing saved.'}});}else await r.fulfill({status:400,json:{error:'Synthetic authentication failure'}});});
 await page.getByRole('button',{name:'Add connection',exact:true}).click();await page.getByRole('button',{name:'Connect '+provider,exact:true}).click();const d=page.locator('dialog[open]');
 await d.getByLabel('Connection name').waitFor();await reviewConnection(d);await expect(d.getByRole('button',{name:'Test connection',exact:true})).toBeDisabled();
 await d.locator('.setup-progress button').first().click();await d.getByLabel('Connection name').fill('Test '+provider);
 const fields=provider==='BigQuery'?{'Google Cloud project ID':'example-project'}:provider==='Snowflake'?{'Account identifier':'org-account','User':'reader','Read-only role':'READER','Warehouse':'WH','Database':'DB'}:{'Database host':provider==='Supabase'?'aws-0-us-west-2.pooler.supabase.com':'db.example.com','Database username':'reader'};
 for(const [label,value] of Object.entries(fields))await connectionField(d,label,value);
 if(provider==='Supabase'||provider==='Postgres'){await d.locator('.setup-progress button').nth(1).click();await d.getByLabel('Database password in Keychain').selectOption('dummy');}
 await reviewConnection(d);await d.getByRole('button',{name:'Test connection',exact:true}).click();
 await expect(d).toContainText('Check the Mac app for credential approval');await expect(d.getByRole('button',{name:'Save connection',exact:true})).toBeDisabled();expect(saves).toBe(0);expect(submitted.connection.password).toBeUndefined();
 release();await expect(d).toContainText('Nothing saved.');await expect(d.getByRole('button',{name:'Save connection',exact:true})).toBeEnabled();expect(saves).toBe(0);
 if(provider==='Postgres'){
  let imported;await page.route('**/remote/import-certificate',async r=>{await new Promise(resolve=>imported=resolve);await r.fulfill({json:{path:'/tmp/new-ca.pem'}});});
  await d.getByRole('button',{name:/Step 4: Server certificate/}).click();
  await d.getByLabel('Choose CA certificate file').setInputFiles({name:'test.crt',mimeType:'text/plain',buffer:Buffer.from('synthetic public certificate')});
  await reviewConnection(d);await expect(d.getByRole('button',{name:'Save connection',exact:true})).toBeDisabled();
  await expect.poll(()=>Boolean(imported)).toBe(true);imported();
  await expect(d.getByRole('button',{name:'Save connection',exact:true})).toBeEnabled();
  await expect(d).toContainText('Settings changed — test again.');await expect(d.locator('.connection-review')).toContainText('/tmp/new-ca.pem');
 }
 await d.locator('.setup-progress button').first().click();await d.getByLabel('Connection name').fill('Changed name');await reviewConnection(d);await expect(d).toContainText('Settings changed — test again.');
 await d.getByRole('button',{name:'Test connection',exact:true}).click();await expect(d).toContainText('Synthetic authentication failure');await expect(d.getByRole('button',{name:'Test connection',exact:true})).toBeEnabled();expect(saves).toBe(0);
 await d.getByRole('button',{name:'Cancel',exact:true}).click();
});

test('late polling cannot overwrite another run and closing cleans up polling',async({page,studio})=>{
 await open(page,studio.url);
 await page.evaluate(async()=>{
  const {mountConnectionReviewTest}=await import('/frontend/connection-review-test.mjs');
  const dialog=document.createElement('dialog'),form=document.createElement('form'),panel=document.createElement('section'),save=document.createElement('button');
  save.textContent='Save';form.append(panel,save);dialog.append(form);document.body.append(dialog);
  window.testRuns=[];window.testPolls=[];
  mountConnectionReviewTest({dialog,form,panel,save,collect:()=>({name:'Fixture'}),onBusy:b=>save.disabled=b,request:action=>new Promise(resolve=>(action.endsWith('-status')?window.testPolls:window.testRuns).push(resolve))});
  window.closeFixture=()=>dialog.close();dialog.showModal();
 });
 const testButton=page.getByRole('button',{name:'Test connection',exact:true});
 await testButton.click();await expect.poll(()=>page.evaluate(()=>window.testPolls.length)).toBe(1);
 await page.evaluate(()=>window.testRuns[0]({message:'First test complete'}));await expect(page.getByRole('status').filter({hasText:'First test complete'})).toBeVisible();
 await testButton.click();await page.evaluate(()=>window.testPolls[0]({phase:'mfa_push'}));
 await expect(page.locator('dialog .remote-status')).toHaveText('Connecting…');
 await page.evaluate(()=>window.testRuns[1]({message:'Second test complete'}));await expect(page.locator('dialog .remote-status')).toHaveText('Second test complete');
 await testButton.click();await page.evaluate(()=>window.closeFixture());
 await page.evaluate(()=>window.testRuns[2]({message:'Should not render'}));
 await expect(page.locator('dialog .remote-status')).not.toHaveText('Should not render');
});
