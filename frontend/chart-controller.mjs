// Screen rendering lifecycle. Data preparation, chart specs and saved settings live
// outside this module. Callers own the returned view and finalize it on replacement.
import {beeswarmEnabled} from './scatter-beeswarm.mjs';
import {applyScatterViewport} from './scatter-viewport.mjs';
import {mountChartNavigation,chartNavigationPolicy} from './chart-navigation.mjs';
import {applyScatterInteraction} from './scatter-chart.mjs';
import {scatterRenderer,applyScatterDetail,inspectionMessage} from './scatter-detail.mjs';
import {createScatterTooltip} from './scatter-tooltip.mjs';
import {deferChartResize,observeSettledChartResize} from './chart-resize.mjs';

export async function embedChartView(embed,plot,spec,options,tooltips=[]){
 let view;
 try {
  ({view}=await embed(plot,spec,{mode:'vega',actions:false,...options}));
  for(const tooltip of tooltips)tooltip?.attach(view);
  return view;
 } catch(error){
  // Partially mounted views and tooltips must not survive a failed render.
  view?.finalize();for(const tooltip of tooltips)tooltip?.dispose();throw error;
 }
}
export function mountChartControls(host,plot,view,viewport,tooltip,config){
 mountChartNavigation(host,plot,view,viewport,tooltip,chartNavigationPolicy(config.type,config));
}
export async function renderScatterView({embed,plot,note,focus,spec,config,data,outline}){
 const viewport=applyScatterViewport(spec,config,data);
 applyScatterDetail(spec);applyScatterInteraction(spec,outline);
 const renderer=scatterRenderer(data.values.length),deferredResize=renderer==='canvas'||beeswarmEnabled(config,data);
 if(deferredResize)deferChartResize(spec);
 const tooltip=createScatterTooltip(plot);
 const view=await embedChartView(embed,plot,spec,{renderer,tooltip:tooltip.handler},[tooltip]);
 const describe=()=>data.categorical&&(config.boxOverlay||config.violinOverlay)&&config.boxPoints==='none'?'Points hidden · Hover over a distribution or sample count for statistics':inspectionMessage(view.signal('studioVisibleCount'),data.values.length)+(data.categorical&&(config.boxOverlay||config.violinOverlay)&&config.boxPoints==='outliers'?' · Showing outliers only':'');
 focus.textContent=describe();
 view.addSignalListener('studioVisibleCount',()=>{tooltip.clear();focus.textContent=describe();});
 view.addSignalListener('studioHovered',(_,point)=>{focus.textContent=point?[
  `Row ${point.rowNumber}`,point.label,`${config.x}: ${point.xCategory??point.x}`,`${config.y[0]}: ${point.y}`,
  ...['size','shape','color','brightness'].filter(k=>config[k]).map(k=>`${config[k]} (${k}): ${point[k]??'missing'}`)
 ].filter(Boolean).join(' · '):describe();});
 mountChartControls(note,plot,view,viewport,tooltip,config);
 if(deferredResize)observeSettledChartResize(plot,view,tooltip);
 return view;
}
