import {test,expect,open,edit} from './fixtures.mjs';
test('logo accompanies query loading and clears on success and error',async({page,studio})=>{
  await open(page,studio.url);await edit(page,'SELECT 42 AS answer;');
  for(const fail of [false,true]){
    let release;const gate=new Promise(resolve=>release=resolve);
    await page.route('**/db/query?*',async route=>{await gate;if(fail)await route.fulfill({status:400,json:{error:'Synthetic query failure'}});else await route.continue();});
    await page.locator('#runBtn').click();
    const status=page.locator('#meta');await expect(status).toHaveClass(/studio-loading/);await expect(status).toHaveAttribute('aria-busy','true');await expect(status).toHaveText('Running…');
    expect(await status.evaluate(el=>getComputedStyle(el,'::before').backgroundImage)).toContain('studio-loading.svg');
    if(!fail){
      await page.locator('#themeBtn').click();await page.screenshot({path:'/tmp/mds-query-loading.png'});
      expect(await status.evaluate(el=>getComputedStyle(el,'::before').filter)).toContain('invert(1)');
    }
    release();await expect(status).not.toHaveClass(/studio-loading/);await expect(status).toHaveAttribute('aria-busy','false');
    await expect(page.locator('#runBtn')).toBeEnabled();
    await page.unroute('**/db/query?*');
    await expect(page.locator('#results')).toContainText(fail?'Synthetic query failure':'42');
  }
  // External SVG images honor the same reduced-motion preference as the UI.
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto(studio.url+'/assets/studio-loading.svg');
  await expect(page.locator('.loader-motion')).toBeHidden();await expect(page.locator('.loader-static')).toBeVisible();
});
