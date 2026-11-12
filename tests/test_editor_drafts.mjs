import test from 'node:test';
import assert from 'node:assert/strict';
import {createEditorDrafts,emptyEditorState,snapshot} from '../frontend/editor-drafts.mjs';
const state = code => ({format:1,active:0,tabs:[{name:'Query 1',sql:code,lang:'sql',drafts:{sql:code},res:new Uint8Array(999)}]});
test('snapshots preserve formatting and language drafts but omit results',()=>{
 assert.deepEqual(snapshot(state('SELECT\n  1')), {format:1,active:0,tabs:[{name:'Query 1',sql:'SELECT\n  1',lang:'sql',drafts:{sql:'SELECT\n  1'}}]});
});
test('autosaves serialize changes and use the newest revision',async()=>{
 let release, posts=[];
 const client=createEditorDrafts({request:async(path,body)=>{
  if(!body)return {revision:0,state:null};
  posts.push(body);
  if(posts.length===1)await new Promise(r=>release=r);
  return {revision:posts.length};
 }});
 assert.deepEqual(await client.load(),emptyEditorState());
 const saving=client.save(state('first'));
 client.save(state('second')); client.save(state('latest'));
 release(); await saving;
 assert.deepEqual(posts.map(p=>[p.revision,p.state.tabs[0].sql]),[[0,'first'],[1,'latest']]);
 assert.equal(client.dirty,false);
});
test('conflicts stop writes; recovery retains both windows and latest local text',async()=>{
 let writes=0, notices=[], saved;
 const client=createEditorDrafts({notify:n=>notices.push(n.status),request:async(path,body)=>{
  if(!body)return {revision:5,state:state('other window')};
  if(++writes===1)throw Object.assign(new Error('Changed elsewhere'),{status:409});
  saved=body;return {revision:6};
 }});
 await client.load(); await client.save(state('local'));
 await client.save(state('new local'));
 assert.equal(writes,1);assert.equal(notices.at(-1),'conflict');assert.equal(client.dirty,true);
 const merged=await client.recover(state('new local'));
 assert.deepEqual(merged.tabs.map(t=>t.sql),['other window','new local']);
 assert.equal(saved.revision,5);assert.equal(client.dirty,false);
});
