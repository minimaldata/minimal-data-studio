import {test} from 'node:test';import assert from 'node:assert/strict';
import {violinData} from '../frontend/scatter-violin.mjs';
import {boxSummaries} from '../frontend/scatter-boxplot.mjs';
test('violin shape is finite, bounded and stable; sparse groups are explicit',()=>{
 const points=[...[1,2,2,3,8,9,9,10].map(y=>({xCategory:'A',y})),{xCategory:'B',y:4},...[5,5,5].map(y=>({xCategory:'C',y}))];
 const boxes=boxSummaries(points).map((b,x)=>({...b,x}));const d=violinData(points,boxes);
 assert.equal(d.samples.length,97);assert.equal(d.sparse.length,2);assert.equal(d.samples[0].y,1);assert.equal(d.samples.at(-1).y,10);
 assert.ok(d.samples.every(p=>Number.isFinite(p.halfWidth)&&p.halfWidth>=0&&p.halfWidth<=.4));assert.equal(Math.max(...d.samples.map(p=>p.halfWidth)),.4);
 assert.deepEqual(d,violinData(points,boxes));
});
