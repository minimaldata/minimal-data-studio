import test from 'node:test';import assert from 'node:assert/strict';
import {stripPalette,tooltipOptions,mergeDetails} from '../frontend/line-appearance.mjs';
test('custom strip endpoints and reversal are deterministic',()=>{
 const c={palette:'custom',start:'#000000',end:'#ffffff'};
 assert.deepEqual(stripPalette(3,false,c),['#000000','#808080','#ffffff']);assert.deepEqual(stripPalette(3,false,{...c,reverse:true}),['#ffffff','#808080','#000000']);assert.equal(stripPalette(48).length,48);assert.equal(stripPalette(2,false,{palette:'custom',start:'invalid'})[0],'#2166ac');
});
test('extra fields preserve uniform values and identify mixed values including nulls',()=>{
 assert.deepEqual(mergeDetails({region:{value:'East'}},{region:{value:'West'}}),{region:{mixed:true}});
 assert.deepEqual(mergeDetails({region:{value:'East'}},{region:{value:'East'}}),{region:{value:'East'}});
 assert.deepEqual(mergeDetails({region:{value:null}},{region:{value:'East'}}),{region:{mixed:true}});
 assert.equal(tooltipOptions({}).show,true);assert.equal(tooltipOptions({lineTooltip:{decimals:12}}).decimals,6);
});
