/** The only native-shell capability adapter. Browser mode remains fully supported. */
export async function configureUpdateLink(versionLabel, link, transport = fetch) {
  try {
    const response = await transport('/app-info');
    const info = response.ok ? await response.json() : null;
    if (info?.native_updater) {
      versionLabel.textContent = 'Studio ' + info.version;
      link.href = 'mds-studio://check-for-updates';
      link.removeAttribute('target');
    }
  } catch { /* Keep the ordinary website link in browser mode. */ }
}

/** The browser menu keeps infrequent project actions out of the workspace. */
export function configureProjectHeader(doc, appearance) {
  const menu = doc.getElementById('projectMenu');
  const native = !!doc.defaultView?.webkit?.messageHandlers?.studioProject;
  doc.documentElement.classList.toggle('native-workspace', native);
  menu.addEventListener('click', event => {
    if (event.target.closest('button') && !event.target.closest('button').disabled) menu.open = false;
  });
  doc.addEventListener('pointerdown', event => { if (!menu.contains(event.target)) menu.open = false; });
  doc.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu.open) { menu.open = false; menu.querySelector('summary').focus(); }
  });
  if (native) doc.defaultView.addEventListener('studio-appearance', event => {
    if (['light','dark','system'].includes(event.detail)) appearance(event.detail === 'system' ? null : event.detail);
  });
}

/** Flush existing autosaves; never apply explicit-save edits just to reload. */
export async function prepareWorkspaceReload({blocker,unsaved,flush,canSave}) {
  const reason=blocker();
  if(reason)throw Error(reason);
  if(canSave())await flush();
  const after=blocker();
  if(after)throw Error(after);
  if(unsaved())throw Error('Save or recover unsaved work before reloading.');
}

export function configureWorkspaceReload(win,hooks) {
  if(!win.webkit?.messageHandlers?.studioProject)return;
  let pending=false,generation=0;
  const release=()=>{win.document.body.inert=false;pending=false;};
  win.studioCancelReload=()=>{generation++;release();};
  win.studioPrepareReload=async()=>{
    if(pending)return {ok:false,error:'A reload is already being prepared.'};
    pending=true;const request=++generation;win.document.body.inert=true;
    let timer;
    try {
      await Promise.race([prepareWorkspaceReload(hooks),new Promise((_,reject)=>{timer=win.setTimeout(()=>reject(Error('Saving took too long. Your workspace has not reloaded. Try again after checking the connection.')),15000);})]);
      if(request!==generation)return {ok:false,error:'Reload cancelled.'};
      // Keep input locked between the save acknowledgement and the native reload.
      return {ok:true};
    } catch(error) { if(request===generation)release();return {ok:false,error:error.message||String(error)}; }
    finally {win.clearTimeout(timer);}
  };
}
