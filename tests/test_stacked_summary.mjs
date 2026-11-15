import test from 'node:test';
import assert from 'node:assert/strict';
import {selectedStackSummary} from '../frontend/stacked-interaction.mjs';
test('selected contributions keep full-bar denominator',()=>{
 const rows=[{series:'A',value:10},{series:'B',value:20},{series:'C',value:70}];
 assert.deepEqual(selectedStackSummary(rows,new Set(['A','B'])),{total:100,selected:30,share:.3});
 assert.deepEqual(selectedStackSummary(rows,new Set(['missing'])),{total:100,selected:0,share:0});
 assert.equal(selectedStackSummary([{series:'A',value:0}],new Set(['A'])).share,null);
 assert.equal(selectedStackSummary([{series:'A',value:-1},{series:'B',value:5}],new Set(['B'])).share,null);
});
