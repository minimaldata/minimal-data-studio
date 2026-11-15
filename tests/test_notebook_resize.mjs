import {test} from 'node:test';import assert from 'node:assert/strict';import {cellHeight} from '../frontend/notebook-resize.mjs';
test('notebook sizes default safely and are constrained',()=>{for(const v of [undefined,null,'500',NaN,Infinity])assert.equal(cellHeight(v),null);assert.equal(cellHeight(5),80);assert.equal(cellHeight(99999),1600);assert.equal(cellHeight(401.7),402);});
