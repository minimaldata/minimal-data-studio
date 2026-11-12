import {test as base, expect} from '@playwright/test';
import {mkdtemp, mkdir, rm, writeFile, readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
const root=resolve(import.meta.dirname,'../..');
export const test=base.extend({
  studio: async ({},use) => {
    const directory=await mkdtemp(join(tmpdir(),'mds-browser-'));
    const project=join(directory,'project'); await mkdir(project);
    let processHandle;
    async function stop() {
      if (!processHandle || processHandle.exitCode !== null) return;
      const child=processHandle;
      await new Promise(resolve=>{
        const timer=setTimeout(()=>child.kill('SIGKILL'),5000);
        child.once('exit',()=>{clearTimeout(timer);resolve();});child.kill('SIGTERM');
      });
    }
    async function start() {
      const python=process.env.MDS_TEST_PYTHON || (existsSync(join(root,'.venv/bin/python'))?join(root,'.venv/bin/python'):'python3');
      processHandle=spawn(python,['-u','serve.py','--project-dir',project,'--port','0'],{
        cwd:root,env:{...process.env,MDS_PROJECT_REGISTRY:join(directory,'registry.json')},stdio:['ignore','pipe','pipe']
      });
      return await new Promise((resolve,reject)=>{
        let output='';const timer=setTimeout(()=>reject(Error('Server startup timed out: '+output)),20000);
        const receive=data=>{
          output+=data;const match=output.match(/Minimal Data Studio: (http:\/\/localhost:\d+)/);
          if(match){clearTimeout(timer);resolve(match[1]);}
        };
        processHandle.stdout.on('data',receive);processHandle.stderr.on('data',receive);
        processHandle.once('exit',()=>{clearTimeout(timer);reject(Error('Server exited: '+output));});
        processHandle.once('error',error=>{clearTimeout(timer);reject(error);});
      });
    }
    try { const url=await start();await use({url, managerToken:async()=>Object.values(JSON.parse(await readFile(join(directory,'registry.json'),'utf8')))[0].token, writeScript: async (name,code)=>{await writeFile(join(project,name),code);}, restart:async()=>{await stop();return start();}}); }
    finally {await stop();await rm(directory,{recursive:true,force:true});}
  }
});
export {expect};
export async function open(page,url) {
  await page.goto(url);
  await expect(page.locator('#status')).toContainText('Ready');
}
export async function edit(page,code) {
  await page.locator('#editorWrap .CodeMirror').click();
  await page.keyboard.press('ControlOrMeta+A');
  // Wait on the save response, not a status label left over from an earlier save.
  const saved=page.waitForResponse(r=>r.url().endsWith('/editor-drafts')&&r.request().method()==='POST');
  await page.keyboard.insertText(code);
  return await saved;
}
