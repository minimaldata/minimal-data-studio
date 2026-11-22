import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectColumns,selectRows,selectAxis} from '../frontend/table-column-selection.mjs';
test('whole columns support toggle, anchored ranges, additive ranges and ordered copying',()=>{
 let s=selectColumns(null,3);s=selectColumns(s,0,{metaKey:true});assert.deepEqual(s.columns,[0,3]);
 s=selectColumns(s,2,{shiftKey:true});assert.deepEqual(s.columns,[0,1,2]);assert.equal(s.anchor,0);
 s=selectColumns(s,4,{ctrlKey:true});s=selectColumns(s,3,{ctrlKey:true,shiftKey:true});assert.deepEqual(s.columns,[0,1,2,3,4]);
 s=selectColumns(s,2,{metaKey:true});assert.deepEqual(s.columns,[0,1,3,4]);
 s=selectColumns(s,1);assert.deepEqual(s.columns,[1]);assert.deepEqual(selectColumns(s,1,{metaKey:true}).columns,[]);
});

test('whole rows use stable identity while ranges follow visible order',()=>{
 let s=selectRows(null,10,[10,20,30,40]);s=selectRows(s,30,[10,20,30,40],{metaKey:true});assert.deepEqual(s.rows,[10,30]);
 s=selectRows(s,10,[10,20,30,40],{ctrlKey:true});assert.deepEqual(s.rows,[30]);
 s=selectRows(s,40,[10,20,30,40],{shiftKey:true});assert.deepEqual(s.rows,[10,20,30,40]);
 s=selectRows(s,20,[40,30,20,10],{shiftKey:true});assert.deepEqual(s.rows,[20,10]);
});

test('row and column axes preserve independent anchors and toggles',()=>{
 let s=selectAxis(null,'columns',1,[],{});s=selectAxis(s,'columns',3,[],{metaKey:true});
 s=selectAxis(s,'rows',20,[10,20,30,40],{});assert.deepEqual(s.columns,[1,3]);assert.deepEqual(s.rows,[20]);
 s=selectAxis(s,'rows',40,[10,20,30,40],{shiftKey:true});assert.deepEqual(s.rows,[20,30,40]);assert.deepEqual(s.columns,[1,3]);
 s=selectAxis(s,'columns',2,[],{shiftKey:true});assert.deepEqual(s.columns,[2,3]);assert.deepEqual(s.rows,[20,30,40]);
 s=selectAxis(s,'columns',2,[],{metaKey:true});s=selectAxis(s,'columns',3,[],{metaKey:true});assert.equal(s.columns,null);assert.deepEqual(s.rows,[20,30,40]);
});
