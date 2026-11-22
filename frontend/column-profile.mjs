const missing=value=>value===null||value===undefined;
export function profileColumn(values,kind='text'){
 const counts=new Map();let nulls=0,empty=0,whitespace=0,padded=0;
 for(const value of values){
  if(missing(value)){nulls++;continue;}
  if(value==='')empty++;
  if(typeof value==='string'&&value!==''&&!value.trim())whitespace++;
  if(typeof value==='string'&&value!==value.trim())padded++;
  const key=typeof value+':'+String(value),entry=counts.get(key);
  if(entry)entry.count++;else counts.set(key,{key,value,count:1});
 }
 const present=values.length-nulls,frequencies=[...counts.values()].sort((a,b)=>b.count-a.count);
 if(nulls)frequencies.push({key:'null',value:null,count:nulls});
 const result={kind,total:values.length,nulls,present,distinct:counts.size,uniqueness:present?counts.size/present:null,empty,whitespace,padded,frequencies};
 if(kind==='number'||kind==='date'){
  const numeric=values.filter(v=>!missing(v)&&v!=='').map(v=>kind==='date'?Date.parse(v):Number(v)).filter(Number.isFinite).sort((a,b)=>a-b);
  result.valid=numeric.length;result.invalid=present-numeric.length;
  const quantile=p=>{const i=(numeric.length-1)*p,lo=Math.floor(i),f=i-lo;return numeric[lo]*(1-f)+(numeric[Math.ceil(i)]??numeric[lo])*f;};
  if(numeric.length){
   const min=numeric[0],max=numeric.at(-1);result.min=min;result.max=max;
   if(kind==='number'){result.q1=quantile(.25);result.median=quantile(.5);result.q3=quantile(.75);result.mean=numeric.reduce((sum,v)=>sum+v/numeric.length,0);}
   const size=min===max?1:Math.min(12,Math.ceil(Math.sqrt(numeric.length))),step=(max-min)/size;
   result.bins=Array.from({length:size},(_,i)=>({start:min+i*step,end:i===size-1?max:min+(i+1)*step,count:0}));
   for(const v of numeric)result.bins[step?Math.min(size-1,Math.floor((v-min)/step)):0].count++;
  }else result.bins=[];
 }
 return result;
}
