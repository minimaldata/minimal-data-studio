import {test,expect,open,edit} from './fixtures.mjs';
test('managed references autocomplete, compile, track dependencies and survive reload',async({page,studio})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await open(page,studio.url);
  await page.getByRole('button',{name:'Connect BigQuery',exact:true}).click();
  const dialog=page.locator('dialog[open]');
  await dialog.getByLabel('Connection name').fill('Reference warehouse');
  await dialog.getByLabel('Google Cloud project ID').fill('example-project');
  await dialog.getByRole('button',{name:'Save connection',exact:true}).click();
  await page.locator('.remote-connection > summary').click();
  async function newModel(name,table){
    await page.getByRole('button',{name:'New query',exact:true}).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('#editorWrap .CodeMirror-code')).not.toContainText('SELECT');
    await edit(page,'SELECT 1 AS initial_value');
    await page.getByRole('button',{name:'Save as model…',exact:true}).click();
    await dialog.getByLabel('Model name').fill(name);
    await dialog.getByLabel('Destination dataset').fill('sandbox');
    await dialog.getByLabel('Destination name').fill(table);
    await dialog.getByRole('button',{name:'Save draft',exact:true}).click();
    await expect(dialog).toHaveCount(0);
  }
  await newModel('Monthly costs','costs');
  await edit(page,'SELECT 42 AS cost');
  await page.locator('.remote-model-bar').getByRole('button',{name:'Save draft',exact:true}).click();
  await newModel('Cost summary','summary');
  await edit(page,'SELECT * FROM ');
  await page.keyboard.type('{{');
  await expect(page.locator('.CodeMirror-hints')).toContainText('costs · Monthly costs');
  await page.keyboard.press('Enter');
  await expect(page.locator('#editorWrap .CodeMirror-code')).toContainText('{{ costs }}');
  await page.locator('#formatBtn').click();
  await expect(page.locator('#results')).not.toContainText('Format failed');
  await expect(page.locator('#editorWrap .CodeMirror-code')).toContainText('{{ costs }}');
  await page.getByRole('button',{name:'Compiled SQL & dependencies',exact:true}).click();
  await expect(dialog).toContainText('Publish costs first');
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  const saved=page.waitForResponse(r=>r.url().endsWith('/remote/model-save'));
  await page.locator('.remote-model-bar').getByRole('button',{name:'Save draft',exact:true}).click();await saved;
  // Seed only disposable local metadata, simulating a successful warehouse publication.
  // The compiler itself runs against the real service; no Google credentials are used.
  const state=await (await page.request.post(studio.url+'/remote/models',{headers:{Origin:studio.url},data:{}})).json();
  const upstream=state.models.find(m=>m.reference==='costs');
  upstream.published={...upstream.draft,jobId:'fake-publish',etag:'fake-etag',at:'2026-11-13T12:00:00Z'};
  await studio.writeScript('.studio/bigquery-models.json',JSON.stringify(state));
  const url=await studio.restart();await open(page,url);
  await page.getByRole('button',{name:'Compiled SQL & dependencies',exact:true}).click();
  await expect(dialog).toContainText('`example-project.sandbox.costs`');
  await expect(dialog).toContainText('Uses published models');
  await expect(dialog).toContainText('costs → example-project.sandbox.costs');
  await page.screenshot({path:'/tmp/mds-managed-reference-preview.png',fullPage:true});
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  // Pasting a reference must not trigger unsolicited autocomplete.
  await edit(page,'SELECT cost FROM {{ costs }};');
  await expect(page.locator('.CodeMirror-hints')).toHaveCount(0);
  await edit(page,'-- comment ');await page.keyboard.type('{{');
  await expect(page.locator('.CodeMirror-hints')).toHaveCount(0);
  expect(errors).toEqual([]);
});
