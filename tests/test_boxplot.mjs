import {test} from 'node:test';
import assert from 'node:assert/strict';
import {boxSummaries,applyBoxplot,boxSettings} from '../frontend/scatter-boxplot.mjs';
import {scatterData} from '../frontend/scatter-chart.mjs';
test('box summaries interpolate quartiles and use observed whiskers',()=>{
 const [b]=boxSummaries([1,2,3,4,5,100].map(y=>({xCategory:'A',y})));
 assert.deepEqual(Object.fromEntries(Object.entries(b).filter(([k])=>!['mean','boxLow','boxHigh','center'].includes(k))),{category:'A',n:6,q1:2.25,median:3.5,q3:4.75,lower:-1.5,upper:8.5,low:1,high:5,outliers:1});
 assert.equal(boxSummaries([{xCategory:'one',y:4}])[0].median,4);
});
test('median order and hidden points retain full summary and domain data',()=>{
 const c={x:'cat',y:['value'],categoryOrder:'medianAsc',boxOverlay:true,boxPoints:'outliers'};
 const d=scatterData(c,{cols:['cat','value'],types:['text','number'],rows:[['A',100],['B',1],['A',2]]},t=>t==='number');
 assert.deepEqual(d.categories,['B','A']);assert.equal(d.values.length,3);assert.equal(d.boxes.find(b=>b.category==='A').median,51);
 const spec={data:[{name:'source_0'}],marks:[{type:'symbol',from:{data:'source_0'}}]};applyBoxplot(spec,c,d);
 assert.equal(spec.data.find(s=>s.name==='studioBoxes').values.length,2);assert.equal(spec.marks.find(m=>m.type==='symbol').from.data,'studioOutliers');
});

test('custom ranges, mean and percentile whiskers determine outliers',()=>{
 const points=[0,1,2,3,4,5,6,7,8,9,100].map(y=>({xCategory:'A',y}));
 const [b]=boxSummaries(points,{boxStatistics:{boxLow:10,boxHigh:90,center:'mean',whiskers:'percentile',whiskerLow:5,whiskerHigh:95}});
 assert.equal(b.boxLow,1);assert.equal(b.boxHigh,9);assert.equal(b.low,.5);assert.equal(b.high,54.5);assert.equal(b.outliers,2);assert.equal(b.center,b.mean);
 const [full]=boxSummaries(points,{boxStatistics:{whiskers:'range'}});assert.equal(full.low,0);assert.equal(full.high,100);assert.equal(full.outliers,0);
});

test('editing one percentile preserves that bound while the sibling uses its default',()=>{
 assert.deepEqual(boxSettings({boxStatistics:{boxLow:10}}).box,[10,75]);
 assert.deepEqual(boxSettings({boxStatistics:{boxHigh:90}}).box,[25,90]);
 assert.deepEqual(boxSettings({boxStatistics:{whiskerLow:2}}).percentiles,[2,95]);
 assert.deepEqual(boxSettings({boxStatistics:{whiskerHigh:98}}).percentiles,[5,98]);
 assert.deepEqual(boxSettings({boxStatistics:{boxLow:90}}).box,[25,75]);
});
