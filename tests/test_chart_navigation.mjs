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

test('scrollbar keeps the viewport width and bounds while snapping categories',async()=>{
 const {scrollDomain}=await import('../frontend/chart-scrollbar.mjs');
 assert.deepEqual(scrollDomain([10,20],[0,100],22.4,true),[22,32]);
 assert.deepEqual(scrollDomain([10,20],[0,100],22.4),[22.4,32.4]);
 assert.deepEqual(scrollDomain([10,20],[0,100],200,true),[90,100]);
 assert.deepEqual(scrollDomain([10,20],[0,100],-3,true),[0,10]);
});

test('horizontal wheel leaves vertical and pinch gestures alone',async()=>{
 const {horizontalWheelDelta}=await import('../frontend/chart-navigation.mjs');
 assert.equal(horizontalWheelDelta({deltaX:40,deltaY:2,deltaMode:0},500),40);
 assert.equal(horizontalWheelDelta({deltaX:2,deltaY:40,deltaMode:0},500),0);
 assert.equal(horizontalWheelDelta({deltaX:0,deltaY:3,deltaMode:1,shiftKey:true},500),48);
 assert.equal(horizontalWheelDelta({deltaX:40,deltaY:0,ctrlKey:true},500),0);
});

test('pinch zoom anchors a point and respects bounds and minimum span',async()=>{
 const {zoomAt}=await import('../frontend/chart-navigation.mjs');
 assert.deepEqual(zoomAt([0,100],[0,100],.5,.25),[12.5,62.5]);
 assert.deepEqual(zoomAt([12.5,62.5],[0,100],2,.25),[0,100]);
 assert.deepEqual(zoomAt([0,10],[0,100],2,0),[0,20]);
 assert.equal(zoomAt([0,1],[0,100],.01,.5)[1]-zoomAt([0,1],[0,100],.01,.5)[0],100/1024);
 assert.deepEqual(zoomAt([0,2],[0,100],.1,0,2),[0,2]);
});
