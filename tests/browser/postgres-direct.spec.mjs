import {test,expect,open} from './fixtures.mjs';
test('Postgres defaults to direct fields and saves a Keychain reference',async({page,studio})=>{
 await open(page,studio.url);
 await page.route('**/remote/credentials',route=>route.fulfill({json:{available:true,credentials:[{id:'dummy-key',name:'Postgres password'}]}}));
 await page.getByRole('button',{name:'Add connection',exact:true}).click();await page.getByRole('button',{name:'Connect Postgres',exact:true}).click();
 const dialog=page.locator('dialog[open]');await expect(dialog).toContainText('Where are your connection details?');await expect(dialog.getByLabel('Local Postgres service profile')).toBeHidden();
 await dialog.getByLabel('Connection name').fill('Research');await dialog.getByLabel('Database host').fill('db.example.com');await dialog.getByLabel('Port',{exact:true}).fill('5433');await dialog.getByLabel('Database',{exact:true}).fill('analytics');await dialog.getByLabel('Database username').fill('reader');await expect(dialog.getByRole('button',{name:'Save connection',exact:true})).toBeHidden();await dialog.getByRole('button',{name:'Next',exact:true}).click();await dialog.getByLabel('Database password in Keychain').selectOption('dummy-key');
 await dialog.getByRole('button',{name:'Next',exact:true}).click();await dialog.getByRole('button',{name:'Next',exact:true}).click();await dialog.getByRole('button',{name:'Next',exact:true}).click();
 await expect(dialog.locator('.connection-review')).toContainText('db.example.com:5433 / analytics');
 if(test.info().project.name==='chromium')await page.screenshot({path:'/tmp/mds-postgres-setup-review.png'});
 await dialog.getByRole('button',{name:'Back',exact:true}).click();await expect(dialog.getByRole('button',{name:'Save connection',exact:true})).toBeHidden();await dialog.getByRole('button',{name:'Next',exact:true}).click();
 let config;await page.route('**/remote/connection-save',async route=>{config=route.request().postDataJSON().connection;await route.continue();});
 await dialog.getByRole('button',{name:'Save connection',exact:true}).click();await expect(dialog).toHaveCount(0);
 expect(config).toMatchObject({preset:'direct',host:'db.example.com',port:5433,database:'analytics',user:'reader',credentialId:'dummy-key'});expect(config.password).toBeUndefined();expect(config.service).toBeUndefined();
 await expect(page.locator('#externalConnections')).toContainText('db.example.com · analytics');
});

test('SSH setup selects a local key path and credential ID without uploading secrets',async({page,studio})=>{
 await open(page,studio.url);
 await page.route('**/remote/credentials',route=>route.fulfill({json:{available:true,credentials:[{id:'dummy-key',name:'Database password'},{id:'dummy-phrase',name:'SSH passphrase'}]}}));
 let managed=false;await page.route('**/remote/manage-credentials',r=>{managed=true;return r.fulfill({json:{opened:true}});});
 await page.route('**/remote/choose-ssh-key',route=>route.fulfill({json:{path:'/tmp/.ssh/id_ed25519'}}));
 await page.getByRole('button',{name:'Add connection',exact:true}).click();await page.getByRole('button',{name:'Connect Postgres',exact:true}).click();
 const d=page.locator('dialog[open]');await d.getByLabel('Connection name').fill('RDS through EC2');await d.getByLabel('Database host').fill('db.example.com');await d.getByLabel('Database username').fill('fuel');await d.getByRole('button',{name:'Next',exact:true}).click();await d.getByLabel('Database password in Keychain').selectOption('dummy-key');
 await d.getByRole('button',{name:'Next',exact:true}).click();await d.getByLabel('Connect through an SSH server').check();
 await d.getByRole('button',{name:'Manage credentials…',exact:true}).click();expect(managed).toBe(true);await expect(d).toContainText('Save the SSH key’s passphrase in the Mac app');await d.getByRole('button',{name:'Refresh passphrases',exact:true}).click();
 await d.getByLabel('SSH host',{exact:true}).fill('jump.example.com');await d.getByLabel('SSH username',{exact:true}).fill('ec2-user');
 await d.getByRole('button',{name:'Choose private key…'}).click();await expect(d).toContainText('/tmp/.ssh/id_ed25519');await d.getByLabel('SSH key passphrase in Credentials').selectOption('dummy-phrase');
 await d.getByRole('button',{name:'Next',exact:true}).click();await d.getByRole('button',{name:'Next',exact:true}).click();await expect(d.locator('.connection-review')).toContainText('ec2-user@jump.example.com:22');
 let config;await page.route('**/remote/connection-save',async route=>{config=route.request().postDataJSON().connection;await route.continue();});
 await d.getByRole('button',{name:'Save connection',exact:true}).click();await expect(d).toHaveCount(0);
 expect(config).toMatchObject({sshHost:'jump.example.com',sshPort:22,sshUser:'ec2-user',sshKeyPath:'/tmp/.ssh/id_ed25519',sshPassphraseId:'dummy-phrase',host:'db.example.com'});
 expect(config.password).toBeUndefined();expect(config.sshPassphrase).toBeUndefined();
});


