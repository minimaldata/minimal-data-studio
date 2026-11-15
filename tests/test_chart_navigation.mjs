import {applyScatterViewport} from '../frontend/scatter-viewport.mjs';
import {test} from 'node:test';import assert from 'node:assert/strict';
import {zoomDomain,rectangleDomains,clampDomain} from '../frontend/chart-navigation.mjs';
test('zoom uses axis midpoint and resets preserve color/size scales',()=>{
 assert.deepEqual(zoomDomain([0,10],.5),[2.5,7.5]);assert.deepEqual(zoomDomain([2.5,7.5],2),[0,10]);
 const res={},c={type:'scatter',x:'x',y:['y']};const create=()=>({scales:[{name:'x',domain:[0,10]},{name:'y',domain:[-5,5]},{name:'size',domain:[0,9]}],marks:[{type:'symbol'}]});
 const spec=create(),state=applyScatterViewport(spec,c,{res});assert.deepEqual(spec.scales[2].domain,[0,9]);assert.equal(spec.marks.find(m=>m.type==='symbol').clip,true);assert.ok(spec.signals.find(s=>s.name==='studioPanAnchor'));
 state.domains=[[2,8],[-3,3]];const png=create();applyScatterViewport(png,c,{res},{interactive:false});assert.deepEqual(png.signals[0].value,[2,8]);assert.equal(png.signals.length,2);
 const other=create();applyScatterViewport(other,c,{res:{}});assert.deepEqual(other.signals[0].value,[0,10]);
});

test('box zoom maps both drag directions, clamps edges, ignores tiny rectangles',()=>{
 const domains=[[0,100],[0,200]];
 assert.deepEqual(rectangleDomains(domains,[20,20],[80,80],100,100),[[20,80],[40,160]]);
 assert.deepEqual(rectangleDomains(domains,[80,80],[20,20],100,100),[[20,80],[40,160]]);
 assert.deepEqual(rectangleDomains(domains,[20,20],[200,200],100,100),[[20,100],[0,160]]);
 assert.equal(rectangleDomains(domains,[20,20],[22,80],100,100),null);
});

test('bounded navigation preserves span and stops at either edge',()=>{
 assert.deepEqual(clampDomain([-2,4],[0,12]),[0,6]);
 assert.deepEqual(clampDomain([8,14],[0,12]),[6,12]);
 assert.deepEqual(clampDomain([3,9],[0,12]),[3,9]);
 assert.deepEqual(clampDomain([-3,15],[0,12]),[0,12]);
 assert.deepEqual(clampDomain([-20,20],[-10,30]),[-10,30]);
});
