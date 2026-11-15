import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPreviewSlot} from '../frontend/tab-tools.mjs';
test('preview replaces only the temporary document and keep retains it',async()=>{
 const slot=createPreviewSlot(),closed=[];
 await slot.open({key:'one',close:()=>closed.push('one')});
 await slot.open({key:'one',close:()=>assert.fail('same preview should not close')});
 assert.deepEqual(closed,[]);
 await slot.open({key:'two',close:()=>closed.push('two')});assert.deepEqual(closed,['one']);
 slot.keep('two');await slot.open({key:'three',close:()=>closed.push('three')});
 assert.deepEqual(closed,['one']);assert.equal(slot.is('three'),true);
});
test('failed close does not discard the document and aborts replacement',async()=>{
 const slot=createPreviewSlot();await slot.open({key:'one',close:()=>{throw Error('Save failed');}});
 await assert.rejects(slot.open({key:'two',close:()=>{}}),/Save failed/);
 assert.equal(slot.is('two'),false);
});
