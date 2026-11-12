import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createAssumption,defaultAssumption,historyRows,futureDate,applyAxis,automaticSnap,createAssumptionSet,assumptionSeries,migrateValueSeries} from '../frontend/assumption-model.mjs';
const {CurveModel}=createRequire(import.meta.url)('../frontend/vendor/napkin/model.js');
const history=[['2026-10-01',10],['2026-11-01',20]];
test('history remains fixed while future controls interpolate and undo',()=>{
  const m=createAssumption({...defaultAssumption(),points:[['2027-02-01',50]]},history,CurveModel);
  assert.deepEqual(m.rows().map(r=>r.value),[10,20,30,40,50]);
  m.mean.begin('move','future');assert.equal(m.mean.move('future',0,1,99),false);m.mean.cancel();
  m.mean.add('future',2,25);assert.equal(m.rows()[2].value,25);m.mean.undo();assert.equal(m.rows()[2].value,30);
  assert.equal(m.rows()[0].segment,'actual');assert.equal(m.rows()[0].sd,null);
});
test('normal parameters, invalid data and calendar limits are explicit',()=>{
  const config={...defaultAssumption(),mode:'normal',spread:[['2027-02-01',5]]};
  const m=createAssumption(config,history,CurveModel);
  assert.equal(m.rows().at(-1).sd,5);assert.equal(m.rows().at(-1).distribution,'normal');
  assert.equal(futureDate('2028-01-31',1,'month'),'2028-02-29');
  assert.throws(()=>historyRows([['2026-02-30',1],['2026-03-01',2]]),/valid/);
  assert.throws(()=>historyRows([history[0],history[0]]),/duplicate/);
  assert.throws(()=>createAssumption({...config,spread:[['2027-02-01',-1]]},history,CurveModel),/negative/);
  assert.throws(()=>createAssumption({...config,horizon:121},history,CurveModel),/120/);
});
test('refresh promotes new actuals and preserves future assumptions by date',()=>{
  const config={...defaultAssumption(),points:[['2026-12-01',30],['2027-01-01',40],['2027-02-01',50]]};
  const m=createAssumption(config,[...history,['2026-12-01',33]],CurveModel);
  assert.equal(m.rows()[2].value,33);assert.equal(m.rows()[2].segment,'actual');
  assert.equal(m.rows()[3].value,40);assert.equal(m.rows().at(-1).value,50);
  assert.deepEqual(m.save().points,[['2027-01-01',40],['2027-02-01',50],['2027-03-01',50]]);
});

test('date ranges need no history, include start date and preserve exact parameters',()=>{
  const c={...defaultAssumption(),basis:'range',startDate:'2028-01-31',horizon:3,points:[['2028-01-31',10],['2028-03-31',30]]};
  const m=createAssumption(c,[],CurveModel);
  assert.deepEqual(m.dates,['2028-01-31','2028-02-29','2028-03-31']);
  assert.deepEqual(m.rows().map(r=>r.value),[10,20,30]);
  assert(m.rows().every(r=>r.segment==='future'));assert.equal(m.mean.lines.length,1);
  m.mean.begin('move','future');assert(m.mean.move('future',0,0,15));m.mean.commit();assert.equal(m.rows()[0].value,15);
  const single=createAssumption({...c,horizon:1},[],CurveModel);
  single.mean.begin('move','future');assert(single.mean.move('future',1,0,25));single.mean.commit();
  assert.equal(single.rows().length,1);assert.equal(single.rows()[0].value,25);
  assert.deepEqual(single.save().points,[['2028-01-31',25]]);
  const daily=createAssumption({...c,grain:'day'},[],CurveModel);assert.equal(daily.dates[1],'2028-02-01');
});
test('axis settings and ECharts-style snapping validate without changing data',()=>{
  assert.equal(automaticSnap(0,100),5);assert.equal(automaticSnap(0,10),.5);assert.equal(automaticSnap(0,1),.05);
  const m=createAssumption({...defaultAssumption(),basis:'range',startDate:'2026-01-01'},[],CurveModel);
  assert.deepEqual(m.mean.bounds,[0,100]);assert.equal(m.mean.snap,5);
  applyAxis(m.mean,{min:-20,max:200,snap:.5});
  m.mean.begin('move','future');m.mean.move('future',1,2,7.3);m.mean.commit();assert.equal(m.rows()[2].value,7.5);
  const before=m.rows();assert.throws(()=>applyAxis(m.mean,{min:10,max:1}),/less/);
  assert.throws(()=>applyAxis(m.mean,{snap:0}),/greater/);
  assert.throws(()=>applyAxis(m.mean,{min:0,max:1}),/include/);assert.deepEqual(m.rows(),before);
  assert.throws(()=>applyAxis(m.spread,{min:-1,max:10},{spread:true}),/zero/);
});

