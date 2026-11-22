// Deterministic screen-space packing. Y is untouched; only category offsets move.
export const BEESWARM_LIMIT=5000;
export function beeswarmEnabled(c,d){return d.categorical&&c.pointLayout==='beeswarm'&&!c.size&&!c.shape&&d.values.length<=BEESWARM_LIMIT;}
export function packBeeswarm(points,width,height,xDomain,yDomain,area=75){
 const offsets={},radius=Math.sqrt(area/Math.PI)+1,diameter=radius*2;
 const dx=xDomain[1]-xDomain[0],dy=yDomain[1]-yDomain[0];
 if(!(width>0&&height>0&&dx>0&&dy>0))return offsets;
 const half=Math.max(0,Math.min(width/dx*.42-radius,width/2));
 const step=Math.max(radius/2,half/256),slots=Math.floor(half/step),groups=new Map();
 for(const p of points){if(!groups.has(p.x))groups.set(p.x,[]);groups.get(p.x).push(p);}
 for(const rows of groups.values()){
  const grid=new Map(),cell=(x,y)=>`${Math.floor(x/diameter)},${Math.floor(y/diameter)}`;
  const clear=(x,y)=>{const gx=Math.floor(x/diameter),gy=Math.floor(y/diameter);
   for(let a=gx-1;a<=gx+1;a++)for(let b=gy-1;b<=gy+1;b++)for(const q of grid.get(`${a},${b}`)||[])
    if((q[0]-x)**2+(q[1]-y)**2<diameter**2-.001)return false;
   return true;
  };
  rows.sort((a,b)=>a.y-b.y||a.rowNumber-b.rowNumber);
  for(const p of rows){const y=(p.y-yDomain[0])/dy*height;let x=0,found=false;
   for(let i=0;i<=slots*2;i++){x=i===0?0:Math.ceil(i/2)*step*(i%2?1:-1);if(clear(x,y)){found=true;break;}}
   // Preserve every observation when the category is too dense to pack fully.
   if(!found)x=half*((Math.imul(p.rowNumber,2654435761)>>>0)/4294967295*2-1);
   offsets[p.rowNumber]=x;const key=cell(x,y);if(!grid.has(key))grid.set(key,[]);grid.get(key).push([x,y]);
  }
 }
 return offsets;
}
export function applyBeeswarm(spec,c,d,area){
 if(!beeswarmEnabled(c,d))return spec;
 spec.signals||=[];
 spec.signals.push({name:'studioSwarm',update:`studioPackBeeswarm(data('source_0'), width, height, domain('x'), domain('y'), ${area})`});
 function patch(marks){for(const mark of marks||[]){if(mark.type==='symbol'&&mark.encode?.update?.x)mark.encode.update.x={signal:"scale('x',datum.x) + (studioSwarm[datum.rowNumber] || 0)"};patch(mark.marks);}}
 patch(spec.marks);return spec;
}
