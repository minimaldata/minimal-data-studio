/** Disposable browser UI preferences. Durable code belongs to editor-drafts.mjs. */
export function browserPreferences(storage) {
  return {
    get(key, fallback) { try { const raw = storage.getItem('sql-lab:v1:' + key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } },
    set(key, value) { try { storage.setItem('sql-lab:v1:' + key, JSON.stringify(value)); } catch {} }
  };
}