test('yearly periods preserve the anchor date across leap years',()=>{
  const c={...defaultAssumption(),basis:'range',grain:'year',startDate:'2028-02-29',horizon:5};
  const m=createAssumption(c,[],CurveModel);
  assert.deepEqual(m.dates,['2028-02-29','2029-02-28','2030-02-28','2031-02-28','2032-02-29']);
  const h=createAssumption({...c,basis:'history',horizon:1},[['2027-02-28',10],['2028-02-29',20]],CurveModel);
  assert.equal(h.dates.at(-1),'2029-02-28');assert.equal(h.rows().at(-1).value,20);
});

test('multiple series share dates, isolate edits and export named parameters',()=>{
  const c={...defaultAssumption(),basis:'range',startDate:'2026-01-01',series:[
    {id:'a',name:'Rainfall',color:'#478bf5',mode:'normal',points:[['2026-01-01',10],['2026-03-01',20]],spread:[['2026-03-01',2]]},
    {id:'b',name:'Temperature',color:'#e7a447',mode:'values',points:[['2026-01-01',5],['2026-03-01',15]],spread:[]}
  ]};
  const m=createAssumptionSet(c,{},CurveModel);
  assert.equal(m.rows().length,6);assert.deepEqual(m.rows('a').map(r=>r.value),[10,15,20]);
  assert.equal(m.rows('b')[0].series,'Temperature');assert.equal(m.rows('b')[0].sd,null);
  m.mean.begin('move','b:future');assert.equal(m.mean.move('b:future',1,2,30),false);m.mean.cancel();
  m.select('b');m.mean.begin('move','b:future');assert(m.mean.move('b:future',1,2,30));m.mean.commit();
  assert.equal(m.rows('b').at(-1).value,30);assert.equal(m.rows('a').at(-1).value,20);
  m.select('a');m.mean.undo();assert.equal(m.rows('b').at(-1).value,15);
  assert.equal(m.mean.editable(m.mean.lines.find(l=>l.id==='b:future'),2),false);
  c.series[0].name='Precipitation';assert.equal(m.save().series[0].name,'Precipitation');
  const restored=createAssumptionSet({...c,...m.save()},{},CurveModel);assert.equal(restored.rows()[0].series,'Precipitation');
  assert.throws(()=>assumptionSeries({...c,series:[c.series[0],{...c.series[1],name:'precipitation'}]}),/unique name/);
});
test('legacy assumptions become one series; historical series share a fixed timeline',()=>{
  const c={...defaultAssumption(),source:'history',valueColumn:'value'};
  const legacy=createAssumptionSet(c,{series1:history},CurveModel);
  assert.equal(legacy.rows().length,5);assert.equal(legacy.rows()[0].series,'Series 1');
  const series=assumptionSeries(c);const config={...c,series:[...series,{...series[0],id:'other',name:'Other'}]};
  const m=createAssumptionSet(config,{series1:history,other:history.map(([d,v])=>[d,v*2])},CurveModel);
  assert.equal(m.rows('other')[0].value,20);
  m.select('other');m.mean.begin('move','other:actual');assert.equal(m.mean.move('other:actual',0,0,99),false);m.mean.cancel();
  assert.throws(()=>createAssumptionSet(config,{series1:history,other:[['2026-09-01',1],['2026-11-01',2]]},CurveModel),/same historical dates/);
});

