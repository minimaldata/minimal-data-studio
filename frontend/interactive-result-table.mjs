import {mountDatabaseFolderPicker} from './database-folder-picker.mjs';
/** The frame can propose rows, but only this host dialog can confirm a write. */
export function openResultTableDialog(value,{canEdit,request,created,report,folderAPI}){
 if(document.querySelector('#interactiveResultTableDialog'))return;
 if(!canEdit())return report('Choose Edit here before creating a table.');
 if(!value||!Array.isArray(value.rows)||!value.rows.length||value.rows.length>10000||!Array.isArray(value.columns)||value.columns.length>50||JSON.stringify(value).length>1100000)return report('Result table request is invalid or too large.');
 const snapshot=JSON.parse(JSON.stringify(value));
 const dialog=document.createElement('dialog');dialog.id='interactiveResultTableDialog';dialog.className='database-move-dialog';
 const form=document.createElement('form'),heading=document.createElement('h3');heading.textContent='Save results as table';
 const note=document.createElement('p');note.textContent=`Create a new Local DuckDB table with ${snapshot.rows.length.toLocaleString()} rows. Existing tables and views will never be replaced.`;
 const columns=document.createElement('p');columns.textContent='Columns: '+snapshot.columns.map(c=>String(c.name)).join(', ');
 const warning=document.createElement('p');warning.textContent=String(snapshot.description||'').slice(0,500);
 const label=document.createElement('label');label.textContent='Table name';const input=document.createElement('input');input.required=true;input.value=String(snapshot.suggestedName||'scenario_results').slice(0,63);label.append(input);
 const folderHost=document.createElement('div'),folderPicker=mountDatabaseFolderPicker(folderHost,{api:folderAPI});
 const error=document.createElement('p');error.setAttribute('role','alert');folderPicker.ready.catch(e=>error.textContent=e.message);
 const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel';cancel.onclick=()=>dialog.close();
 const save=document.createElement('button');save.type='submit';save.className='primary';save.textContent='Create table';let busy=false;
 form.onsubmit=async event=>{event.preventDefault();if(busy||!canEdit())return;busy=true;save.disabled=cancel.disabled=input.disabled=true;folderPicker.setDisabled(true);
  try{const response=await request('/interactive-results/create-table',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:input.value,folder:await folderPicker.ensure(),columns:snapshot.columns,rows:snapshot.rows})});const result=await response.json();if(!response.ok)throw Error(result.error||'Could not create table.');dialog.close();report(`Created ${result.name} · ${result.rows} rows in Local DuckDB`);try{await created();}catch{report(`Created ${result.name}. Refresh the explorer to see it.`);}}
  catch(e){error.textContent=e.message;}finally{busy=false;save.disabled=cancel.disabled=input.disabled=false;folderPicker.setDisabled(false);}
 };
 dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});dialog.addEventListener('close',()=>dialog.remove());
 form.append(heading,note,warning,columns,label,folderHost,error,cancel,save);dialog.append(form);document.body.append(dialog);dialog.showModal();input.focus();input.select();
}
