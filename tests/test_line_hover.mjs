import test from 'node:test';import assert from 'node:assert/strict';
import {lineHoverIndex,nearestObservation,placeHoverLabels} from '../frontend/line-hover.mjs';
test('shared hover snaps to observed times without inventing missing series values',()=>{
 const {at,times}=lineHoverIndex([{x:10,series:'A',value:2},{x:20,series:'B',value:3},{x:30,series:'A',value:null}]);
 assert.equal(nearestObservation(times,18),20);assert.equal(at.get(20).get('A'),undefined);assert.equal(nearestObservation(times,28,10,20),20);assert.equal(nearestObservation(times,18,21,25),undefined);
});

test('value labels flip at edges and omit collisions without moving their dots',()=>{
 const bounds={x:0,y:0,width:200,height:100};
 const placements=placeHoverLabels([{x:190,y:2,width:30,height:12},{x:190,y:3,width:30,height:12},{x:20,y:90,width:25,height:12}],bounds);
 assert.deepEqual(placements[0],{x:150,y:0,width:30,height:12});assert.equal(placements[1],null);assert.equal(placements[2].x,30);
 assert.deepEqual(placeHoverLabels([{x:100,y:50,width:30,height:12}],bounds,[{x:0,y:0,width:200,height:100}]),[null]);
 assert.deepEqual(placeHoverLabels([{x:100,y:50,width:250,height:12}],bounds),[null]);
});
