/** Read-only source presentation; never formats or changes the underlying file. */
export function sourceMode(path){
 const name=path.toLowerCase();
 if(/\.sql$/.test(name))return 'text/x-sql';
 if(/\.json$/.test(name))return {name:'javascript',json:true};
 if(/\.(js|mjs)$/.test(name)||name.startsWith('javascript'))return 'javascript';
 if(/\.css$/.test(name)||name.startsWith('css'))return 'css';
 if(/\.(html|htm)$/.test(name)||name.startsWith('html'))return 'htmlmixed';
 if(/\.svg$/.test(name))return 'xml';
 if(/\.md$/.test(name))return 'markdown';
 return null;
}
export function mountSourcePreview(host,{CodeMirror,copy=text=>navigator.clipboard.writeText(text)}){
 host.innerHTML='<div class="source-preview-tools"><small></small><span class="spacer"></span><button data-wrap aria-pressed="false">Wrap lines</button><button data-copy>Copy source</button><span class="source-copy-status" role="status"></span></div><div class="source-code"></div>';
 const editor=CodeMirror(host.querySelector('.source-code'),{value:'',readOnly:true,lineNumbers:true,viewportMargin:15,lineWrapping:false,tabSize:2,indentUnit:2});
 editor.getWrapperElement().dataset.sourcePreview='true';
 const wrap=host.querySelector('[data-wrap]'),status=host.querySelector('[role=status]');let timer;
 wrap.onclick=()=>{const enabled=!editor.getOption('lineWrapping');editor.setOption('lineWrapping',enabled);wrap.setAttribute('aria-pressed',String(enabled));};
 host.querySelector('[data-copy]').onclick=async()=>{try{await copy(editor.getValue());status.textContent='Copied';}catch{status.textContent='Select text to copy';}clearTimeout(timer);timer=setTimeout(()=>status.textContent='',2000);};
 return {show(path,text){editor.setOption('mode',sourceMode(path));editor.setValue(text);editor.scrollTo(0,0);const lines=text.split('\n').length;host.querySelector('small').textContent=`${lines.toLocaleString()} ${lines===1?'line':'lines'} · ${(new TextEncoder().encode(text).length/1024).toFixed(1)} KB`;status.textContent='';requestAnimationFrame(()=>editor.refresh());}};
}
