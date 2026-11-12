import {jsonRequest} from './api.mjs';
// Results can be large and contain non-JSON values. Persist only editor metadata.
export function snapshot(state) {
  return {
    format: 1,
    active: state.active,
    tabs: state.tabs.map(({name, sql, lang='sql', drafts={}, savedId, orig, view}) => ({
      name, sql, lang, drafts: {...drafts},
      ...(savedId ? {savedId} : {}),
      ...(typeof orig === 'string' ? {orig} : {}),
      ...(view ? {view} : {})
    }))
  };
}
export const emptyEditorState = () => ({format:1, tabs:[{name:'Query 1',sql:''}], active:0});
/** Revision-checked, serialized autosave. The caller owns presentation and recovery. */
export function createEditorDrafts({request = jsonRequest, notify = () => {}} = {}) {
  let revision = null, pending = null, running = null, failed = false, lastSaved = null;
  async function load() {
    const result = await request('/editor-drafts');
    revision = result.revision; failed = false; lastSaved = JSON.stringify(snapshot(result.state || emptyEditorState()));
    return result.state || emptyEditorState();
  }
  async function flush() {
    if (running) return running;
    if (failed || revision === null || !pending) return;
    running = (async () => {
      while (pending && !failed) {
        const state = pending; pending = null;
        try {
          const result = await request('/editor-drafts', {revision, state});
          revision = result.revision; lastSaved = JSON.stringify(state);
          notify({status:pending ? 'saving' : 'saved'});
        } catch (error) {
          pending ||= state; failed = true;
          notify({status:error.status === 409 ? 'conflict' : 'error', error});
        }
      }
    })();
    try { await running; } finally { running = null; }
  }
  return {
    load,
    save(state) {
      const next = snapshot(state);
      if (!running && !failed && JSON.stringify(next) === lastSaved) return;
      pending = next;
      if (!failed && revision !== null) notify({status:'saving'});
      return flush();
    },
    flush,
    get dirty() { return Boolean(pending || running); },
    async recover(state) {
      if (running) await running;
      const latest = await request('/editor-drafts');
      const current = latest.state || emptyEditorState();
      const copies = snapshot(state).tabs.map(t => ({...t,name:t.name + ' (recovered)'}));
      const merged = {format:1,tabs:[...current.tabs,...copies],active:current.tabs.length + state.active};
      const result = await request('/editor-drafts', {revision:latest.revision,state:merged});
      revision = result.revision; lastSaved = JSON.stringify(merged); pending = null; failed = false; notify({status:'saved'});
      return merged;
    }
  };
}
