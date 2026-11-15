import test from 'node:test';import assert from 'node:assert/strict';
import {bucket,nativeGrain,timeKey,grainLabel,applyTimeViewport} from '../frontend/time-chart.mjs';
test('UTC sub-day buckets and keys retain millisecond precision across midnight',()=>{
 const t=Date.parse('2026-11-01T23:59:59.999Z');
 assert.equal(bucket(t,'millisecond'),t);assert.equal(bucket(t,'second'),t-999);assert.equal(bucket(t,'minute'),Date.parse('2026-11-01T23:59:00Z'));assert.equal(bucket(t,'hour'),Date.parse('2026-11-01T23:00:00Z'));
 assert.equal(timeKey(t,'millisecond'),'2026-11-01T23:59:59.999Z');assert.equal(timeKey(t+1,'millisecond'),'2026-11-02T00:00:00.000Z');assert.match(grainLabel(t,'millisecond'),/999 UTC/);
 assert.equal(nativeGrain([t,t+1]),'millisecond');assert.equal(nativeGrain([t-999,t+1]),'second');assert.equal(bucket(-1,'second'),-1000);
 assert.equal(nativeGrain([Date.parse('2026-11-01'),Date.parse('2026-11-02')]),'day');
});
test('time viewport retains native Y extent until navigation and restores cached ranges',()=>{
 const c={type:'line',x:'t'},res={},d={time:true,res,grain:'hour',values:[{x:1000},{x:5000}]};
 const make=()=>({signals:[],scales:[{name:'x',type:'utc'},{name:'y',domain:[0,100]}],marks:[{type:'line'}]});
 const spec=make(),state=applyTimeViewport(spec,c,d);assert.deepEqual(state.initial[0],[1000,5000]);assert.deepEqual(spec.scales[1].domain,[0,100]);assert.deepEqual(spec.scales[1].domainRaw,{signal:'studioYDomain'});assert.equal(state.initial[1],null);assert.equal(spec.marks[1].clip,true);
 state.domains[0]=[2000,3000];const next=make();applyTimeViewport(next,c,d);assert.deepEqual(next.signals[0].value,[2000,3000]);assert.equal(applyTimeViewport(make(),c,{...d,overlay:true}),null);
});
test('time viewport resets when series grouping or visible series changes',()=>{
 const res={},c={type:'line',x:'month',series:'cohort'},d={time:true,res,grain:'month',series:['A','Other'],values:[{x:1},{x:2}]};
 const make=()=>({signals:[],scales:[{name:'x'},{name:'y'}],marks:[]});
 const grouped=applyTimeViewport(make(),c,d);grouped.domains[1]=[0,800000];
 const all=applyTimeViewport(make(),{...c,showAllSeries:true},{...d,series:['A','B','C']});assert.equal(all.domains[1],null);
 all.domains[1]=[0,40000];const subset=applyTimeViewport(make(),{...c,showAllSeries:true,visibleSeries:['A']},{...d,series:['A','B','C']});assert.equal(subset.domains[1],null);
});
