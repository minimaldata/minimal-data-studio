import test from 'node:test';import assert from 'node:assert/strict';import {lineSettings} from '../frontend/line-settings.mjs';
test('count chooses defaults but explicit legend and hover settings are independent',()=>{
 assert.deepEqual(lineSettings({},2),{legend:'inline',hover:'all'});assert.deepEqual(lineSettings({},48),{legend:'strip',hover:'selected'});
 for(const n of [1,2,48]){assert.deepEqual(lineSettings({seriesLegend:'strip',hoverBehavior:'all'},n),{legend:'strip',hover:'all'});assert.deepEqual(lineSettings({seriesLegend:'inline',hoverBehavior:'selected'},n),{legend:'inline',hover:'selected'});}
 assert.deepEqual(lineSettings({seriesLegend:'invalid',hoverBehavior:'auto'},2),{legend:'inline',hover:'all'});
});
