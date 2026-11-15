// A tooltip belongs to one chart and must not survive that view's finalization.
export function createScatterTooltip(plot){
  const tip=document.createElement('div');tip.className='scatter-tooltip';tip.setAttribute('role','tooltip');tip.hidden=true;document.body.append(tip);
  const events=new AbortController();let view=null,disposed=false;
  function clear(){
    tip.hidden=true;
    if(view&&!disposed&&view.signal('studioHovered')!==null)view.signal('studioHovered',null).runAsync().catch(()=>{});
  }
  function handler(_handler,event,_item,value){
    if(disposed||!plot.isConnected||value==null||(view?.getState({signals:name=>name==='studioPanAnchor'}).signals.studioPanAnchor)){clear();return;}
    tip.replaceChildren();
    for(const [key,val] of Object.entries(value)){
      const row=document.createElement('div'),label=document.createElement('strong');label.textContent=key;row.append(label,document.createTextNode(String(val??'missing')));tip.append(row);
    }
    tip.hidden=false;
    const box=tip.getBoundingClientRect();
    tip.style.left=Math.max(8,Math.min(event.clientX+14,innerWidth-box.width-8))+'px';
    tip.style.top=Math.max(8,Math.min(event.clientY+14,innerHeight-box.height-8))+'px';
  }
  plot.addEventListener('pointerout',event=>{if(event.target.closest?.('[aria-roledescription="point"]'))clear();},{capture:true,signal:events.signal});
  plot.addEventListener('pointerleave',clear,{signal:events.signal});
  for(const type of ['scroll','pointerdown'])document.addEventListener(type,clear,{capture:true,signal:events.signal});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')clear();},{capture:true,signal:events.signal});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)clear();},{signal:events.signal});
  return {handler,clear,dispose(){if(disposed)return;clear();disposed=true;events.abort();tip.remove();view=null;},attach(next){
    view=next;const finalize=view.finalize.bind(view);view.finalize=()=>{this.dispose();return finalize();};
  }};
}
