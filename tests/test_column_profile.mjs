import {test} from 'node:test';
import assert from 'node:assert/strict';
import {profileColumn} from '../frontend/column-profile.mjs';
test('profiles distinguish null, empty, whitespace and repeated values',()=>{
 const p=profileColumn([null,'',' ',' x ','x','x']);assert.equal(p.nulls,1);assert.equal(p.empty,1);assert.equal(p.whitespace,1);assert.equal(p.padded,2);assert.equal(p.distinct,4);assert.equal(p.uniqueness,4/5);assert.equal(p.frequencies[0].count,2);
});
test('numeric profile quartiles and bins cover valid observations exactly',()=>{
 const p=profileColumn([1,2,3,4,null,'bad'],'number');assert.equal(p.mean,2.5);assert.equal(p.median,2.5);assert.equal(p.q1,1.75);assert.equal(p.q3,3.25);assert.equal(p.invalid,1);assert.equal(p.bins.reduce((n,b)=>n+b.count,0),4);assert.equal(profileColumn([7,7],'number').bins.length,1);assert.equal(profileColumn([],'number').min,undefined);
});
test('date profile reports limits and excludes invalid dates from bins',()=>{
 const p=profileColumn(['2026-01-01','2026-03-01','bad',null],'date');assert.equal(p.min,Date.parse('2026-01-01'));assert.equal(p.max,Date.parse('2026-03-01'));assert.equal(p.valid,2);assert.equal(p.invalid,1);
});