test('setup allows incomplete steps but blocks saving and marks missing fields',async({page,studio})=>{
 await open(page,studio.url);let writes=0;page.on('request',request=>{if(request.url().includes('/remote/connection-save'))writes++;});
 await page.route('**/remote/credentials',r=>r.fulfill({json:{available:true,credentials:[{id:'dummy',name:'Database password'}]}}));
 await page.getByRole('button',{name:'Add connection',exact:true}).click();await page.getByRole('button',{name:'Connect Postgres',exact:true}).click();const d=page.locator('dialog[open]');
 await d.getByRole('button',{name:'Next',exact:true}).click();await expect(d).toContainText('Step 2 of 5');
 await expect(d.getByLabel('Connection name')).toHaveAttribute('aria-invalid','true');
 await d.getByRole('button',{name:/Step 5: Review/}).click();await expect(d).toContainText('Before saving, complete: Database, Database password.');
 await expect(d.getByRole('button',{name:'Save connection',exact:true})).toBeDisabled();expect(writes).toBe(0);
 await d.getByRole('button',{name:/Step 1: Database/}).click();await d.getByLabel('Connection name').fill('Incomplete');await d.getByLabel('Database host').fill('db.example.com');await d.getByLabel('Database username').fill('reader');
 await expect(d.getByLabel('Database host')).not.toHaveAttribute('aria-invalid','true');
 await d.getByRole('button',{name:/Step 2: Database password/}).click();await d.getByLabel('Database password in Keychain').selectOption('dummy');
 await d.getByRole('button',{name:/Step 3: SSH tunnel/}).click();await d.getByLabel('Connect through an SSH server').check();
 await d.getByRole('button',{name:/Step 5: Review/}).click();await expect(d).toContainText('Before saving, complete: SSH tunnel.');await expect(d.getByRole('button',{name:'Save connection',exact:true})).toBeDisabled();
 await d.getByRole('button',{name:/Step 3: SSH tunnel/}).click();await d.getByLabel('Connect through an SSH server').uncheck();
 await d.getByRole('button',{name:/Step 5: Review/}).click();await expect(d.getByRole('button',{name:'Save connection',exact:true})).toBeEnabled();
 await d.getByRole('button',{name:'Cancel',exact:true}).click();expect(writes).toBe(0);
});

test('advanced service profiles remain available without completing direct setup',async({page,studio})=>{
 await open(page,studio.url);await page.getByRole('button',{name:'Add connection',exact:true}).click();await page.getByRole('button',{name:'Connect Postgres',exact:true}).click();const d=page.locator('dialog[open]');
 await d.getByLabel('Connection name').fill('Existing service');await d.locator('summary').filter({hasText:'Advanced · service profile'}).click();await d.getByLabel('Use a local service profile').check();await d.getByLabel('Local Postgres service profile').fill('studio_reader');
 let config;await page.route('**/remote/connection-save',async route=>{config=route.request().postDataJSON().connection;await route.continue();});await d.getByRole('button',{name:'Save connection',exact:true}).click();await expect(d).toHaveCount(0);expect(config.service).toBe('studio_reader');expect(config.host).toBeUndefined();
});


test('guidance switches independently without changing connection values',async({page,studio})=>{
 await open(page,studio.url);await page.route('**/remote/credentials',r=>r.fulfill({json:{available:true,credentials:[{id:'dummy',name:'Password'}]}}));
 await page.getByRole('button',{name:'Add connection',exact:true}).click();await page.getByRole('button',{name:'Connect Postgres',exact:true}).click();const d=page.locator('dialog[open]');
 await d.getByLabel('Connection name').fill('Keep my values');await d.getByLabel('Database host').fill('keep.example.com');await d.getByLabel('Database username').fill('reader');
 await d.getByLabel('Database tool',{exact:true}).selectOption('dbeaver');await d.getByLabel('Hosting provider',{exact:true}).selectOption('aws');
 const panel=d.getByRole('region',{name:'Database setup'});await expect(panel).toContainText('Edit Connection');await expect(panel).toContainText('Connectivity & security');
 await d.getByRole('button',{name:'Next',exact:true}).click();await d.getByLabel('Database password in Keychain').selectOption('dummy');await d.getByRole('button',{name:'Next',exact:true}).click();
 await expect(d.getByRole('region',{name:'SSH tunnel setup'})).toContainText('EC2');await d.getByLabel('Hosting provider',{exact:true}).selectOption('google');await expect(d.getByRole('region',{name:'SSH tunnel setup'})).toContainText('does not start the Cloud SQL Auth Proxy');
 await d.getByRole('button',{name:'Back',exact:true}).click();await expect(d.getByLabel('Database password in Keychain')).toHaveValue('dummy');await d.getByRole('button',{name:'Back',exact:true}).click();
 for(const tool of ['pgadmin','datagrip',''])await d.getByLabel('Database tool',{exact:true}).selectOption(tool);
 await d.getByLabel('Hosting provider',{exact:true}).selectOption('azure');await expect(panel).toContainText('Azure');await expect(d.getByLabel('Database host')).toHaveValue('keep.example.com');await expect(d.getByLabel('Database username')).toHaveValue('reader');
 await d.getByLabel('Hosting provider',{exact:true}).selectOption('');await expect(panel).not.toContainText('pgAdmin');await expect(panel).not.toContainText('AWS');
});