test('monotonicity is per series and rejects conflicting edits without changing points',()=>{
  const c={...defaultAssumption(),basis:'range',startDate:'2026-01-01',series:[
    {id:'a',name:'Growing',color:'#478bf5',mode:'normal',points:[['2026-01-01',0],['2026-02-01',10],['2026-03-01',20]],spread:[['2026-01-01',3],['2026-03-01',1]],monotonicity:'ascending',spreadMonotonicity:'descending'},
    {id:'b',name:'Free',color:'#e7a447',mode:'values',points:[['2026-01-01',20],['2026-03-01',0]],spread:[]}
  ]};
  const m=createAssumptionSet(c,{},CurveModel);
  m.mean.begin('exact','a:future');assert.equal(m.mean.move('a:future',1,1,30,{snapY:false}),false);m.mean.commit();
  assert.deepEqual(m.rows('a').map(r=>r.value),[0,10,20]);
  assert.throws(()=>m.setMonotonicity('a','descending'),/Existing points/);assert.equal(c.series[0].monotonicity,'ascending');
  m.spread.begin('exact','a:sd');assert.equal(m.spread.move('a:sd',1,2,4,{snapY:false}),false);m.spread.cancel();
  m.select('b');m.mean.begin('move','b:future');assert(m.mean.move('b:future',1,2,40));m.mean.commit();
  m.setMonotonicity('b','ascending');m.mean.undo();assert.equal(m.rows('b').at(-1).value,40);
  const restored=createAssumptionSet({...c,...m.save()},{},CurveModel);assert.equal(restored.series[0].monotonicity,'ascending');
});
test('monotonicity protects the history-to-future boundary, not historical variation',()=>{
  const c={...defaultAssumption(),series:[{id:'a',name:'Growth',color:'#478bf5',mode:'values',points:[['2027-02-01',30]],spread:[],monotonicity:'ascending'}]};
  const m=createAssumptionSet(c,{a:[['2026-09-01',50],['2026-10-01',10],['2026-11-01',20]]},CurveModel);
  assert.equal(m.rows()[0].value,50);
  m.mean.begin('exact','a:future');assert.equal(m.mean.move('a:future',1,5,15,{snapY:false}),false);m.mean.cancel();
});

test('dragging clamps at monotonic neighbors after snapping, including spread and history anchors',()=>{
  const c={...defaultAssumption(),basis:'range',startDate:'2026-01-01',series:[{id:'a',name:'A',color:'#478bf5',mode:'normal',monotonicity:'ascending',spreadMonotonicity:'descending',points:[['2026-01-01',7.3],['2026-02-01',10],['2026-03-01',12.7]],spread:[['2026-01-01',3],['2026-02-01',2],['2026-03-01',1]]}]};
  const m=createAssumptionSet(c,{},CurveModel),errors=[];m.mean.on(e=>{if(e.type==='editRejected')errors.push(e);});m.mean.snap=5;
  m.mean.begin('move','a:future');assert(m.mean.move('a:future',1,1,50));assert.equal(m.rows()[1].value,12.7);
  assert(m.mean.move('a:future',1,1,-50));assert.equal(m.rows()[1].value,7.3);m.mean.commit();assert.deepEqual(errors,[]);
  m.mean.undo();assert.equal(m.rows()[1].value,10);
  m.spread.begin('move','a:sd');assert(m.spread.move('a:sd',1,1,10,{snapY:false}));assert.equal(m.rows()[1].sd,3);
  assert(m.spread.move('a:sd',1,1,-1));assert.equal(m.rows()[1].sd,1);m.spread.commit();
  const h=createAssumptionSet({...c,basis:'history',series:[{...c.series[0],points:[],spread:[]}]},{a:history},CurveModel);
  h.mean.begin('move','a:future');assert(h.mean.move('a:future',1,4,-100));assert.equal(h.rows().at(-1).value,20);h.mean.commit();
});

test('click additions clamp after snapping and keep real control points',()=>{
  const c={...defaultAssumption(),basis:'range',startDate:'2026-01-01',series:[{id:'a',name:'A',color:'#478bf5',mode:'normal',monotonicity:'ascending',spreadMonotonicity:'descending',points:[['2026-01-01',7.3],['2026-03-01',12.7]],spread:[['2026-01-01',3.3],['2026-03-01',1.2]]}]};
  const m=createAssumptionSet(c,{},CurveModel),errors=[];
  for(const curve of [m.mean,m.spread])curve.on(e=>{if(e.type==='editRejected')errors.push(e);});
  m.mean.snap=5;
  assert.deepEqual(m.mean.constrainedAddPoint('a:future',1,100),[1,12.7]);
  assert(m.mean.add('a:future',1,100));assert.equal(m.rows()[1].value,12.7);assert.equal(m.save().series[0].points.length,3);
  m.mean.undo();assert(m.mean.add('a:future',1,-10));assert.equal(m.rows()[1].value,7.3);
  m.spread.snap=1;assert(m.spread.add('a:sd',1,10));assert.equal(m.rows()[1].sd,3.3);
  m.spread.undo();assert(m.spread.add('a:sd',1,-10));assert(Math.abs(m.rows()[1].sd-1.2)<1e-12);assert.equal(m.save().series[0].spread.find(p=>p[0]==='2026-02-01')[1],1.2);
  assert.deepEqual(errors,[]);
});

