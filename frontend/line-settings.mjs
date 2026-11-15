// Explicit choices override count-based defaults, without rewriting saved configs.
export function lineSettings(c,count){
 const legend=['inline','list','strip'].includes(c.seriesLegend)?c.seriesLegend:count>8?'strip':'inline';
 const hover=['all','selected'].includes(c.hoverBehavior)?c.hoverBehavior:count>8?'selected':'all';
 return {legend,hover};
}
