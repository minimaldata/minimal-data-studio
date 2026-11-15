export const GRAINS = ["millisecond", "second", "minute", "hour", "day", "week", "month", "quarter", "year"];
export const GRAIN_NAMES = { millisecond: "Millisecond", second: "Second", minute: "Minute", hour: "Hour", day: "Day", week: "Week", month: "Month", quarter: "Quarter", year: "Year" };
export const DAY_MS = 864e5;
// start of the day / week (Monday) / month / quarter / year containing ms, in UTC
export function bucket(ms, grain) {
  if(grain==='millisecond')return Math.floor(ms);
  const unit={second:1000,minute:60000,hour:3600000}[grain];
  if(unit)return Math.floor(ms/unit)*unit;
  const d = new Date(ms), y = d.getUTCFullYear(), m = d.getUTCMonth();
  if (grain === "year") return Date.UTC(y, 0, 1);
  if (grain === "quarter") return Date.UTC(y, m - (m % 3), 1);
  if (grain === "month") return Date.UTC(y, m, 1);
  const day = Date.UTC(y, m, d.getUTCDate());
  return grain === "week" ? day - ((d.getUTCDay() + 6) % 7) * DAY_MS : day;
}
// the grain the data already has: the coarsest one every date sits on the start of
export function nativeGrain(msList) {
  for (const g of [...GRAINS].reverse()) if (msList.every((ms) => bucket(ms, g) === ms)) {
    // dates that are all Jan 1 / quarter starts but sit closer together than that grain are a finer series
    const sorted = [...new Set(msList)].sort((a, b) => a - b);
    const gap = sorted.slice(1).reduce((gap,v,i)=>Math.min(gap,v-sorted[i]),Infinity);
    const need = { year: 360, quarter: 88, month: 27, week: 7, day: 0, hour:0, minute:0, second:0, millisecond:0 }[g] * DAY_MS;
    if (sorted.length < 2 || gap >= need) return g;
  }
  return "millisecond";
}
export const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
export function grainLabel(ms, grain) {
  if(isClockGrain(grain))return timeKey(ms,grain).replace('T',' ').replace('Z',' UTC');
  const d = new Date(ms), y = d.getUTCFullYear(), mon = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  if (grain === "year") return String(y);
  if (grain === "quarter") return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${y}`;
  if (grain === "month") return `${mon} ${y}`;
  return `${grain === "week" ? "Week of " : ""}${mon} ${d.getUTCDate()}, ${y}`;
}

export const CLOCK_GRAINS=['hour','minute','second','millisecond'];
export const isClockGrain=grain=>CLOCK_GRAINS.includes(grain);
export function timeKey(ms,grain){
  if(!isClockGrain(grain))return isoDay(ms);
  const iso=new Date(Math.floor(ms)).toISOString();
  return grain==='millisecond'?iso:iso.slice(0,19)+'Z';
}
export const millisecondAxisLabel="[utcFormat(datum.value, '%H:%M:%S.%L'), utcFormat(datum.value, '%b %d, %Y')]";
export function clockMenu(active,onPick){
  const menu=document.createElement('details');menu.className='clock-granularity';
  const toggle=document.createElement('summary');toggle.title='Time granularity';toggle.setAttribute('aria-label','Time granularity');
  toggle.innerHTML='<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></svg>';
  const body=document.createElement('div');body.className='clock-options';
  for(const grain of ['day',...CLOCK_GRAINS]){const button=document.createElement('button');button.type='button';button.textContent=GRAIN_NAMES[grain];button.setAttribute('aria-pressed',String(grain===active));button.onclick=()=>{menu.open=false;onPick(grain);};body.append(button);}
  menu.append(toggle,body);return menu;
}
const timeViewports=new WeakMap();
export function applyTimeViewport(spec,c,d){
  if(c.type!=='line'||!d.time||d.overlay||!d.values.length)return null;
  let map=timeViewports.get(d.res);if(!map){map=new Map();timeViewports.set(d.res,map);}
  const key=JSON.stringify([c.x,c.y,c.series,c.refLines,d.grain,!!d.pct,!!d.cum,!!c.showAllSeries,d.series,c.visibleSeries]);
  let state=map.get(key);
  if(!state){let low=Infinity,high=-Infinity;for(const r of d.values){low=Math.min(low,r.x);high=Math.max(high,r.x);}if(low===high){low-=d.grain==='millisecond'?1:1000;high+=d.grain==='millisecond'?1:1000;}state={initial:[[low,high],null],domains:[[low,high],null]};map.set(key,state);}
  const scale=spec.scales.find(s=>s.name==='x');if(!scale)return null;
  spec.signals.push({name:'studioXDomain',value:[...state.domains[0]]},{name:'studioYDomain',value:state.domains[1]},{name:'studioHovered',value:null},{name:'studioPanAnchor',value:null});
  const yScale=spec.scales.find(s=>s.name==='y');if(yScale)yScale.domainRaw={signal:'studioYDomain'};
  scale.domain={signal:'studioXDomain'};scale.nice=false;scale.zero=false;
  // Recompute sensible ticks as the visible time span changes.
  const span='(studioXDomain[1] - studioXDomain[0])';
  for(const axis of spec.axes||[])if(axis.scale==='x'){
    axis.tickCount=6;axis.encode||={};axis.encode.labels||={};axis.encode.labels.update||={};
    axis.encode.labels.update.text={signal:`${span} <= 1000 ? [utcFormat(datum.value, '%H:%M:%S.%L'), utcFormat(datum.value, '%b %d, %Y')] : ${span} <= 604800000 ? [utcFormat(datum.value, '%H:%M:%S'), utcFormat(datum.value, '%b %d, %Y')] : [utcFormat(datum.value, '%b %d'), utcFormat(datum.value, '%Y')]`};
  }
  const clip=marks=>{for(const m of marks||[]){if(['line','symbol','rule','text','group'].includes(m.type))m.clip=true;clip(m.marks);}};clip(spec.marks);
  spec.marks.unshift({name:'studioPanSurface',type:'rect',encode:{update:{x:{value:0},y:{value:0},width:{signal:'width'},height:{signal:'height'},fill:{value:'transparent'}}}});
  return state;
}
