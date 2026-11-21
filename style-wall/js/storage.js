const OVERLAY = 'stylewall.overlay';
const TOMBS = 'stylewall.tombstones';
const TOKEN = 'stylewall.githubToken';
const GEMINI = 'stylewall.geminiKey';
const MODEL = 'stylewall.model';
const REPO = 'stylewall.repo';
const DB_NAME = 'stylewall';
const DB_STORE = 'blobs';

function memory() {
  return typeof localStorage !== 'undefined' ? localStorage : null;
}

export function readJson(key, fallback) {
  try {
    const raw = memory()?.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  memory()?.setItem(key, JSON.stringify(value));
}

export function readOverlay() {
  const value = readJson(OVERLAY, []);
  return Array.isArray(value) ? value : [];
}

export function readTombstones() {
  const value = readJson(TOMBS, {});
  return value && typeof value === 'object' ? value : {};
}

export function rememberItems(items) {
  const map = new Map(readOverlay().map((item) => [item.id, item]));
  for (const item of items) map.set(item.id, item);
  writeJson(OVERLAY, [...map.values()]);
}

export function rememberTombstone(id, at) {
  const tombs = readTombstones();
  tombs[id] = at;
  writeJson(TOMBS, tombs);
  writeJson(
    OVERLAY,
    readOverlay().filter((item) => item.id !== id),
  );
}

export function getSecrets() {
  const store = memory();
  return {
    token: store?.getItem(TOKEN) || '',
    gemini: store?.getItem(GEMINI) || '',
    model: store?.getItem(MODEL) || '',
  };
}

export function saveSecrets({ token, gemini, model, repo }) {
  const store = memory();
  if (!store) return;
  if (token) store.setItem(TOKEN, token.trim());
  if (gemini) store.setItem(GEMINI, gemini.trim());
  if (model) store.setItem(MODEL, model.trim());
  if (repo) writeJson(REPO, repo);
}

export function clearSecrets() {
  const store = memory();
  if (!store) return;
  store.removeItem(TOKEN);
  store.removeItem(GEMINI);
  store.removeItem(MODEL);
  store.removeItem(REPO);
}

export function readRepoOverride() {
  return readJson(REPO, null);
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('這台瀏覽器沒有本機儲存'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function withStore(mode, run) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, mode);
        const result = run(tx.objectStore(DB_STORE));
        tx.oncomplete = () => {
          db.close();
          resolve(result);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      }),
  );
}

export function putBlob(path, blob, savedAt) {
  return withStore('readwrite', (store) => {
    store.put({ blob, savedAt }, path);
  });
}

export function getBlob(path) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, 'readonly');
        const req = tx.objectStore(DB_STORE).get(path);
        req.onsuccess = () => {
          db.close();
          resolve(req.result || null);
        };
        req.onerror = () => {
          db.close();
          reject(req.error);
        };
      }),
  );
}

export function deleteBlob(path) {
  return withStore('readwrite', (store) => {
    store.delete(path);
  });
}
