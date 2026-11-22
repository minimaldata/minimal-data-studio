// Binned Gaussian KDE bounds work per category, even for large loaded results.
// Density is clipped to observed values; equal maximum widths compare shapes, not n.
export function violinData(points,boxes){
 const groups=new Map();for(const p of points){if(!groups.has(p.xCategory))groups.set(p.xCategory,[]);groups.get(p.xCategory).push(p.y);}
 const samples=[],sparse=[];
 for(const b of boxes){
  const values=groups.get(b.category)||[];if(!values.length)continue;
  let low=Infinity,high=-Infinity,mean=0,m2=0,n=0;
  for(const value of values){low=Math.min(low,value);high=Math.max(high,value);n++;const delta=value-mean;mean+=delta/n;m2+=delta*(value-mean);}
  if(n<3||low===high){sparse.push({category:b.category,x:b.x,n,low,high,reason:n<3?'Too few observations for density':'All values are equal'});continue;}
  const sd=Math.sqrt(m2/(n-1)),iqr=(b.q3-b.q1)/1.34;
  const bandwidth=Math.max(.9*Math.min(sd,iqr>0?iqr:sd)*n**(-.2),(high-low)/256);
  const bins=new Float64Array(128),step=(high-low)/127;
  for(const value of values)bins[Math.min(127,Math.round((value-low)/step))]++;
  const curve=[];let peak=0;
  for(let i=0;i<=96;i++){
   const y=low+(high-low)*i/96;let density=0;
   for(let j=0;j<128;j++){const z=(y-(low+j*step))/bandwidth;if(Math.abs(z)<5)density+=bins[j]*Math.exp(-.5*z*z);}
   peak=Math.max(peak,density);curve.push({category:b.category,x:b.x,n,y,density,bandwidth});
  }
  for(const p of curve){p.halfWidth=peak?p.density/peak*.4:0;samples.push(p);}
 }
 return {samples,sparse};
}
export function applyViolin(spec,c,d){
 if(!d.categorical||!c.violinOverlay)return spec;
 const {samples,sparse}=violinData(d.values,d.boxes),color=spec.config?.axis?.titleColor||'#888';
 spec.data.push({name:'studioViolin',values:samples},{name:'studioViolinSparse',values:sparse});
 const tooltip={signal:"{'Category':datum.category,'Observations':datum.n,'Density':'Smoothed shape; equal maximum width per category','Bandwidth':datum.bandwidth}"};
 spec.marks.unshift({name:'studioViolinGroups',type:'group',clip:true,encode:{update:{width:{signal:'width'},height:{signal:'height'}}},from:{facet:{name:'studioViolinCategory',data:'studioViolin',groupby:'category'}},marks:[{
  name:'studioViolinArea',type:'area',from:{data:'studioViolinCategory'},sort:{field:'datum.y'},encode:{update:{orient:{value:'horizontal'},x:{signal:"scale('x',datum.x-datum.halfWidth)"},x2:{signal:"scale('x',datum.x+datum.halfWidth)"},y:{scale:'y',field:'y'},fill:{value:color},fillOpacity:{value:.16},stroke:{value:color},strokeOpacity:{value:.6},strokeWidth:{value:1},tooltip}}
 }]},{name:'studioViolinSparseMarks',type:'rule',clip:true,from:{data:'studioViolinSparse'},encode:{update:{x:{signal:"scale('x',datum.x-.12)"},x2:{signal:"scale('x',datum.x+.12)"},y:{scale:'y',field:'low'},y2:{scale:'y',field:'high'},stroke:{value:color},strokeWidth:{value:2},tooltip:{signal:"{'Category':datum.category,'Observations':datum.n,'Note':datum.reason}"}}}});
 return spec;
}
