// Opaque-origin document. Never add allow-same-origin or a generic host RPC.
export function sandboxSource(doc, token) {
  const payload=JSON.stringify({html:doc.html,css:doc.css,javascript:doc.javascript,inputs:doc.inputs,state:doc.state,context:doc.context||{},token}).replace(/</g,'\\u003c');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"></head><body><script>
  const payload=${payload};
  const report=(kind,value)=>parent.postMessage({studioDocument:payload.token,kind,value},'*');
  addEventListener('keydown',e=>{if(e.key==='Escape')report('exit-fullscreen',null);});
  addEventListener('error',e=>report('error',e.message));
  addEventListener('unhandledrejection',e=>report('error',String(e.reason)));
  document.addEventListener('click',e=>{if(e.target.closest('a'))e.preventDefault();},true);
  const style=document.createElement('style');style.textContent=payload.css;document.head.append(style);
  const content=document.createElement('main');content.innerHTML=payload.html;document.body.append(content);
  window.studio=Object.freeze({apiVersion:1,inputs:payload.inputs,state:payload.state,context:payload.context,setInputParameters:value=>report('parameters',value),saveState:value=>report('state',value),saveResultsAsTable:value=>report('result-table',value)});
  const script=document.createElement('script');script.textContent=payload.javascript;document.body.append(script);
  report('ready',null);
  <\/script></body></html>`;
}

export function validDocumentState(value) {
  if(!value || typeof value!=='object' || Array.isArray(value))return false;
  try{return JSON.stringify(value).length<=1_000_000;}catch{return false;}
}
