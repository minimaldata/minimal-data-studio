/** Open analysis documents are a viewing preference, never the saved-work collection. */
export function createAnalysisTabs({open, close}) {
  const entries = new Map();
  return {
    entries,
    snapshot(active) {
      return {format:1, analyses:[...entries.values()].map(({kind,item})=>({kind,id:item.id})), active:entries.has(active)?active:null};
    },
    restore(state, collections) {
      entries.clear();
      if(state?.format!==1 || !Array.isArray(state.analyses))return null;
      for(const ref of state.analyses){
        if(!ref || !['notebook','dashboard'].includes(ref.kind) || typeof ref.id!=='string')continue;
        const item=collections[ref.kind].find(item=>item.id===ref.id);
        if(item)entries.set(`${ref.kind}:${ref.id}`,{kind:ref.kind,item});
      }
      return entries.get(state.active)||null;
    },
    remember(kind, item) { const key = `${kind}:${item.id}`; entries.set(key, {kind, item}); return key; },
    forget(kind, id) { entries.delete(`${kind}:${id}`); },
    render(host, active) {
      for (const [key, {kind, item}] of entries) {
        const tab = document.createElement('div');
        tab.className = 'tab file-tab analysis-tab' + (key === active ? ' active' : '');
        tab.dataset.analysis = key;
        const icon = document.createElement('span'); icon.className = 'file-tab-icon';
        icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">${kind === 'notebook' ? '<rect x="5" y="3" width="15" height="18" rx="2"/><path d="M8 3v18M2 7h5M2 12h5M2 17h5M11 8h6M11 12h6"/>' : '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 10h18M12 10v11"/>'}</svg>`;
        const label = Object.assign(document.createElement('span'), {textContent:item.name});
        const badge = Object.assign(document.createElement('small'), {className:'file-tab-kind',textContent:kind === 'notebook' ? 'Notebook' : 'Dashboard'});
        const button = Object.assign(document.createElement('button'), {className:'file-tab-close',textContent:'×',title:'Close tab — saved work is kept'});
        button.setAttribute('aria-label',`Close ${item.name}`);
        button.onclick = event => {event.stopPropagation();close(kind,item);};
        tab.onclick = () => open(kind,item);
        tab.append(icon,label,badge,button);host.append(tab);
      }
    }
  };
}
