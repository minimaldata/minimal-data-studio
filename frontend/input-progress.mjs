/** Honest progress for blocking local SQL: elapsed time, not invented percent complete. */
export function inputProgress(node,label){
 const started=Date.now();
 const update=()=>{node.textContent=`${label} · ${Math.floor((Date.now()-started)/1000)}s · Previous inputs remain available. Queries have a 30-second execution limit.`;};
 update();const timer=setInterval(update,1000);return ()=>clearInterval(timer);
}
