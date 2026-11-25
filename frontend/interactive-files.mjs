/** Read-only source navigation. Paths are displayed as text, never interpreted as HTML. */
export function renderSourceTree(host, files, openFile) {
 const root={};
 for(const path of Object.keys(files).sort()){
   const parts=path.split('/');let node=root;
   parts.forEach((part,i)=>{node.children||=new Map();if(!node.children.has(part))node.children.set(part,{});node=node.children.get(part);if(i===parts.length-1)node.path=path;});
 }
 function render(node,parent){for(const [name,child] of node.children||[]){
   if(child.path){const button=document.createElement('button');button.className='interactive-source-file';button.textContent=name;button.title=child.path;button.onclick=()=>openFile(child.path,files[child.path]);parent.append(button);}
   else{const group=document.createElement('details'),summary=document.createElement('summary'),body=document.createElement('div');summary.textContent=name;body.className='interactive-source-children';group.append(summary,body);parent.append(group);render(child,body);}
 }}
 host.replaceChildren();render(root,host);
}
