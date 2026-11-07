import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const handler = html.slice(html.indexOf('$("bringConfirm").onclick ='), html.indexOf('// ---------- resizable split'));
function setup(fail=[]) {
  const elements = Object.fromEntries(['bringConfirm','bringCancel','bringStatus','status','bringDialog'].map(k=>[k,{close(){this.closed=true;}}]));
  const calls=[];
  const context=vm.createContext({
    $:id=>elements[id], projectFileBusy:false, pendingProjectFiles:[{name:'good.csv'},{name:'bad.csv'}],
    refreshProjectFiles:async()=>{},
    databaseFetch:async(path,options)=>{
      calls.push(path);
      if(fail.includes(options.body.name)) throw new Error('Disk full');
      return {json:async()=>({name:options.body.name})};
    }
  });
  vm.runInContext(handler,context);
  return {context,elements,calls,run:()=>elements.bringConfirm.onclick()};
}
test('bringing files copies them without importing tables',async()=>{
  const s=setup(); await s.run();
  assert.ok(s.calls.every(p=>p.startsWith('/db/project/bring?')));
  assert.match(s.elements.status.textContent,/no tables created/);
  assert.equal(s.elements.bringDialog.closed,true);
});
test('only failed copies remain pending for retry',async()=>{
  const s=setup(['bad.csv']); await s.run();
  assert.equal(s.context.pendingProjectFiles.length,1);
  assert.equal(s.context.pendingProjectFiles[0].name,'bad.csv');
  assert.match(s.elements.bringStatus.textContent,/Disk full/);
  assert.equal(s.elements.bringConfirm.disabled,false);
});
