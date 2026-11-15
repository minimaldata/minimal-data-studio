import test from 'node:test';import assert from 'node:assert/strict';
import {categoryMapping,resolveMapping} from '../frontend/scatter-mappings.mjs';
import {scatterSpec,applyScatterBrightness} from '../frontend/scatter-chart.mjs';
test('category overrides follow values and columns, including unusual category names',()=>{
 const d={values:[{color:'B',shape:'B'},{color:'A',shape:'A'},{color:'__proto__',shape:'__proto__'}]},c={color:'group',shape:'group',categoryStyles:JSON.parse('{"color":{"group":{"A":"#ff0000","__proto__":"#00ff00"}},"shape":{"group":{"B":"diamond"}}}')};
 const colors=categoryMapping(c,d,'color',['#111111','#222222']);assert.equal(colors.range[colors.domain.indexOf('A')],'#ff0000');assert.equal(colors.range[colors.domain.indexOf('__proto__')],'#00ff00');
 const shapes=categoryMapping(c,d,'shape',[]);assert.equal(shapes.range[shapes.domain.indexOf('B')],'diamond');
 assert.notEqual(categoryMapping({...c,color:'different'},d,'color',['#111111']).range[0],'#ff0000');
});
test('numeric rules clamp with stable domains, reverse output, and respect selected columns',()=>{
 const c={type:'scatter',x:'x',y:['y'],size:'weight',brightness:'score',scatterRules:{size:{field:'weight',inputMin:10,inputMax:20,outputMin:40,outputMax:400,reverse:true},brightness:{field:'score',inputMin:0,inputMax:100,outputMin:10,outputMax:90,reverse:true}}};
 const d={values:[{x:1,y:2,size:5,brightness:30},{x:2,y:3,size:50,brightness:70}]};
 const spec=scatterSpec(c,d);assert.deepEqual(spec.encoding.size.scale.domain,[10,20]);assert.deepEqual(spec.encoding.size.scale.range,[400,40]);assert.equal(spec.encoding.size.scale.clamp,true);
 const vg={marks:[{type:'symbol',encode:{update:{fill:{value:'red'}}}}]};applyScatterBrightness(vg,c,d);assert.match(vg.marks[0].encode.update.fill.signal,/0.9 \+ \(-0.8\)/);assert.deepEqual(vg.scales[0].domain,[0,100]);
 assert.deepEqual(resolveMapping({...c,size:'other'},d,'size').range,[20,700]);
});

test('lightness preview preserves hue and saturation, reverses endpoints, rejects invalid ranges',async()=>{
 const {lightnessPreview}=await import('../frontend/scatter-mappings.mjs');
 assert.equal(lightnessPreview('#ff0000',28,72).background,'linear-gradient(to right, hsl(0, 100%, 28%), hsl(0, 100%, 72%))');
 assert.deepEqual(lightnessPreview('#008000',20,80,true).range,[80,20]);assert.match(lightnessPreview('#888888',0,100).background,/0%, 0%/);
 for(const [min,max] of [[-1,50],[10,101],[70,20],[50,50],[NaN,70]])assert.equal(lightnessPreview('#ff0000',min,max),null);
});
