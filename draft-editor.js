// Editable datasets are snapshots. Raw CSV is the durable draft representation.
export function csvText(records, delimiter=',') {
  return records.map(row => row.map(v => { const s=v == null?'':String(v); return s===''||s.includes(delimiter)||/["\r\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s; }).join(delimiter)).join('\n');
}
export function clipboardRows(text) {
  // A comma is ordinary text here: spreadsheet clipboard columns use tabs.
  const rows=[], row=[]; let value='', quoted=false, after=false;
  for(let i=0;i<text.length;i++) { const ch=text[i];
    if(quoted) { if(ch==='"' && text[i+1]==='"'){value+='"';i++;} else if(ch==='"'){quoted=false;after=true;} else value+=ch; }
    else if(ch==='"' && !value && !after) quoted=true;
    else if(ch==='\t'||ch==='\n'||ch==='\r') { row.push(value);value='';after=false; if(ch!=='\t'){rows.push(row.splice(0));if(ch==='\r'&&text[i+1]==='\n')i++;} }
    else {if(after)throw Error('Unexpected text after a quoted clipboard value.');value+=ch;}
  }
  if(quoted)throw Error('Clipboard text has an unclosed quote.');
  if(value||row.length||!rows.length){row.push(value);rows.push(row);}
  const width=rows[0].length;if(rows.some(r=>r.length!==width))throw Error('Clipboard rows have different numbers of columns. Paste CSV text in CSV source instead.');
  return rows;
}
function ask(text, value, acceptLabel='Continue', submit) {
  return new Promise(resolve=>{
    const dialog=document.createElement('dialog');dialog.className='project-dialog';
    const form=document.createElement('form');form.method='dialog';
    const label=document.createElement('label');label.textContent=text;
    let input;if(value!==undefined){input=document.createElement('input');input.value=value;input.style.cssText='display:block;width:100%;margin-top:10px;padding:8px;background:var(--bg);color:var(--text);border:1px solid var(--border)';label.append(input);}
    const actions=document.createElement('div');actions.className='actions';
    for(const [v,t] of [['cancel','Cancel'],['ok',acceptLabel]]){const button=document.createElement('button');button.value=v;button.textContent=t;if(v==='cancel'){button.type='button';button.onclick=()=>dialog.close('cancel');}actions.append(button);}
    const error=document.createElement('p');error.setAttribute('role','alert');error.style.color='var(--error, #b42318)';error.hidden=true;
    let busy=false;
    if(submit){
      form.addEventListener('submit',async event=>{
        event.preventDefault();if(busy)return;
        busy=true;error.hidden=true;input?.removeAttribute('aria-invalid');
        const buttons=actions.querySelectorAll('button');buttons.forEach(b=>b.disabled=true);if(input)input.disabled=true;
        try{await submit(input?input.value:true);dialog.close('ok');}
        catch(e){error.textContent=e.message;error.hidden=false;input?.setAttribute('aria-invalid','true');}
        finally{busy=false;buttons.forEach(b=>b.disabled=false);if(input){input.disabled=false;if(dialog.open)input.focus();}}
      });
      dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
      if(input)input.addEventListener('input',()=>{error.hidden=true;input.removeAttribute('aria-invalid');});
    }
    form.append(label,error,actions);dialog.append(form);document.body.append(dialog);dialog.addEventListener('close',()=>{const result=dialog.returnValue==='ok'?(input?input.value:true):null;dialog.remove();resolve(result);},{once:true});dialog.showModal();input?.focus();input?.select();
  });
}
const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
export function createDraftStudio(api) {
  const host=document.getElementById('draftEditor'), list=document.getElementById('draftList');
  let drafts=[], current=null, loaded=false, loading=null;
  const ui=new Map(), closed=new Set();
  const request=async(action,body={})=>(await api.fetch('/db/drafts/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).json();
  const state=d=>{if(!ui.has(d.id))ui.set(d.id,{view:'grid',page:0,sel:[0,0,0,0],undo:[],redo:[],version:0,checked:-1,issues:[],counts:{},queue:Promise.resolve(),saved:true});return ui.get(d.id);};
  const snapshot=d=>JSON.stringify({raw:d.raw,types:d.types,blanksMissing:d.blanksMissing,name:d.name});
  function message(text,error=false){const box=host.querySelector('.draft-message');if(box){box.textContent=text;box.classList.toggle('error',error);}}
  function status(d){if(current!==d)return;const s=state(d);for(const [name,items] of [['Undo',s.undo],['Redo',s.redo]]){const button=host.querySelector(`[aria-label="${name}"]`);if(button)button.disabled=!items.length;}const box=host.querySelector('.draft-save');if(box)box.textContent=s.saveError?'Not saved: '+s.saveError:s.saved?'Saved to project':'Saving draft…';}
  function persist(d){const s=state(d);if(s.deleting||s.deleted)return Promise.resolve();clearTimeout(s.timer);s.saved=false;status(d);
    s.queue=s.queue.catch(()=>{}).then(async()=>{if(s.deleting||s.deleted)return;const version=s.version;try{const result=await request('save',{draft:structuredClone(d)});d.revision=result.revision;s.saved=version===s.version;s.saveError='';}catch(e){s.saveError=e.message;throw e;}finally{status(d);}});return s.queue;
  }
  function changed(d,before,note){const s=state(d);if(before===snapshot(d))return;s.undo.push(before);if(s.undo.length>20)s.undo.shift();s.redo=[];s.version++;s.saved=false;s.check=null;s.checked=-1;d.history.push({at:new Date().toISOString(),note});d.history=d.history.slice(-200);clearTimeout(s.timer);s.timer=setTimeout(()=>persist(d).catch(()=>{}),500);status(d);}
  function sync(d){const s=state(d);d.raw=csvText([s.columns,...s.rows]);}
  function checkStatus(d){const s=state(d), b=host.querySelector('[data-action="create"]'), label=host.querySelector('.draft-check-status');if(!b)return;b.disabled=s.checked!==s.version||!!s.check?.issueCount;b.classList.toggle('draft-invalid',!!s.check?.issueCount);label.dataset.state=s.checked===s.version?(s.check.issueCount?'issues':'valid'):'unchecked';label.textContent=s.checked===s.version?(s.check.issueCount?`${s.check.issueCount} issues to resolve`:'Check passed'):'Not checked';}
  function sidebar(){list.replaceChildren();for(const d of drafts){const b=el('button');b.title=d.name;b.setAttribute('aria-label',d.name+' · Draft');b.setAttribute('aria-current',String(current===d));const icon=el('span',undefined,'draft-list-icon');icon.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 9v12M3 15h18"/></svg>';b.append(icon,el('span',d.name,'draft-list-name'));b.onclick=()=>open(d);const row=el('div',undefined,'draft-list-row');const remove=el('button',undefined,'draft-delete');remove.title='Delete draft';remove.setAttribute('aria-label','Delete draft '+d.name);remove.innerHTML='<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg>';remove.onclick=()=>removeDraft(d);row.append(b,remove);list.append(row);}api.tabs();}
  async function removeDraft(d){
    const s=state(d);if(s.deleting||s.deleted)return;
    if(!await ask(`Delete “${d.name}”? This removes the editable draft and its edit history. Exported CSVs, created tables, and source data stay unchanged. This cannot be undone.`,undefined,'Delete draft'))return;
    s.deleting=true;clearTimeout(s.timer);s.stopDrag?.();
    if(current===d)host.inert=true;
    try{
      await s.queue.catch(()=>{});
      await request('delete',{id:d.id,revision:d.revision});
      s.deleted=true;drafts=drafts.filter(item=>item!==d);closed.delete(d.id);
      if(current===d){current=null;host.replaceChildren();api.activate(null);}
      sidebar();
    }catch(e){await ask(e.message,undefined,'Close');if(!s.saved)s.timer=setTimeout(()=>persist(d).catch(()=>{}),500);}
    finally{s.deleting=false;host.inert=false;}
  }
  async function load(){if(loaded)return;if(loading)return loading;loading=(async()=>{drafts=(await request('list')).drafts;loaded=true;sidebar();})().finally(()=>loading=null);return loading;}
  async function parse(d){const result=await request('parse',{draft:d});Object.assign(state(d),{columns:result.columns,rows:result.rows});}
  async function open(d){closed.delete(d.id);current=d;sidebar();api.activate('draft:'+d.id);const s=state(d);try{await parse(d);}catch(e){s.view='csv';s.parseError=e.message;}render(d);}
  async function create(result){try{await load();if(result&&(result.rows.length>10000||result.cols.length>100||result.rows.length*result.cols.length>100000))throw Error('This result is too large for an editable draft (10,000 rows / 100 columns / 100,000 cells). Narrow the query first. Nothing was copied.');
    const name=await ask('Name this editable draft',result?'Result copy':'Untitled dataset');if(!name)return;
    const rows=result?result.rows.map(row=>row.map((v,i)=>api.cellText(v,result.types[i]))):[['']];
    const d={id:crypto.randomUUID(),name,raw:csvText([result?result.cols:['column_1'],...rows]),types:{},blanksMissing:true,source:result?{query:result.query||'',language:result.lang,rows:result.rows.length,note:'Frozen copy of the full retained result; NULL values are represented as empty CSV fields.'}:{note:'Created from scratch'},history:[],revision:0};
    await persist(d);drafts.push(d);sidebar();await open(d);
  }catch(e){alert(e.message);}}
  async function createFromFile(file){try{
    if(file.kind!=='csv'||file.error||!Array.isArray(file.rows)||file.limited)throw Error('Load a complete CSV preview before editing a copy.');
    if(file.rows.length>10000||file.columns.length>100||file.rows.length*file.columns.length>100000)throw Error('This CSV is too large for an editable draft (10,000 rows / 100 columns / 100,000 cells). No rows were copied.');
    await load();
    const raw=csvText([file.columns,...file.rows]);
    await request('parse',{draft:{raw}});
    const name=await ask('Name this editable CSV copy',file.name.replace(/\.csv$/i,'')+' copy');if(!name?.trim())return;
    const d={id:crypto.randomUUID(),name:name.trim(),raw,types:{},blanksMissing:true,source:{file:file.relative,rows:file.rows.length,note:'Copy of all CSV rows. Original file unchanged.'},history:[],revision:0};
    await persist(d);drafts.push(d);sidebar();await open(d);
  }catch(e){await ask(e.message,undefined,'OK');}}
  function action(label,fn,name){const b=el('button',label);if(name)b.dataset.action=name;b.onclick=()=>Promise.resolve(fn()).catch(e=>message(e.message,true));return b;}
  function renderPreservingPosition(d){
    if(current!==d)return;
    const grid=host.querySelector('.draft-grid');
    const position={top:grid?.scrollTop||0,left:grid?.scrollLeft||0,host:host.scrollTop};
    const selectors=grid?[...grid.querySelectorAll('select')]:[];
    const focusedType=selectors.indexOf(document.activeElement);
    render(d);
    const next=host.querySelector('.draft-grid');
    if(next){next.scrollTop=position.top;next.scrollLeft=position.left;
      if(focusedType>=0)next.querySelectorAll('select')[focusedType]?.focus({preventScroll:true});
    }
    host.scrollTop=position.host;
  }
  function render(d){if(current!==d)return;const s=state(d);s.stopDrag?.();host.replaceChildren();
    const top=el('div',undefined,'draft-top');
    const identity=el('div',undefined,'draft-identity');identity.append(el('strong',d.name),el('span','Editable CSV draft','draft-badge'));
    const saving=el('div',undefined,'draft-saving');const save=action('Save draft',()=>persist(d));save.className='draft-quiet';saving.append(el('span',undefined,'draft-save'),save);top.append(identity,saving);host.append(top);
    const intro=el('p',d.source?.file?`Copy of ${d.source.file} · Original file unchanged`:d.source?.rows!==undefined?`Copy of ${d.source.rows} result rows · Source data unchanged`:'New dataset · Source data unchanged','draft-intro');intro.title='Your original files and tables are unchanged. NULL values copied from results appear as empty CSV fields.';host.append(intro);
    const toolbar=el('div',undefined,'draft-toolbar draft-main-toolbar');
    const views=el('div',undefined,'draft-view-switch');
    for(const [view,label] of [['grid','Spreadsheet'],['csv','CSV source']]) {const b=action(label,async()=>{if(view==='grid'){await parse(d);s.parseError='';}s.view=view;render(d);});b.setAttribute('aria-pressed',String(s.view===view));views.append(b);}
    const historyActions=el('div',undefined,'draft-history-actions');
    for(const [label,glyph,redo] of [['Undo','↶',false],['Redo','↷',true]]){const b=action('',()=>undo(d,redo));b.innerHTML=`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><g${redo?' transform="translate(24 0) scale(-1 1)"':''}><path d="M4 10a8 8 0 1 1 1.5 7"/><path d="M4 4v6h6"/></g></svg>`;b.title=label;b.setAttribute('aria-label',label);b.disabled=!(redo?s.redo:s.undo).length;historyActions.append(b);}
    const outputs=el('div',undefined,'draft-output-actions');const check=action('Check draft',()=>validate(d));check.className='draft-check-button';outputs.append(check,action('Create table…',()=>finish(d,'create'),'create'),action('Save CSV…',()=>finish(d,'csv')));
    toolbar.append(views,historyActions,outputs);host.append(toolbar);
    const line=el('div',undefined,'draft-options');const missing=el('input');missing.type='checkbox';missing.checked=d.blanksMissing;missing.onchange=()=>{const before=snapshot(d);d.blanksMissing=missing.checked;changed(d,before,'Changed empty-field handling');s.issues=[];s.counts={};render(d);};const label=el('label');label.title='When creating a table, empty CSV fields become SQL NULL values.';label.append(missing,document.createTextNode(' Empty fields → NULL'));line.append(label,el('div',undefined,'draft-check-status'));
    const destination=el('div',undefined,'draft-destination');const show=action('Files / exports ↗',()=>api.refreshFiles('exports'));show.title='Show CSV destination folder';destination.append(el('span','CSV destination'),show);line.append(destination);host.append(line,el('div',s.parseError||'', 'draft-message'));
    if(s.view==='csv') {host.append(el('p','CSV stores text, not column types. Quotes protect commas and line breaks inside values. Your type choices apply when creating a table.','draft-intro'));const area=el('textarea',undefined,'draft-csv');area.setAttribute('aria-label','Editable CSV source');area.spellcheck=false;area.value=d.raw;let before=null;
      area.oninput=()=>{if(before===null)before=snapshot(d);d.raw=area.value;s.version++;s.checked=-1;s.check=null;s.issues=[];s.counts={};s.saved=false;clearTimeout(s.timer);s.timer=setTimeout(()=>persist(d).catch(()=>{}),700);checkStatus(d);status(d);};
      area.onkeydown=e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.stopPropagation();area.blur();undo(d,e.shiftKey);}};
      area.onblur=()=>{if(before!==null){const original=before;before=null;changed(d,original,'Edited CSV source');}};host.append(area);
    }else renderGrid(d);
    const info=el('div',undefined,'draft-issue');info.setAttribute('aria-live','polite');host.append(info);explain(d);
    const hood=el('details',undefined,'draft-hood');hood.append(el('summary','What’s happening under the hood'));hood.append(el('p','Draft values remain text. Check validates the selected types; creating a table applies these conversions to a temporary input. Number uses DOUBLE (approximate); keep exact identifiers as Text.'));
    const pre=el('pre',s.check?.sql||'Click Check draft to preview the SQL conversions.','cm-s-default');hood.append(pre);if(s.check){pre.replaceChildren();CodeMirror.runMode(s.check.sql,'text/x-sql',pre);}host.append(hood);
    const history=el('details',undefined,'draft-hood');history.append(el('summary',`Edit history · ${d.history.length} recent changes`));for(const h of [...d.history].reverse())history.append(el('p',h.note));host.append(history);status(d);checkStatus(d);
  }
  function bounds(s){const [r,c,r2,c2]=s.sel;return [Math.min(r,r2),Math.min(c,c2),Math.max(r,r2),Math.max(c,c2)];}
  function select(d,r,c,extend=false){const s=state(d);s.sel=extend?[s.sel[0],s.sel[1],r,c]:[r,c,r,c];paint(d);explain(d);}
  function paint(d){const s=state(d),[r,c,r2,c2]=bounds(s);host.querySelectorAll('td[data-row]').forEach(td=>td.classList.toggle('selected',+td.dataset.row>=r&&+td.dataset.row<=r2&&+td.dataset.col>=c&&+td.dataset.col<=c2));}
  function explain(d){const box=host.querySelector('.draft-issue');if(!box)return;box.replaceChildren();const s=state(d),i=s.issues.find(i=>i.row===s.sel[2]&&i.col===s.sel[3]);if(!i){box.append(el('span','Select a flagged cell to see its issue and possible fixes.'));return;}box.append(el('strong',`Row ${i.row+1} · ${s.columns?.[i.col]||''}: ${i.title}`),el('p',i.solution),action('Set as missing',()=>{const before=snapshot(d);s.rows[i.row][i.col]='';d.blanksMissing=true;sync(d);s.issues=s.issues.filter(x=>x!==i);changed(d,before,`Marked row ${i.row+1}, ${s.columns[i.col]} as missing`);render(d);}));const detail=el('details');detail.append(el('summary','Technical explanation'),el('pre',i.sql+'\nParameters: '+JSON.stringify(i.parameters)+'\n\n'+i.technical));box.append(detail);}
  function structural(d,fn,note,revealNewRow=false){
    const s=state(d),before=snapshot(d),grid=host.querySelector('.draft-grid');
    const scroll={top:grid?.scrollTop||0,left:grid?.scrollLeft||0,host:host.scrollTop};
    fn();s.issues=[];s.counts={};
    const row=revealNewRow?s.rows.length-1:Math.max(0,Math.min(s.sel[2],s.rows.length-1));
    const col=Math.max(0,Math.min(s.sel[3],s.columns.length-1));
    s.sel=[row,col,row,col];s.page=Math.floor(row/100);
    sync(d);changed(d,before,note);render(d);
    const nextGrid=host.querySelector('.draft-grid');
    host.scrollTop=scroll.host;nextGrid.scrollTop=scroll.top;nextGrid.scrollLeft=scroll.left;
    if(revealNewRow){
      nextGrid.querySelector('.draft-clipboard').focus({preventScroll:true});
      const cell=nextGrid.querySelector(`td[data-row="${row}"][data-col="${col}"]`);
      if(cell){const bounds=nextGrid.getBoundingClientRect(),rect=cell.getBoundingClientRect();if(rect.bottom>bounds.bottom)nextGrid.scrollTop+=rect.bottom-bounds.bottom+2;else if(rect.top<bounds.top)nextGrid.scrollTop-=bounds.top-rect.top;}
    }
  }
  function renderGrid(d){const s=state(d);const bar=el('div',undefined,'draft-toolbar');bar.append(action('+ Row',()=>structural(d,()=>{if(s.rows.length>=10000||(s.rows.length+1)*s.columns.length>100000)throw Error('Draft size limit reached.');s.rows.push(s.columns.map(()=>''));},'Added row',true)),action('+ Column',async()=>{const n=await ask('Column name','');if(!n)return;if(s.columns.some(c=>c.toLowerCase()===n.toLowerCase())||!n.trim())throw Error('Choose a nonempty, unique column name.');structural(d,()=>{if(s.columns.length>=100||(s.columns.length+1)*s.rows.length>100000)throw Error('Draft size limit reached.');s.columns.push(n);s.rows.forEach(r=>r.push(''));},'Added column '+n);}),action('Delete selected rows',async()=>{const [r,,r2]=bounds(s);if(await ask(`Delete ${r2-r+1} selected rows from this draft?`))structural(d,()=>s.rows.splice(r,r2-r+1),'Deleted selected rows');}),action('Delete selected columns',async()=>{const [,c,,c2]=bounds(s);if(c2-c+1>=s.columns.length)throw Error('Keep at least one column.');if(await ask(`Delete ${c2-c+1} selected columns from this draft?`))structural(d,()=>{for(const n of s.columns.slice(c,c2+1))delete d.types[n];s.columns.splice(c,c2-c+1);s.rows.forEach(r=>r.splice(c,c2-c+1));},'Deleted selected columns');}),action('Use first row as headers',()=>{if(!s.rows.length)return;const names=s.rows[0];if(names.some(n=>!n.trim())||new Set(names.map(n=>n.toLowerCase())).size!==names.length)throw Error('First row needs unique, nonempty names.');structural(d,()=>{s.columns=s.rows.shift();d.types={};},'Used first row as headers');}));const extras=el('details',undefined,'draft-more');extras.append(el('summary','More actions'));const menu=el('div');while(bar.children.length>2)menu.append(bar.children[2]);extras.append(menu);bar.append(extras);bar.classList.add('draft-grid-toolbar');host.append(bar);
    const pager=el('div',undefined,'draft-toolbar');const pages=Math.max(1,Math.ceil(s.rows.length/100));s.page=Math.min(s.page,pages-1);pager.append(action('Previous',()=>{s.page=Math.max(0,s.page-1);render(d);}),el('span',`${s.rows.length} rows · Page ${s.page+1} / ${pages}`),action('Next',()=>{s.page=Math.min(pages-1,s.page+1);render(d);}));pager.classList.add('draft-pager');if(pages===1){pager.firstChild.hidden=true;pager.lastChild.hidden=true;pager.children[1].textContent=`${s.rows.length} rows · ${s.columns.length} columns`;}else{pager.firstChild.disabled=s.page===0;pager.lastChild.disabled=s.page===pages-1;}bar.append(pager);
    const wrap=el('div',undefined,'draft-grid');wrap.tabIndex=0;const sink=el('textarea',undefined,'draft-clipboard');sink.dataset.clipboardSink='true';sink.setAttribute('aria-label','Selected spreadsheet cells');sink.tabIndex=-1;wrap.append(sink);wrap.addEventListener('focus',()=>sink.focus());wrap.setAttribute('aria-label','Editable spreadsheet. Select cells to copy and paste; double-click or type to edit.');const table=el('table');const head=el('tr');head.append(el('th','#'));
    s.columns.forEach((name,j)=>{const th=el('th');if(s.issues.some(i=>i.col===j))th.className='column-issue';const title=action(name,async()=>{const n=await ask('Rename column',name);if(!n||n===name)return;if(s.columns.some((v,k)=>k!==j&&v.toLowerCase()===n.toLowerCase()))throw Error('That column name already exists.');structural(d,()=>{s.columns[j]=n;if(d.types[name]){d.types[n]=d.types[name];delete d.types[name];}},`Renamed ${name} to ${n}`);});title.title='Rename column';th.append(title);
      const config=d.types[name]||{kind:'text',format:'YYYY-MM-DD'};const type=el('select');type.setAttribute('aria-label','Type for '+name);for(const [v,t] of [['text','Text'],['number','Number'],['integer','Whole number'],['date','Date'],['datetime','DateTime'],['boolean','True/false']])type.add(new Option(t,v));type.value=config.kind;type.onchange=()=>{const before=snapshot(d);d.types[name]={...config,kind:type.value};s.issues=s.issues.filter(i=>i.col!==j);changed(d,before,`Changed ${name} type to ${type.value}`);renderPreservingPosition(d);validate(d);};th.append(type);
      if(config.kind==='date'||config.kind==='datetime'){const hint=el('span',config.kind==='date'?'YYYY-MM-DD':'YYYY-MM-DD HH:MM:SS or YYYY-MM-DDTHH:MM:SS','draft-type-format');hint.title=config.kind==='datetime'?'Use a space or T between date and time; mixed forms are accepted. 24-hour time, with seconds; no time zone':'Year-month-day only';th.append(hint);}
      const count=s.issues.filter(i=>i.col===j).length;if(count){th.append(action(`${s.checked===s.version?s.counts[j]||count:count} ${(s.checked===s.version?s.counts[j]||count:count)===1?'issue':'issues'}`,()=>{const issue=s.issues.find(i=>i.col===j);s.page=Math.floor(issue.row/100);s.sel=[issue.row,j,issue.row,j];render(d);}));}head.append(th);});const thead=el('thead');thead.append(head);table.append(thead);const body=el('tbody');
    for(let r=s.page*100;r<Math.min(s.rows.length,(s.page+1)*100);r++){const tr=el('tr');tr.append(el('th',String(r+1)));s.rows[r].forEach((value,c)=>{const td=el('td',value);td.dataset.row=r;td.dataset.col=c;td.tabIndex=-1;td.setAttribute('aria-label',`Row ${r+1}, ${s.columns[c]}: ${value}`);if(s.issues.some(i=>i.row===r&&i.col===c)){td.classList.add('cell-issue');td.title='Issue: select this cell for details';td.append(el('span','!','issue-mark'));}td.onmousedown=e=>{if(e.target.tagName==='TEXTAREA'||e.button!==0)return;e.preventDefault();e.stopPropagation();s.stopDrag?.();sink.focus();select(d,r,c,e.shiftKey);
      let x=e.clientX,y=e.clientY,frame;
      const stop=()=>{cancelAnimationFrame(frame);document.removeEventListener('mousemove',move);document.removeEventListener('mouseup',stop);window.removeEventListener('blur',stop);s.stopDrag=null;};
      const extend=()=>{if(!wrap.isConnected){stop();return;}const rect=wrap.getBoundingClientRect(),top=rect.top+thead.getBoundingClientRect().height;
        const speed=(p,lo,hi)=>p<lo+24?-Math.min(24,(lo+24-p)/2):p>hi-24?Math.min(24,(p-hi+24)/2):0;
        wrap.scrollTop+=speed(y,top,rect.bottom);wrap.scrollLeft+=speed(x,rect.left,rect.right);
        const rows=[...body.rows];let target=rows[0];for(const row of rows){if(row.getBoundingClientRect().top<=Math.max(top,y))target=row;}
        if(target){const cells=[...target.querySelectorAll('td[data-col]')];let cell=cells[0];for(const candidate of cells){if(candidate.getBoundingClientRect().left<=x)cell=candidate;}if(cell)select(d,+cell.dataset.row,+cell.dataset.col,true);}
        frame=requestAnimationFrame(extend);
      };
      const move=ev=>{x=ev.clientX;y=ev.clientY;};document.addEventListener('mousemove',move);document.addEventListener('mouseup',stop);window.addEventListener('blur',stop);s.stopDrag=stop;frame=requestAnimationFrame(extend);
    };td.ondblclick=()=>editCell(d,td,r,c);tr.append(td);});body.append(tr);}table.append(body);wrap.append(table);host.append(wrap);paint(d);
    wrap.oncopy=e=>{if(e.target.tagName==='TEXTAREA'&&!e.target.dataset.clipboardSink)return;e.stopPropagation();const [r,c,r2,c2]=bounds(s);e.preventDefault();e.clipboardData.setData('text/plain',csvText(s.rows.slice(r,r2+1).map(row=>row.slice(c,c2+1)),'\t'));};
    wrap.onpaste=async e=>{if(e.target.tagName==='TEXTAREA'&&!e.target.dataset.clipboardSink)return;e.preventDefault();e.stopPropagation();try{await paste(d,e.clipboardData.getData('text/plain'));}catch(err){message(err.message,true);}};
    wrap.onkeydown=e=>{if((e.target.tagName==='TEXTAREA'&&!e.target.dataset.clipboardSink)||e.target.tagName==='SELECT'||e.target.tagName==='BUTTON')return;if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();undo(d,e.shiftKey);return;}if(e.metaKey||e.ctrlKey||e.altKey)return;let [r,c]=s.sel.slice(2);const move={ArrowDown:[1,0],ArrowUp:[-1,0],ArrowLeft:[0,-1],ArrowRight:[0,1],Enter:[1,0],Tab:[0,e.shiftKey?-1:1]};if(move[e.key]){e.preventDefault();const [dr,dc]=move[e.key];r=Math.max(0,Math.min(s.rows.length-1,r+dr));c=Math.max(0,Math.min(s.columns.length-1,c+dc));select(d,r,c,e.shiftKey&&e.key!=='Tab');if(Math.floor(r/100)!==s.page){s.page=Math.floor(r/100);render(d);host.querySelector('.draft-grid').focus();}return;}if(['Delete','Backspace'].includes(e.key)){e.preventDefault();const [a,b,x,y]=bounds(s);const before=snapshot(d);for(let i=a;i<=x;i++)for(let j=b;j<=y;j++)if(s.rows[i])s.rows[i][j]='';s.issues=s.issues.filter(i=>!(i.row>=a&&i.row<=x&&i.col>=b&&i.col<=y));sync(d);changed(d,before,'Cleared selected cells');render(d);return;}if(e.key==='F2'||e.key.length===1){const td=wrap.querySelector(`td[data-row="${r}"][data-col="${c}"]`);if(td){e.preventDefault();editCell(d,td,r,c,e.key==='F2'?undefined:e.key);}}};
  }
  function editCell(d,td,r,c,initial,caret=false){
    if(td.querySelector('textarea'))return;
    const s=state(d),input=el('textarea');
    input.value=initial===undefined?s.rows[r][c]:initial;
    input.setAttribute('aria-label',`Edit row ${r+1}, ${s.columns[c]}`);
    td.classList.add('editing');td.replaceChildren(input);input.focus();
    if(caret||initial!==undefined)input.setSelectionRange(input.value.length,input.value.length);
    else input.select();
    let cancelled=false;
    input.onpaste=e=>{
      const text=e.clipboardData.getData('text/plain');
      try{const block=clipboardRows(text);if(block.length>1||block[0].length>1){e.preventDefault();e.stopPropagation();input.blur();select(d,r,c);paste(d,text).catch(err=>message(err.message,true));}}catch(err){e.preventDefault();message(err.message,true);}
    };
    input.onkeydown=e=>{
      e.stopPropagation();
      const step=e.key==='Enter'&&!e.shiftKey?[1,0]:null;
      if(step&&!e.metaKey&&!e.ctrlKey&&!e.altKey){
        e.preventDefault();
        const nextRow=Math.max(0,Math.min(s.rows.length-1,r+step[0]));
        const nextCol=Math.max(0,Math.min(s.columns.length-1,c+step[1]));
        if(nextRow===r&&nextCol===c){input.blur();host.querySelector('.draft-grid').focus();return;}
        input.blur();select(d,nextRow,nextCol,e.shiftKey);
        if(Math.floor(nextRow/100)!==s.page){s.page=Math.floor(nextRow/100);render(d);}
        const cell=host.querySelector(`td[data-row="${nextRow}"][data-col="${nextCol}"]`);
        host.querySelector('.draft-grid').focus();
        cell?.scrollIntoView({block:'nearest',inline:'nearest'});
        return;
      }
      if(e.key==='Escape'){cancelled=true;input.blur();}
      if(e.key==='Tab'){
        e.preventDefault();input.blur();
        const next=c+(e.shiftKey?-1:1);
        if(next>=0&&next<s.columns.length){select(d,r,next);const cell=host.querySelector(`td[data-row="${r}"][data-col="${next}"]`);host.querySelector('.draft-grid').focus();}
      }
    };
    input.onblur=()=>{
      if(!cancelled&&input.value!==s.rows[r][c]){
        const before=snapshot(d),old=s.rows[r][c];s.rows[r][c]=input.value;
        s.issues=s.issues.filter(i=>i.row!==r||i.col!==c);sync(d);
        changed(d,before,`Row ${r+1}, ${s.columns[c]}: ${JSON.stringify(old)} → ${JSON.stringify(input.value)}`);
        td.classList.remove('cell-issue');
      }
      td.classList.remove('editing');td.textContent=s.rows[r][c];
      td.setAttribute('aria-label',`Row ${r+1}, ${s.columns[c]}: ${s.rows[r][c]}`);
      if(s.issues.some(i=>i.row===r&&i.col===c))td.append(el('span','!','issue-mark'));
      checkStatus(d);explain(d);
    };
  }
  async function paste(d,text){const grid=host.querySelector('.draft-grid');const scroll={top:grid?.scrollTop||0,left:grid?.scrollLeft||0,host:host.scrollTop};const s=state(d),data=clipboardRows(text),[r,c,r2,c2]=bounds(s);const fill=data.length===1&&data[0].length===1;const h=fill?r2-r+1:data.length,w=fill?c2-c+1:data[0].length;if((r2!==r||c2!==c)&&!fill&&(h!==r2-r+1||w!==c2-c+1))throw Error('The pasted block must match the selected range. Select one starting cell instead.');if(r+h>10000||c+w>100||Math.max(s.rows.length,r+h)*Math.max(s.columns.length,c+w)>100000)throw Error('Paste exceeds the draft size limit.');let occupied=0;for(let i=0;i<h;i++)for(let j=0;j<w;j++)if(s.rows[r+i]?.[c+j])occupied++;if(occupied&&!await ask(`Replace ${occupied} existing values? You can undo this paste.`))return;
    const before=snapshot(d);while(s.columns.length<c+w){let n='column_'+(s.columns.length+1);while(s.columns.includes(n))n+='_';s.columns.push(n);s.rows.forEach(row=>row.push(''));}while(s.rows.length<r+h)s.rows.push(s.columns.map(()=>''));for(let i=0;i<h;i++)for(let j=0;j<w;j++)s.rows[r+i][c+j]=fill?data[0][0]:data[i][j];s.issues=[];s.counts={};sync(d);changed(d,before,`Pasted ${h} × ${w} cells`);s.sel=[r,c,r+h-1,c+w-1];render(d);const nextGrid=host.querySelector('.draft-grid');host.scrollTop=scroll.host;nextGrid.scrollTop=scroll.top;nextGrid.scrollLeft=scroll.left;nextGrid.querySelector('.draft-clipboard').focus({preventScroll:true});message(`Pasted ${h} rows × ${w} columns. Undo reverses this paste.`);}
  async function undo(d,redo){const s=state(d),from=redo?s.redo:s.undo,to=redo?s.undo:s.redo;if(!from.length)return;to.push(snapshot(d));Object.assign(d,JSON.parse(from.pop()));s.version++;s.checked=-1;s.check=null;s.issues=[];s.counts={};d.history.push({at:new Date().toISOString(),note:redo?'Redo':'Undo'});try{await parse(d);}catch(e){s.view='csv';s.parseError=e.message;}persist(d).catch(()=>{});render(d);}
  async function validate(d){const s=state(d),version=s.version;message('Checking draft…');try{const result=await request('check',{draft:structuredClone(d)});if(s.version!==version)return;Object.assign(s,{check:result,checked:version,issues:result.issues,counts:result.columnCounts,columns:result.columns,rows:result.rows,parseError:''});if(current!==d)return;renderPreservingPosition(d);message(result.issueCount?(result.issueCount>500?'Showing the first 500 issues. Fix these and check again.':'Select a highlighted cell to review the issue.'):'Check passed. Ready to create a new table.');}catch(e){s.checked=-1;s.parseError=e.message;message(e.message,true);checkStatus(d);}}
  async function finish(d,actionName){
    const s=state(d);
    if(actionName==='create'&&(s.checked!==s.version||s.check?.issueCount))throw Error('Check the draft and resolve issues first.');
    let result;
    const suggested=actionName==='create'?'edited_dataset':((d.name.replace(/\.csv$/i,'').replace(/[^A-Za-z0-9_-]+/g,'_').replace(/^_+|_+$/g,'')||'dataset')+'.csv');
    const name=await ask(actionName==='create'?'New table name (existing names cannot be replaced)':'New CSV filename in exports/',suggested,actionName==='create'?'Create table':'Save CSV',async name=>{
      if(actionName==='csv'&&!/^[A-Za-z0-9_-]+\.csv$/.test(name))throw Error('The filename must end in .csv (for example, my_dataset.csv). Before .csv, use only letters, numbers, underscores or hyphens; no spaces.');
      if(!name.trim())throw Error('Enter a name.');
      await persist(d);
      result=await request(actionName,{draft:structuredClone(d),name});
    });
    if(name===null)return;
    if(actionName==='create')await api.refreshSchema();else await api.refreshFiles('exports');
    message(actionName==='create'?`Created table “${result.name}”. Your draft and source data are unchanged.`:`Saved to Files / ${result.path}. CSV contains values, not column types.`);
  }
  window.addEventListener('beforeunload',e=>{if(drafts.some(d=>!state(d).saved)){e.preventDefault();e.returnValue='Draft changes are still saving.';}});
  return {load,create,createFromFile,renderTabs(container,active){for(const d of drafts){if(closed.has(d.id))continue;const tab=el('div',d.name+' · Draft','tab draft-tab'+(active==='draft:'+d.id?' active':''));tab.onclick=()=>open(d);const close=el('button','×','file-tab-close');close.title='Close draft tab (kept in project)';close.onclick=e=>{e.stopPropagation();closed.add(d.id);if(active==='draft:'+d.id)api.activate(null);else api.tabs();};tab.append(close);container.append(tab);}host.hidden=!active?.startsWith('draft:');document.querySelector('.work').classList.toggle('draft-view',!!active?.startsWith('draft:'));}};
}