test('legacy Normal inputs become ordinary mean and SD series without fabricating SD history',()=>{
  for(const basis of ['range','history']){
    const c={...defaultAssumption(),basis,startDate:'2026-12-01',mode:'normal',points:[['2027-02-01',50]],spread:[['2026-12-01',2],['2027-02-01',8]],meanAxis:{min:5,max:100}};
    const oldRows=createAssumption(c,basis==='range'?[]:history,CurveModel).rows();
    assert(migrateValueSeries(c));assert.equal(c.series.length,2);assert(c.series.every(s=>s.mode==='values'));
    const histories=Object.fromEntries(c.series.map(s=>[s.id,basis==='range'?[]:history]));
    const next=createAssumptionSet(c,histories,CurveModel);
    assert.deepEqual(next.rows(c.series[0].id).map(r=>r.value),oldRows.map(r=>r.value));
    const sd=next.rows(c.series[1].id);
    assert.deepEqual(sd.map(r=>r.value),oldRows.filter(r=>r.segment==='future').map(r=>r.sd));
    assert(sd.every(r=>r.segment==='future'));
    assert.equal(migrateValueSeries(c),false);assert.equal(c.series.length,2);
    assert.equal(createAssumptionSet({...c,...next.save()},histories,CurveModel).rows().length,next.rows().length);
  }
});

test('percentage allocation conserves totals, clamps dragging, restores and persists shares',async()=>{
  const {percentageAssumption}=await import('../frontend/assumption-percent.mjs');
  const config={...defaultAssumption(),basis:'range',startDate:'2026-01-01',chartType:'percent',series:[30,20,50].map((v,i)=>({id:String(i),name:'Share '+i,color:'#478bf5',mode:'values',points:[['2026-01-01',v]],spread:[]}))};
  const build=()=>percentageAssumption(createAssumptionSet(config,{},CurveModel),config,CurveModel);
  const m=build();m.select('0');m.setShare('0',1,40);
  assert.deepEqual(m.rows().filter(r=>r.date==='2026-02-01').map(r=>r.value),[40,10,50]);
  assert.throws(()=>m.setShare('0',1,80),/neighboring/);
  m.mean.undo();assert.equal(m.rows('0')[1].value,30);m.mean.redo();
  m.mean.begin('move','0:future');m.mean.move('0:future',1,1,-100);m.mean.commit();
  for(const date of m.dates){const rows=m.rows().filter(r=>r.date===date);assert.ok(rows.every(r=>r.value>=0));assert.ok(Math.abs(rows.reduce((a,r)=>a+r.value,0)-100)<1e-8);}
  Object.assign(config,m.save());assert.deepEqual(build().rows(),m.rows());
  m.select('2');m.setShare('2',2,25);assert.equal(m.rows('2')[2].value,25);
});

test('percentage history is fixed and zero/negative source totals are explained',async()=>{
  const {percentageAssumption}=await import('../frontend/assumption-percent.mjs');
  const config={...defaultAssumption(),series:[0,1].map(i=>({id:String(i),name:'Share '+i,color:'#478bf5',mode:'values',points:[],spread:[]}))};
  const histories={'0':history,'1':history};const m=percentageAssumption(createAssumptionSet(config,histories,CurveModel),config,CurveModel);
  assert.equal(m.rows('0')[0].value,50);m.mean.begin('move','0:future');assert.equal(m.mean.move('0:future',0,0,90),false);m.mean.cancel();
  const zero={'0':history.map(([d])=>[d,0]),'1':history.map(([d])=>[d,0])};assert.throws(()=>percentageAssumption(createAssumptionSet(config,zero,CurveModel),config,CurveModel),/zero/);
});
