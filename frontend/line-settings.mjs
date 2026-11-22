import {resolveSeriesKind} from './line-series.mjs';
// Shared by line, bar, stacked bar, and percent charts. Saved overrides win.
export function legendStyle(c,series){
 if(['inline','list','strip'].includes(c.seriesLegend))return c.seriesLegend;
 if(series.length<=1)return 'inline';
 if(resolveSeriesKind(c.seriesKind,series)==='cohorts')return 'strip';
 return series.length>8?'list':'inline';
}
export function lineSettings(c,series){
 const count=Array.isArray(series)?series.length:series;
 const names=Array.isArray(series)?series:Array.from({length:count},(_,i)=>String(i));
 const hover=['all','selected'].includes(c.hoverBehavior)?c.hoverBehavior:count>8?'selected':'all';
 return {legend:legendStyle(c,names),hover};
}
