import test from 'node:test';import assert from 'node:assert/strict';
import {calculate,selectionStats,numericValue,cleanCalculatorState,formatCalculatorSummary} from '../frontend/calculator-core.mjs';
test('scratch arithmetic respects precedence, percent, references and rejects execution',()=>{
 assert.equal(calculate('(248 - 31) / 31'),7);assert.equal(calculate('200 * 15%'),30);assert.equal(calculate('-2^2'),-4);assert.equal(calculate('2^3^2'),512);
 assert.equal(calculate('$1 / 22',[{id:'$1',value:242}]),11);
 for(const s of ['1/0','NaN','alert(1)','1;2','globalThis','(2+3','2 3','2**3','$9','1e999','-'.repeat(150)+'1'])assert.throws(()=>calculate(s));
});
test('selection totals skip missing, text, unsafe integers and preserve zeros',()=>{
 assert.equal(numericValue('9007199254740993'),null);assert.equal(numericValue('',true),null);assert.equal(numericValue('12',false),null);
 assert.deepEqual(selectionStats([{value:0},{value:10},{value:null},{value:-4}]),{nonNullCount:3,distinctCount:3,count:3,skipped:1,sum:6,average:2,median:0,min:-4,max:10});
 const state=cleanCalculatorState({expression:'$1/2',snapshots:[{id:'$1',value:12,label:'Calls'},{id:'$2',value:Infinity,label:'bad'}]});assert.equal(state.snapshots.length,1);assert.equal(calculate(state.expression,state.snapshots),6);
});
test('rounding preferences preserve exact snapshot values and reject invalid precision',()=>{
 const state=cleanCalculatorState({inputDecimals:2,resultDecimals:3,snapshots:[{id:'$1',value:1.23456,label:'Value'}]});assert.equal(state.inputDecimals,2);assert.equal(state.resultDecimals,3);assert.equal(state.snapshots[0].value,1.23456);assert.equal(cleanCalculatorState({inputDecimals:100,resultDecimals:-1}).inputDecimals,null);assert.equal(cleanCalculatorState({resultDecimals:-1}).resultDecimals,null);
});

test('selection counts include text and empty strings, exclude nulls and distinguish types',()=>{
 const stats=selectionStats(['oak','oak','pine','',null,undefined,1,'1'].map(raw=>({raw,value:numericValue(raw,typeof raw==='number')})));
 assert.equal(stats.nonNullCount,6);assert.equal(stats.distinctCount,5);assert.equal(stats.count,1);assert.equal(stats.sum,1);
});

test('median uses numeric values, handles even selections and leaves source order intact',()=>{
 const items=[{value:9},{value:null},{value:1},{value:4},{value:2}];
 assert.equal(selectionStats(items).median,3);
 assert.deepEqual(items.map(i=>i.value),[9,null,1,4,2]);
 assert.equal(selectionStats([{value:null}]).median,null);
 assert.equal(selectionStats([{value:8},{value:2},{value:3}]).median,3);
});

test('button summaries compact large and tiny magnitudes without changing operands',()=>{
 for(const [input,text] of [[43920,'43.9K'],[2400000,'2.4M'],[-1200000000,'-1.2B'],[999999,'1M'],[1e15,'1e15'],[.00001234,'1.23e-5'],[0,'0'],[null,'—']])assert.equal(formatCalculatorSummary(input),text);
 assert.equal(formatCalculatorSummary(12.3456,{places:2}),'12.35');
 assert.equal(formatCalculatorSummary(12,{count:true,places:2}),'12');
 assert.equal(calculate('$1',[{id:'$1',value:43920}]),43920);
});

test('restoring calculators preserves snapshots beyond the former lifetime limit',()=>{
 const snapshots=Array.from({length:101},(_,i)=>({id:'$'+(i+1),value:i,label:'Saved'}));const state=cleanCalculatorState({snapshots,expression:'$1 + $101'});assert.equal(state.snapshots.length,101);assert.equal(calculate(state.expression,state.snapshots),100);
});
