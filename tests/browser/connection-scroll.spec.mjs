import {test,expect,open} from './fixtures.mjs';
for(const provider of ['Postgres','Snowflake'])test(`${provider} setup clips scroll content above a separate footer`,async({page,studio})=>{
 await page.setViewportSize({width:720,height:580});await open(page,studio.url);
 await page.getByRole('button',{name:'Add connection',exact:true}).click();await page.getByRole('button',{name:'Connect '+provider,exact:true}).click();
 const d=page.locator('dialog[open]');await d.getByLabel('Connection name').waitFor();await d.getByRole('button',{name:/^Step \d+: Review$/}).click();
 const body=d.locator('.setup-scroll'),footer=d.locator('.setup-footer');
 await body.evaluate(el=>el.scrollTop=el.scrollHeight/2);
 const check=async()=>{
  const b=await body.boundingBox(),f=await footer.boundingBox();expect(b.y+b.height).toBeLessThanOrEqual(f.y+1);
  await expect(footer).toBeVisible();await expect(d.getByRole('button',{name:'Save connection',exact:true})).toBeInViewport();
 };
 await check();await d.getByRole('button',{name:'Test connection',exact:true}).scrollIntoViewIfNeeded();await expect(d.getByRole('button',{name:'Test connection',exact:true})).toBeInViewport();await check();
 if(test.info().project.name==='chromium')await page.screenshot({path:`/tmp/mds-${provider.toLowerCase()}-scroll-fixed.png`});
 await d.getByRole('button',{name:'Cancel',exact:true}).click();
});
