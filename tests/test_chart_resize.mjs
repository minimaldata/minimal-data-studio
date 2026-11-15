import test from 'node:test';import assert from 'node:assert/strict';
import {deferChartResize,observeSettledChartResize} from '../frontend/chart-resize.mjs';
test('large resize strips only container resize streams',()=>{
 const spec={signals:[{name:'width',init:'containerSize()[0]',on:[{events:'window:resize'},{events:'click'}]},{name:'height',on:[{events:'window:resize'}]},{name:'hover',on:[{events:'pointermove'}]}]};deferChartResize(spec);assert.deepEqual(spec.signals[0].on,[{events:'click'}]);assert.equal(spec.signals[1].on.length,0);assert.equal(spec.signals[2].on.length,1);
});
test('resize changes are coalesced and finalization cancels pending work',async()=>{
 let notify,disconnected=false,runs=0;const plot={clientWidth:300,clientHeight:200,classList:{add(){},remove(){}}};const view={width(){return this;},height(){return this;},resize(){return this;},async runAsync(){runs++;},finalize(){}};
 const document=new EventTarget(),window=new EventTarget();observeSettledChartResize(plot,view,{clear(){}},{delay:5,document,window,ResizeObserver:class{constructor(fn){notify=fn;}observe(){}disconnect(){disconnected=true;}}});
 notify();await new Promise(r=>setTimeout(r,15));assert.equal(runs,0);
 plot.clientWidth=350;notify();plot.clientWidth=400;notify();await new Promise(r=>setTimeout(r,20));assert.equal(runs,1);
 plot.clientWidth=500;notify();view.finalize();await new Promise(r=>setTimeout(r,15));assert.equal(runs,1);assert.equal(disconnected,true);
});
