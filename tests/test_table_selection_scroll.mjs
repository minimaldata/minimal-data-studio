import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectionScrollStep} from '../frontend/table-selection-scroll.mjs';
test('selection scrolling accelerates outside either edge, with a bounded speed',()=>{
 assert.equal(selectionScrollStep(150,100,300),0);
 const near=selectionScrollStep(295,100,300),edge=selectionScrollStep(300,100,300),far=selectionScrollStep(360,100,300);
 assert.ok(near>0&&near<edge&&edge<far);
 assert.equal(selectionScrollStep(40,100,300),-far);
 assert.equal(selectionScrollStep(-10000,100,300),-90);
 assert.equal(selectionScrollStep(10000,100,300),90);
});
