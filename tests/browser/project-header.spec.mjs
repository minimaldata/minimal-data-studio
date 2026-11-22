import {test,expect,open} from './fixtures.mjs';

test('compact browser project menu keeps actions accessible and dismisses cleanly',async({page,studio})=>{
  await open(page,studio.url);
  await expect(page.locator('#projectName')).toHaveText('project');
  await expect(page.locator('#openProjectBtn')).toBeHidden();
  // A native details summary is keyboard-operable in both supported browsers.
  await page.locator('#projectMenu summary').click();
  await expect(page.locator('#openProjectBtn')).toBeVisible();
  await page.locator('#projectLocation').click();
  await expect(page.locator('#projectMenu')).not.toHaveAttribute('open','');
  await expect(page.locator('#locationDialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('#projectMenu summary').click();await page.keyboard.press('Escape');
  await expect(page.locator('#openProjectBtn')).toBeHidden();
  await expect(page.locator('#projectMenu summary')).toBeFocused();
  await page.keyboard.press('Enter');await page.locator('#themeBtn').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme',/light|dark/);
  await expect(page.locator('#openProjectBtn')).toBeHidden();
});

test('native shell hides redundant header and accepts appearance actions',async({page,studio})=>{
  await page.addInitScript(()=>{window.webkit={messageHandlers:{studioProject:{postMessage(){}}}};});
  await open(page,studio.url);
  await expect(page.locator('#projectBar')).toBeHidden();
  await expect(page.getByRole('button',{name:'Bring files into project',exact:true})).toBeVisible();
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('studio-appearance',{detail:'dark'})));
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('studio-appearance',{detail:'system'})));
  await expect(page.locator('html')).not.toHaveAttribute('data-theme');
});
