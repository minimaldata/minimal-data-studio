import test from 'node:test';
import assert from 'node:assert/strict';
import {applyScatterDetail,scatterRenderer,inspectionMessage,SCATTER_POINT_LIMIT} from '../frontend/scatter-detail.mjs';
import {numericExtent,scatterSpec,applyScatterBrightness,applyScatterInteraction} from '../frontend/scatter-chart.mjs';
test('overview disables mark interaction and filters marks without changing scale domains',()=>{
 const spec={data:[{name:'full'}],signals:[],scales:[{name:'color',domain:{data:'full',field:'color'}}],marks:[{name:'points',type:'symbol',from:{data:'full'},encode:{update:{fill:{value:'red'},tooltip:{signal:'datum'}}}}]};
 const scales=structuredClone(spec.scales);applyScatterDetail(spec);applyScatterInteraction(spec,'black');
 assert.deepEqual(spec.scales,scales);assert.equal(spec.marks[0].interactive,false);assert.equal(spec.marks[0].encode.update.tooltip,undefined);assert.equal(spec.marks[0].encode.update.stroke,undefined);
 assert.equal(spec.marks[1].from.data,'studioDetail');assert.ok(spec.data.find(d=>d.name==='studioVisible').transform[0].expr.includes('studioYDomain'));
 assert.equal(scatterRenderer(5000),'svg');assert.equal(scatterRenderer(5001),'canvas');assert.match(inspectionMessage(5001,10000),/Zoom in/);assert.match(inspectionMessage(5000,10000),/Hover/);
});
test('half-million-point extents and brightness avoid spread argument limits',()=>{
 const values=Array.from({length:SCATTER_POINT_LIMIT},(_,i)=>({x:i,y:-i,brightness:i}));
 assert.deepEqual(numericExtent(values,'x'),[0,499999]);
 const d={values},c={type:'scatter',x:'x',y:['y'],brightness:'value'};
 assert.ok(scatterSpec(c,d).encoding.x.scale.domain[1]>499999);
 const spec={marks:[]};applyScatterBrightness(spec,c,d);assert.deepEqual(spec.scales[0].domain,[0,499999]);
});
