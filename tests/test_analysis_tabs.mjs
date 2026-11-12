import test from 'node:test';
import assert from 'node:assert/strict';
import {createAnalysisTabs} from '../frontend/analysis-tabs.mjs';
test('analysis tab references preserve order and selection without document content',()=>{
  const tabs=createAnalysisTabs({});
  tabs.remember('notebook',{id:'n',name:'Notes',cells:[{source:'private code'}]});
  tabs.remember('dashboard',{id:'d',name:'Overview'});
  tabs.remember('notebook',{id:'n',name:'Renamed'});
  assert.deepEqual(tabs.snapshot('notebook:n'),{format:1,analyses:[{kind:'notebook',id:'n'},{kind:'dashboard',id:'d'}],active:'notebook:n'});
  tabs.forget('notebook','n');assert.equal(tabs.snapshot('notebook:n').active,null);
});
test('restore uses current documents and ignores stale, invalid and duplicate references',()=>{
  const tabs=createAnalysisTabs({}),n={id:'n',name:'Renamed'};
  const active=tabs.restore({format:1,analyses:[null,{kind:'notebook',id:'gone'},{kind:'task',id:'x'},{kind:'notebook',id:'n'},{kind:'notebook',id:'n'}],active:'notebook:n'},{notebook:[n],dashboard:[]});
  assert.equal(active.item,n);assert.equal(tabs.entries.size,1);
  assert.equal(tabs.restore(null,{notebook:[n],dashboard:[]}),null);assert.equal(tabs.entries.size,0);
});
