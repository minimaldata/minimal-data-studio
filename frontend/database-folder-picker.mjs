/** A destination can be an existing folder or a new path, created only on save. */
export function mountDatabaseFolderPicker(host,{api}){
 const id='folder-options-'+crypto.randomUUID();host.replaceChildren();
 const label=document.createElement('label');label.textContent='Database folder';const input=document.createElement('input');input.setAttribute('list',id);input.placeholder='Database (root)';input.setAttribute('aria-label','Database folder');label.append(input);
 const options=document.createElement('datalist');options.id=id;
 const hint=document.createElement('small');hint.textContent='Choose an existing folder or type a new name. Use / for subfolders. Leave empty for Database (root).';
 host.append(label,options,hint);let paths=[];
 const ready=api({action:'list'}).then(result=>{paths=result.folders;options.replaceChildren(...paths.map(path=>new Option(path,path)));});
 // Callers surface load errors when saving as well as when opening.
 ready.catch(()=>{});
 return {ready,setDisabled(value){input.disabled=value;},async ensure(){await ready;const path=input.value.trim().split('/').map(x=>x.trim()).join('/');if(!path)return '';if(!paths.includes(path)){const result=await api({action:'create',path});paths=result.folders;}return path;}};
}
