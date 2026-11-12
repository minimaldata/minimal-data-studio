import test from 'node:test';
import assert from 'node:assert/strict';
import {checkedResponse,createSessionClient} from '../frontend/api.mjs';
import {browserPreferences} from '../frontend/preferences.mjs';
test('HTTP errors retain status and server explanation',async()=>{
 await assert.rejects(checkedResponse({ok:false,status:409,json:async()=>({error:'Changed elsewhere'})}),e=>e.status===409&&e.message==='Changed elsewhere');
});
test('database transport requires a session and preserves existing query parameters',async()=>{
 let session=null,seen;
 const request=createSessionClient(()=>session,async url=>{seen=url;return {ok:true};});
 await assert.rejects(request('/db/query'),/not connected/);
 session={session:'a b'};await request('/db/query?limit=5');
 assert.equal(seen,'/db/query?limit=5&session=a%20b');
});
test('unavailable browser preferences do not prevent project operation',()=>{
 const prefs=browserPreferences({getItem(){throw Error('Unavailable');},setItem(){throw Error('Full');}});
 assert.equal(prefs.get('theme','dark'),'dark');assert.doesNotThrow(()=>prefs.set('theme','light'));
});
