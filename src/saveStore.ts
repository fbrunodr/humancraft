// Where saved games are kept in the browser (IndexedDB: a save runs to a
// few megabytes late in a game, more than localStorage holds), and saves
// as files: handed out to download, read back from one chosen.

const DB = 'human-craft', STORE = 'saves';
export const AUTOSAVE = 'autosave';

function open(): Promise<IDBDatabase> {
  return new Promise((done, fail) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => done(r.result);
    r.onerror = () => fail(r.error);
  });
}
export async function putSave(slot: string, text: string): Promise<void> {
  const db = await open();
  await new Promise<void>((done, fail) => { const t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(text, slot); t.oncomplete = () => done(); t.onerror = () => fail(t.error); });
  db.close();
}
export async function getSave(slot: string): Promise<string | null> {
  try {
    const db = await open();
    const text = await new Promise<string | null>((done, fail) => { const r = db.transaction(STORE).objectStore(STORE).get(slot); r.onsuccess = () => done(typeof r.result === 'string' ? r.result : null); r.onerror = () => fail(r.error); });
    db.close();
    return text;
  } catch { return null; }
}

export function downloadSave(name: string, text: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
// A file chosen by the player, read as text (null: none chosen).
export function pickSave(): Promise<string | null> {
  return new Promise((done) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => { const f = input.files?.[0]; if (!f) { done(null); return; } void f.text().then(done); };
    input.oncancel = () => done(null);
    input.click();
  });
}
