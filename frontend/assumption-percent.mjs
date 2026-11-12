/** Allocation adapter: cumulative boundaries in the chart, individual shares in saved work/output. */
export function percentageAssumption(base,config,CurveModel){
  const series=config.series, {dates,start}=base;
  if(series.some(s=>s.futureOnly))throw Error('% of total needs all series on the same timeline, including history.');
  const input=series.map(s=>base.rows(s.id));
  const shares=dates.map((date,x)=>{
    const values=input.map(rows=>rows[x].value),total=values.reduce((a,b)=>a+b,0);
    if(values.some(v=>v<0)||!Number.isFinite(total))throw Error('% of total needs non-negative values.');
    if(!total&&x<start)throw Error(`The total on ${date} is zero. Percentages are undefined; clean the historical data first.`);
    return values.map(v=>total?v/total*100:100/series.length);
  });
  const domain=base.mean.domain;
  const lines=series.slice(0,-1).map((s,i)=>({id:s.id+':future',seriesId:s.id,name:s.name,color:s.color,
    editDomain:{x:[[start,dates.length-1]]},data:Array.from({length:dates.length-domain[0]},(_,j)=>{
      const x=j+domain[0];return [x,shares[Math.max(0,x)].slice(i+1).reduce((a,b)=>a+b,0)];
    })}));
  // Retain historical samples, but leave straight future spans free for click-to-add.
  for(const line of lines)for(let i=line.data.length-2;i>0;i--){
    const [x,y]=line.data[i],a=line.data[i-1],b=line.data[i+1];
    if(x>=start&&Math.abs(y-(a[1]+(b[1]-a[1])*(x-a[0])/(b[0]-a[0])))<1e-9)line.data.splice(i,1);
  }
  const mean=new CurveModel({lines,domain,bounds:[0,100],area:true,snap:config.percentSnap??1});
  if(!Number.isFinite(mean.snap)||mean.snap<=0)throw Error('Snap increment must be greater than zero.');
  let selected=series[0].id;
  const boundaryIndex=()=>Math.min(series.findIndex(s=>s.id===selected),lines.length-1);
  const editable=mean.editable.bind(mean);
  mean.editable=(line,x,op)=>line.id===mean.lines[boundaryIndex()]?.id&&editable(line,x,op);
  const shareAt=(i,x)=>(i?mean.valueAt(mean.lines[i-1].id,x):100)-(i<mean.lines.length?mean.valueAt(mean.lines[i].id,x):0);
  mean.constrainedAddPoint=(id,x,y)=>{
    x=Math.round(x);const i=mean.lines.findIndex(l=>l.id===id),line=mean.lines[i];
    if(!line||!mean.editable(line,x,'add')||x<domain[0]||x>domain[1]||line.data.some(p=>p[0]===x))return null;
    return [x,Math.max(i+1<mean.lines.length?mean.valueAt(mean.lines[i+1].id,x):0,Math.min(i?mean.valueAt(mean.lines[i-1].id,x):100,Math.round(y/mean.snap)*mean.snap))];
  };
  const add=mean.add.bind(mean);mean.add=(id,x,y,mode='point')=>{
    const p=mean.constrainedAddPoint(id,x,y);if(!p)return add(id,x,y,mode);
    const next=structuredClone(mean.lines);next.find(l=>l.id===id).data.push(p);next.find(l=>l.id===id).data.sort((a,b)=>a[0]-b[0]);
    mean.begin('add',id);const ok=mean.apply(next);mean.commit();return ok;
  };
  return {...base,mean,percent:true,
    select(id){selected=id;},
    setMonotonicity(){throw Error('Allocation boundaries keep shares within 0–100%; monotonicity is available for value charts.');},
    setShare(id,x,value){
      const i=series.findIndex(s=>s.id===id),bi=Math.min(i,mean.lines.length-1);
      if(!Number.isFinite(value)||value<0||value>100)throw Error('Enter a percentage between 0 and 100.');
      if(bi<0){if(value!==100)throw Error('A single series owns 100%. Add another series to allocate it.');return;}
      const previous=i?mean.valueAt(mean.lines[i-1].id,x):100;
      const y=i===series.length-1?value:previous-value;
      const high=bi?mean.valueAt(mean.lines[bi-1].id,x):100,low=bi+1<mean.lines.length?mean.valueAt(mean.lines[bi+1].id,x):0;
      if(y<low-1e-8||y>high+1e-8)throw Error('That share exceeds the amount available from its neighboring series.');
      const next=structuredClone(mean.lines),line=next[bi],p=line.data.find(p=>p[0]===x);
      if(p)p[1]=y;else{line.data.push([x,y]);line.data.sort((a,b)=>a[0]-b[0]);}
      mean.begin('exact',line.id);const ok=mean.apply(next);mean.commit();if(!ok)throw Error('This period cannot be edited.');
    },
    bands(x){return series.map((s,i)=>({name:config.series[i].name,color:s.color,high:i?mean.valueAt(mean.lines[i-1].id,x):100,low:i<mean.lines.length?mean.valueAt(mean.lines[i].id,x):0}));},
    save(){return {chartType:'percent',series:series.map((s,i)=>({...config.series[i],monotonicity:'none',points:dates.slice(start).map((date,j)=>[date,shareAt(i,j+start)])}))};},
    rows(id){return series.flatMap((s,i)=>id&&id!==s.id?[]:dates.map((date,x)=>({series:config.series[i].name,date,value:shareAt(i,x),segment:x<start?'actual':'future'})));}
  };
}
