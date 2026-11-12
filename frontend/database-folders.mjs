/** Pure organizational-folder move validation; does not rename SQL objects. */
export function databaseFolderDropPlan(path,destination,folders){
  if(!folders.includes(path)||(destination&&!folders.includes(destination)))return null;
  if(destination===path||destination.startsWith(path+'/'))return null;
  const target=(destination?destination+'/':'')+path.split('/').pop();
  if(target===path||folders.some(p=>p.toLowerCase()===target.toLowerCase()))return null;
  return target;
}
