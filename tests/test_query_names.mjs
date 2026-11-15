import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateQueryName,copiedQueryName} from '../frontend/query-names.mjs';
test('query names are unique across folders, ignoring case and surrounding spaces',()=>{
 const queries=[{id:'a',name:'Revenue',folder:'Reports'}];
 assert.throws(()=>validateQueryName(queries,' revenue ','b'),/Saved queries \/ Reports/);
 assert.equal(validateQueryName(queries,' Revenue ','a'),'Revenue');
 assert.throws(()=>validateQueryName(queries,' '),/Enter a query name/);
});
test('copies choose the next available name',()=>{
 assert.equal(copiedQueryName([{name:'Revenue copy'},{name:'REVENUE COPY 2'}],'Revenue'),'Revenue copy 3');
});
