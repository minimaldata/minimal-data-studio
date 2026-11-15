import {test} from 'node:test';import assert from 'node:assert/strict';
import {embedChartView} from '../frontend/chart-controller.mjs';
import {chartNavigationPolicy} from '../frontend/chart-navigation.mjs';
test('navigation policies preserve scatter, time, and bar defaults',()=>{
 assert.deepEqual(chartNavigationPolicy('scatter'),{bounded:true,ariaLabel:'Scatterplot navigation'});
 assert.deepEqual(chartNavigationPolicy('line'),{bounded:true,showAxisChoice:true,roundTime:true,defaultAxes:'x',ariaLabel:'Time navigation'});
 for(const type of ['bar','stacked','percent']){
  assert.equal(chartNavigationPolicy(type).defaultAxes,'x');assert.equal(chartNavigationPolicy(type,{horizontal:true}).defaultAxes,'y');
  assert.equal(chartNavigationPolicy(type).bounded,true);assert.equal(chartNavigationPolicy(type).roundTime,undefined);
 }
 assert.throws(()=>chartNavigationPolicy('unknown'));
});
test('chart embed passes rendering options and attaches only to the resulting view',async()=>{
 const view={finalize(){}},plot={},spec={},tooltip={attach(v){assert.equal(v,view);},dispose(){assert.fail('successful render should not dispose');}};
 const result=await embedChartView(async(p,s,opts)=>{assert.equal(p,plot);assert.equal(s,spec);assert.deepEqual(opts,{mode:'vega',actions:false,renderer:'canvas'});return {view};},plot,spec,{renderer:'canvas'},[null,tooltip]);
 assert.equal(result,view);
});
test('failed embeds dispose tooltips; failed attachment finalizes the partial view',async()=>{
 let disposed=0,finalized=0;const tooltip={dispose(){disposed++;},attach(){throw Error('attach failed');}};
 await assert.rejects(embedChartView(async()=>{throw Error('render failed');},{},{},{},[tooltip]),/render failed/);assert.equal(disposed,1);
 await assert.rejects(embedChartView(async()=>({view:{finalize(){finalized++;}}}),{},{},{},[tooltip]),/attach failed/);assert.equal(disposed,2);assert.equal(finalized,1);
});
