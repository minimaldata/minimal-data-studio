// Keep scales on the full result; only marks consume the current window.
export const SCATTER_POINT_LIMIT=500_000;
export const SCATTER_INSPECT_LIMIT=5_000;
export const scatterRenderer=count=>count>SCATTER_INSPECT_LIMIT?'canvas':'svg';
export function applyScatterDetail(spec){
  const mark=spec.marks.find(m=>m.type==='symbol');
  if(!mark)return;
  const source=mark.from.data;
  spec.data.push({name:'studioVisible',source,transform:[{type:'filter',expr:'datum.x >= studioXDomain[0] && datum.x <= studioXDomain[1] && datum.y >= studioYDomain[0] && datum.y <= studioYDomain[1]'}]});
  spec.signals.push({name:'studioVisibleCount',update:"length(data('studioVisible'))"});
  spec.data.push({name:'studioDetail',source:'studioVisible',transform:[{type:'filter',expr:`studioVisibleCount <= ${SCATTER_INSPECT_LIMIT}`}]});
  spec.data.push({name:'studioOverview',source:'studioVisible',transform:[{type:'filter',expr:`studioVisibleCount > ${SCATTER_INSPECT_LIMIT}`}]});
  const overview=structuredClone(mark);overview.name='studioOverviewMarks';overview.from={data:'studioOverview'};overview.interactive=false;
  delete overview.encode.update.tooltip;
  mark.from={data:'studioDetail'};
  spec.marks.splice(spec.marks.indexOf(mark),0,overview);
}
export function inspectionMessage(count,total){
  return `${count.toLocaleString()} of ${total.toLocaleString()} points in view · `+(count>SCATTER_INSPECT_LIMIT?'Zoom in to inspect individual points':count?'Hover over a point to identify it.':'No points in this window.');
}
