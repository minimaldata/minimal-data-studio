import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scatterData,scatterSpec,applyScatterBrightness} from '../frontend/scatter-chart.mjs';
const numeric=t=>t==='DOUBLE';
const res={cols:['x','y','weight','group','score'],types:['DOUBLE','DOUBLE','DOUBLE','VARCHAR','DOUBLE'],rows:[[1,2,5,'A',8],[1,3,10,'B',9],[null,4,1,'A',3],[2,4,-1,'B',2]]};
test('scatter retains repeated X observations and skips invalid axes and size',()=>{
 const c={x:'x',y:['y'],size:'weight',shape:'group',color:'score'};const d=scatterData(c,res,numeric);assert.equal(d.values.length,2);assert.equal(d.skipped,2);assert.deepEqual(d.values.map(r=>r.y),[2,3]);const s=scatterSpec(c,d);assert.equal(s.encoding.color.type,'quantitative');assert.equal(s.encoding.shape.type,'nominal');assert.equal(s.encoding.size.scale.zero,true);assert.equal(s.encoding.x.scale.zero,false);
});
test('category colors, uniform size and coincident rows are preserved',()=>{
 const c={x:'x',y:['y'],color:'group'};const d=scatterData(c,{...res,rows:[res.rows[0],res.rows[0]]},numeric);assert.equal(d.values.length,2);const s=scatterSpec(c,d);assert.equal(s.encoding.color.type,'nominal');assert.equal(s.encoding.size,undefined);assert.equal(s.encoding.shape,undefined);
});

test('brightness keeps missing values as neutral and handles constant fields',()=>{
 const c={type:'scatter',x:'x',y:['y'],brightness:'score'};
 const d=scatterData(c,{...res,rows:[[1,2,5,'A',8],[1,3,10,'B',null],[2,4,5,'A',8]]},numeric);
 assert.equal(d.values.length,3);assert.equal(d.values[1].brightness,null);
 const spec={marks:[{type:'symbol',encode:{update:{fill:{value:'#3275db'}}}}]};
 const patched=applyScatterBrightness(spec,c,d);assert.match(patched.marks[0].encode.update.fill.signal,/isValid\(datum.brightness\)/);assert.doesNotMatch(patched.marks[0].encode.update.fill.signal,/NaN|Infinity/);assert.equal(patched.marks[0].encode.update.opacity.value,1);assert.deepEqual(patched.scales[0].domain,[8,8]);
 assert.equal(scatterSpec(c,d).encoding.tooltip.at(-1).field,'brightness');
 const untouched={marks:[]};assert.equal(applyScatterBrightness(untouched,{type:'scatter'},d),untouched);
});

test('scatter appearance changes mapped sizes, legends and opacity without changing data',()=>{
 const c={type:'scatter',x:'x',y:['y'],size:'weight',color:'group',brightness:'score',scatterStyle:{size:2,opacity:.25,outline:true,grid:false,legend:false,color:'#ff0000'}};
 const d=scatterData(c,res,numeric),spec=scatterSpec(c,d);assert.deepEqual(spec.encoding.size.scale.range,[40,1400]);assert.equal(spec.mark.opacity,.25);assert.equal(spec.mark.strokeWidth,1);assert.equal(spec.config.axis.grid,false);assert.equal(spec.encoding.color.legend,null);
 const vg={marks:[{type:'symbol',encode:{update:{fill:{value:'red'}}}}]};applyScatterBrightness(vg,c,d);assert.equal(vg.marks[0].encode.update.opacity.value,.25);assert.equal(vg.legends,undefined);
});

test('individual legends hide independently without changing encodings',()=>{
 const c={type:'scatter',x:'x',y:['y'],size:'weight',color:'group',shape:'group',brightness:'score',scatterStyle:{legends:{color:false,brightness:false}}};
 const d=scatterData(c,res,numeric),spec=scatterSpec(c,d);
 assert.equal(spec.encoding.color.legend,null);assert.notEqual(spec.encoding.shape.legend,null);assert.notEqual(spec.encoding.size.legend,null);
 const vg={marks:[]};applyScatterBrightness(vg,c,d);assert.equal(vg.legends,undefined);
 c.scatterStyle.legends={size:false,shape:false};const next=scatterSpec(c,d);
 assert.notEqual(next.encoding.color.legend,null);assert.equal(next.encoding.shape.legend,null);assert.equal(next.encoding.size.legend,null);
 const visible={marks:[]};applyScatterBrightness(visible,c,d);assert.equal(visible.legends.length,1);
});

test('categorical X uses stable jitter, real labels and independent numeric encodings',()=>{
 const c={type:'scatter',x:'group',y:['y'],size:'weight'};
 const d=scatterData(c,res,numeric),again=scatterData(c,res,numeric);
 assert.equal(d.categorical,true);assert.deepEqual(d.categories,['A','B']);assert.deepEqual(d.values,again.values);
 assert.equal(d.values.length,3);assert.equal(d.values[0].xCategory,'A');assert.ok(Math.abs(d.values[0].x)<.2);
 assert.notEqual(d.values[0].x,d.values[2].x);
 const spec=scatterSpec(c,d);assert.deepEqual(spec.encoding.x.scale.domain,[-.5,1.5]);assert.equal(spec.encoding.tooltip[1].field,'xCategory');
 const codes=scatterData({...c,x:'x',xType:'category',jitter:0},res,numeric);
 assert.deepEqual(codes.values.map(p=>p.x),[0,0]);
 const missing=scatterData(c,{...res,rows:[[1,2,1,null,1]]},numeric);assert.equal(missing.skipped,1);
});
test('category ordering never changes labels or numeric Y values',()=>{
 const data={cols:['group','y'],types:['VARCHAR','DOUBLE'],rows:[['Oak',2],['Beech',3],['Oak',4]]};
 const d=scatterData({x:'group',y:['y'],categoryOrder:'alphabetical',jitter:0},data,numeric);
 assert.deepEqual(d.categories,['Beech','Oak']);assert.deepEqual(d.values.map(p=>[p.x,p.xCategory,p.y]),[[1,'Oak',2],[0,'Beech',3],[1,'Oak',4]]);
});
