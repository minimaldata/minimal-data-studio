import {test,expect,open} from './fixtures.mjs';
test('Supabase setup stores only metadata and a credential reference',async({page,studio})=>{
 await open(page,studio.url);
 await page.route('**/remote/credentials',route=>route.fulfill({json:{available:true,credentials:[{id:'dummy-key',name:'Supabase database password'}]}}));
  await page.getByRole('button',{name:'Add connection',exact:true}).click();
 await page.getByRole('button',{name:'Connect Supabase',exact:true}).click();
 const d=page.locator('dialog[open]');await expect(d).toContainText('Session pooler');await expect(d.getByLabel('Local Postgres service profile')).toHaveCount(0);
 await d.getByLabel('Connection name').fill('Research Supabase');await d.getByLabel('Database host').fill('aws-0-us-east-1.pooler.supabase.com');await d.getByLabel('Database username').fill('reader.example');await d.getByRole('button',{name:/Step 2: Database password/}).click();await d.getByLabel('Database password in Keychain').selectOption('dummy-key');
 let config;await page.route('**/remote/connection-save',async route=>{config=route.request().postDataJSON().connection;await route.continue();});
 await d.getByRole('button',{name:/Step 4: Review/}).click();await d.getByRole('button',{name:'Save connection',exact:true}).click();await expect(d).toHaveCount(0);
 expect(config.provider).toBe('postgres');expect(config.preset).toBe('supabase');expect(config.port).toBe(5432);expect(config.credentialId).toBe('dummy-key');expect(config.password).toBeUndefined();
 await expect(page.locator('.remote-connection[data-provider="postgres"]')).toHaveCount(0);
 await page.getByRole('button',{name:'SQL connection',exact:true}).click();await expect(page.getByRole('option',{name:'Supabase · Research Supabase',exact:true})).toBeVisible();await page.keyboard.press('Escape');
 await expect(page.locator('#externalConnections')).toContainText('Research Supabase');await page.reload();await expect(page.locator('#externalConnections')).toContainText('Supabase · postgres');
});

test('empty external databases has one chooser and no provider sections',async({page,studio})=>{
 await open(page,studio.url);
 const group=page.locator('#externalDatabases');
 await expect(group.locator('.panel')).toHaveCount(0);
 await expect(group.getByRole('button',{name:'Add connection',exact:true})).toHaveCount(1);
 await group.getByRole('button',{name:'Add connection',exact:true}).click();
 await expect(group).toHaveAttribute('open','');
 const dialog=page.locator('dialog[open]');
 for(const name of ['BigQuery','Snowflake','Postgres','Supabase'])await expect(dialog.getByRole('button',{name:'Connect '+name,exact:true})).toBeVisible();
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(dialog).toHaveCount(0);
 await expect(group.locator('.remote-connection')).toHaveCount(0);
});

test('certificate picker keeps the selected path and explains TLS requirements',async({page,studio})=>{
 await open(page,studio.url);
 await page.route('**/remote/credentials',route=>route.fulfill({json:{available:true,credentials:[{id:'dummy-key',name:'Password'}]}}));
 let uploaded;await page.route('**/remote/import-certificate',async route=>{uploaded=route.request().postDataJSON().certificate;await route.fulfill({json:{path:'/tmp/managed-ca.pem'}});});
 await page.getByRole('button',{name:'Add connection',exact:true}).click();await page.getByRole('button',{name:'Connect Supabase',exact:true}).click();
 const d=page.locator('dialog[open]');await expect(d.locator('.supabase-certificate')).toContainText('Enforce SSL');
 await d.getByLabel('Connection name').fill('Certificate test');await d.getByLabel('Database host').fill('aws-0-us-west-2.pooler.supabase.com');await d.getByLabel('Database username').fill('reader.project');await d.getByRole('button',{name:/Step 2: Database password/}).click();await d.getByLabel('Database password in Keychain').selectOption('dummy-key');
 await d.getByRole('button',{name:/Step 3: Server certificate/}).click();const chooserEvent=page.waitForEvent('filechooser');await d.getByRole('button',{name:'Choose certificate…'}).click();const chooser=await chooserEvent;
 await chooser.setFiles({name:'downloaded-ca.crt',mimeType:'application/x-pem-file',buffer:Buffer.from('synthetic public certificate')});
 await expect(d.locator('.supabase-certificate')).toContainText('downloaded-ca.crt · saved on this Mac');expect(uploaded).toBe('synthetic public certificate');
 let saved;await page.route('**/remote/connection-save',async route=>{saved=route.request().postDataJSON().connection;await route.continue();});await d.getByRole('button',{name:/Step 4: Review/}).click();await d.getByRole('button',{name:'Save connection',exact:true}).click();await expect(d).toHaveCount(0);expect(saved.sslrootcert).toBe('/tmp/managed-ca.pem');
});
