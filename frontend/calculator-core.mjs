// Deliberately small arithmetic grammar: never evaluate JavaScript or SQL.
export function calculate(source,snapshots=[]){
 if(typeof source!=='string'||source.length>2000)throw Error('Keep calculations under 2,000 characters.');
 const tokens=source.match(/\$\d+|(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|[()+\-*/^%]|\S/gi)||[];let at=0,depth=0;
 const finite=n=>{if(!Number.isFinite(n))throw Error('The result is not a finite number.');return n;};
 const primary=()=>{if(++depth>100)throw Error('Too many nested expressions.');let n,t=tokens[at++];
  if(t==='('){n=sum();if(tokens[at++]!==')')throw Error('Close the parentheses.');}
  else if(/^\$\d+$/.test(t||'')){const item=snapshots.find(s=>s.id===t);if(!item)throw Error(`Unknown snapshot ${t}.`);n=item.value;}
  else if(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(t||''))n=Number(t);
  else throw Error('Enter a number, snapshot, or parentheses.');
  while(tokens[at]==='%'){at++;n/=100;}depth--;return finite(n);
 };
 const power=()=>{const n=primary();return tokens[at]==='^'?(at++,finite(n**unary())):n;};
 const unary=()=>{if(tokens[at]==='+'||tokens[at]==='-'){if(++depth>100)throw Error('Too many operators.');const sign=tokens[at++];const n=unary();depth--;return sign==='-'?-n:n;}return power();};
 const product=()=>{let n=unary();while(['*','/'].includes(tokens[at])){const op=tokens[at++],b=unary();if(op==='/'&&b===0)throw Error('Cannot divide by zero.');n=finite(op==='*'?n*b:n/b);}return n;};
 const sum=()=>{let n=product();while(['+','-'].includes(tokens[at])){const op=tokens[at++],b=product();n=finite(op==='+'?n+b:n-b);}return n;};
 const result=sum();if(at!==tokens.length)throw Error('Add an operator between values.');return result;
}
export function numericValue(value,numeric=true){
 if(!numeric||value===null||value===undefined||value==='')return null;
 const n=Number(value);return Number.isFinite(n)&&(!Number.isInteger(n)||Number.isSafeInteger(n))?n:null;
}
export function selectionStats(items){
 const values=items.map(i=>i.value).filter(Number.isFinite);let sum=0,correction=0;
 const present=items.map(i=>Object.hasOwn(i,'raw')?i.raw:i.value).filter(v=>v!==null&&v!==undefined);
 const distinct=new Set(present.map(v=>typeof v+':'+(typeof v==='object'?JSON.stringify(v,(_,x)=>typeof x==='bigint'?String(x):x):String(v))));
 for(const n of values){const y=n-correction,t=sum+y;correction=(t-sum)-y;sum=t;}
 const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);
 const median=sorted.length?(sorted.length%2?sorted[middle]:sorted[middle-1]/2+sorted[middle]/2):null;
 return {nonNullCount:present.length,distinctCount:distinct.size,count:values.length,skipped:items.length-values.length,sum,average:values.length?sum/values.length:null,median,min:sorted.length?sorted[0]:null,max:sorted.length?sorted[sorted.length-1]:null};
}
export function cleanCalculatorState(raw){
 const snapshots=(Array.isArray(raw?.snapshots)?raw.snapshots:[]).filter(s=>/^\$\d+$/.test(s?.id)&&Number.isFinite(s.value)&&typeof s.label==='string').map(s=>({id:s.id,value:s.value,label:s.label.slice(0,300),detail:String(s.detail||'').slice(0,500),time:String(s.time||'')}));
 return {version:1,inputDecimals:decimalPlaces(raw?.inputDecimals),resultDecimals:decimalPlaces(raw?.resultDecimals),expression:String(raw?.expression||'').slice(0,2000),snapshots,history:(Array.isArray(raw?.history)?raw.history:[]).filter(h=>typeof h?.expression==='string'&&Number.isFinite(h.result)).slice(-30).map(h=>({expression:h.expression.slice(0,2000),result:h.result,time:String(h.time||'')}))};
}

export function decimalPlaces(value){return Number.isInteger(value)&&value>=0&&value<=8?value:null;}
export function formatCalculatorNumber(value,places=null){return places===null?String(value):value.toFixed(places);}

// Button summaries have a fixed space budget; underlying operands stay exact.
export function formatCalculatorSummary(value,{places=null,count=false}={}){
 if(!Number.isFinite(value))return '—';
 const magnitude=Math.abs(value);
 if(magnitude>=1e15||magnitude>0&&magnitude<.001)return value.toExponential(2).replace(/\.?(0+)(?=e)/,'').replace('e+','e');
 if(magnitude>=1000)return new Intl.NumberFormat('en-US',{notation:'compact',maximumSignificantDigits:3}).format(value);
 return new Intl.NumberFormat('en-US',count?{maximumFractionDigits:0}:places!==null&&places<=2?{minimumFractionDigits:places,maximumFractionDigits:places}:{maximumSignificantDigits:5}).format(value);
}
