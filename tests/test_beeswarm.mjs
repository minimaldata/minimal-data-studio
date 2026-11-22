import {test} from 'node:test';
import assert from 'node:assert/strict';
import {packBeeswarm,beeswarmEnabled} from '../frontend/scatter-beeswarm.mjs';
test('beeswarm separates coincident points deterministically and preserves inputs',()=>{
 const points=Array.from({length:12},(_,i)=>({rowNumber:i+1,x:0,y:5}));
 const before=JSON.stringify(points),result=packBeeswarm(points,600,400,[-.5,1.5],[0,10]);
 assert.deepEqual(result,packBeeswarm(points,600,400,[-.5,1.5],[0,10]));assert.equal(JSON.stringify(points),before);
 const xs=Object.values(result).sort((a,b)=>a-b);for(let i=1;i<xs.length;i++)assert.ok(xs[i]-xs[i-1]>=2*(Math.sqrt(75/Math.PI)+1)-.01);
});
test('beeswarm retains dense points inside category and guards unsupported encodings',()=>{
 const points=Array.from({length:100},(_,i)=>({rowNumber:i+1,x:0,y:5}));
 const xs=Object.values(packBeeswarm(points,100,100,[-.5,1.5],[0,10]));assert.equal(xs.length,100);assert.ok(xs.every(x=>Math.abs(x)<21));
 const c={pointLayout:'beeswarm'},d={categorical:true,values:points};assert.ok(beeswarmEnabled(c,d));assert.ok(!beeswarmEnabled({...c,size:'n'},d));assert.ok(!beeswarmEnabled(c,{...d,values:Array(5001)}));
});
