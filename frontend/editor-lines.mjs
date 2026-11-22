/** Shared by every CodeMirror editor: queries, definitions, tasks and cells. */
export function moveEditorLines(editor, direction) {
  if (editor.getOption('readOnly')) return;
  const selections = editor.listSelections();
  const before = (a,b) => a.line < b.line || (a.line === b.line && a.ch < b.ch);
  const groups = [];
  const spans = selections.map((selection,index) => {
    const from = before(selection.anchor,selection.head) ? selection.anchor : selection.head;
    const to = before(selection.anchor,selection.head) ? selection.head : selection.anchor;
    return {start:from.line,end:to.line - (to.line > from.line && to.ch === 0 ? 1 : 0),indices:[index]};
  }).sort((a,b)=>a.start-b.start);
  for (const span of spans) {
    const previous = groups.at(-1);
    if (previous && span.start <= previous.end + 1) {
      previous.end = Math.max(previous.end,span.end); previous.indices.push(...span.indices);
    } else groups.push(span);
  }
  const shifted = selections.map(s=>({anchor:{...s.anchor},head:{...s.head}}));
  editor.operation(()=>{
    for (const group of groups) {
      if (direction < 0 ? group.start === editor.firstLine() : group.end === editor.lastLine()) continue;
      const start = group.start + (direction < 0 ? -1 : 0);
      const end = group.end + (direction > 0 ? 1 : 0);
      const lines = [];
      for (let line=start;line<=end;line++) lines.push(editor.getLine(line));
      if (direction < 0) lines.push(lines.shift()); else lines.unshift(lines.pop());
      editor.replaceRange(lines.join('\n'),{line:start,ch:0},{line:end,ch:editor.getLine(end).length},'+moveLine');
      for (const index of group.indices) for (const point of ['anchor','head']) shifted[index][point].line += direction;
    }
    editor.setSelections(shifted);
    editor.scrollIntoView(editor.getCursor());
  });
}
export function installLineMovement(CodeMirror) {
  CodeMirror.defineInitHook(editor => editor.addKeyMap({
    'Alt-Up':editor=>moveEditorLines(editor,-1),
    'Alt-Down':editor=>moveEditorLines(editor,1),
  }));
}
