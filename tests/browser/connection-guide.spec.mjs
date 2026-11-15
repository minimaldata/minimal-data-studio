import {test,expect,open} from './fixtures.mjs';
test('each connector has collapsible setup instructions and an official link',async({page,studio})=>{
 await open(page,studio.url);
 for(const [name,text] of [['BigQuery','1 GB'],['Snowflake','authenticator push'],['Postgres','chmod 600'],['Supabase','Session pooler']]){
  await page.getByRole('button',{name:'Add connection',exact:true}).click();await page.getByRole('button',{name:'Connect '+name,exact:true}).click();
  const d=page.locator('dialog[open]'),guide=d.locator('.connection-guide');
  await expect(guide).toHaveAttribute('open','');await expect(guide.locator('li')).toHaveCount(4);await expect(guide).toContainText(text);await expect(guide.locator('a').first()).toHaveAttribute('href',/^https:\/\//);
  await guide.locator('summary').click();await expect(guide.locator('ol')).toBeHidden();await d.getByRole('button',{name:'Cancel',exact:true}).click();
 }
});
