// Notebook data-cell UI only. The caller supplies execution, persistence and
// input mounting so this module has no dependency on the active project/notebook.
import {mountCellResize} from './notebook-resize.mjs';
export function mountNotebookDataCell(el,cell,r,{mountInput,persistSoon,drawCellOutput,createNotebookTableDialog,canEdit}){
    // the output has a small title; clicking it folds the output (the type badge in the header does the same for the code)
    const section = (label, key, cls, onShow) => {
      const h = Object.assign(document.createElement("div"), { className: "sec-head" });
      const l = Object.assign(document.createElement("span"), { className: "sec-label" });
      const draw = () => { l.textContent = (cell[key] ? "▸ " : "▾ ") + label; l.title = (cell[key] ? "Show the " : "Hide the ") + label.toLowerCase(); };
      l.onclick = () => { cell[key] = !cell[key] || undefined; el.classList.toggle(cls, !!cell[key]); draw(); persistSoon(); if (!cell[key]) onShow(); };
      draw(); h.appendChild(l);
      return h;
    };
    const box = document.createElement("div"); el.appendChild(box);
    mountInput(box);
    if(r.cm)mountCellResize(box,cell,'codeHeight',{label:'cell code',canEdit,
      apply:h=>{box.classList.toggle('sized-code',h!==null);r.cm.getWrapperElement().style.height=h===null?'auto':h+'px';},
      onCommit:()=>{r.cm.refresh();persistSoon();}});
    const outHead = section("Output", "outHidden", "out-hidden", () => drawCellOutput(cell)); // a chart drawn while hidden measures 0 wide
    const vs = Object.assign(document.createElement("select"), { title: "Show the result as a table or a chart" });
    [["table", "Table"], ["chart", "Chart"]].forEach(([v, t]) => vs.appendChild(Object.assign(document.createElement("option"), { value: v, textContent: t, selected: (cell.view || "table") === v })));
    vs.onchange = () => { cell.view = vs.value; persistSoon(); drawCellOutput(cell); };
    outHead.appendChild(vs);
    const createTable=Object.assign(document.createElement('button'),{className:'notebook-create-table',textContent:'Create table…',title:'Save all output rows as a new persistent table'});
    createTable.hidden=!r.res;createTable.onclick=()=>createNotebookTableDialog(cell);outHead.append(createTable);
    el.append(outHead,
              Object.assign(document.createElement("div"), { className: "cell-extra" }),
              Object.assign(document.createElement("div"), { className: "cell-ctl chartctl", hidden: true }),
              Object.assign(document.createElement("div"), { className: "cell-out" }),
              Object.assign(document.createElement("div"), { className: "cell-meta" }));
    mountCellResize(el.querySelector('.cell-out'),cell,'outputHeight',{label:'cell output',canEdit,
      apply:h=>{const out=el.querySelector('.cell-out');out.style.height=h===null?'':h+'px';out.style.maxHeight=h===null?'':h+'px';out.style.overflow=h===null?'':'auto';},
      onCommit:()=>{persistSoon();requestAnimationFrame(()=>dispatchEvent(new Event('resize')));}});
}

export function mountNotebookEditor(box,cell,{CodeMirror,mode,run,changed,hint,configureSql}){
 const editor=CodeMirror(box,{
  value:cell.source,mode,viewportMargin:Infinity,lineWrapping:false,lineNumbers:true,matchBrackets:true,autoCloseBrackets:true,
  indentUnit:cell.type==='python'?4:2,tabSize:cell.type==='python'?4:2,
  extraKeys:{'Cmd-Enter':run,'Ctrl-Enter':run,'Shift-Enter':run,'Ctrl-Space':'autocomplete','Cmd-/':'toggleComment','Ctrl-/':'toggleComment'}
 });
 editor.on('change',()=>{cell.source=editor.getValue();changed();});
 if(cell.type==='sql'){
  editor.setOption('hintOptions',{completeSingle:false,hint});
  configureSql(editor);
 }
 return editor;
}
