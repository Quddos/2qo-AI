// IndexedDB persistence. Everything 2qo knows lives on the device first.
import { openDB } from 'idb';

const DB_NAME = '2qo';
const VERSION = 1;

let dbp;
export function db() {
  if (!dbp) {
    dbp = openDB(DB_NAME + (globalThis.__2QO_DB_SUFFIX__ || ''), VERSION, {
      upgrade(d) {
        d.createObjectStore('kv');
        d.createObjectStore('contacts', { keyPath: 'id' });
        d.createObjectStore('chats', { keyPath: 'id' });
        const m = d.createObjectStore('messages', { keyPath: 'id' });
        m.createIndex('chat', ['chatId', 'ts']);
        d.createObjectStore('blobs');
        d.createObjectStore('status', { keyPath: 'id' });
        d.createObjectStore('calls', { keyPath: 'id' });
        d.createObjectStore('outbox', { keyPath: 'id' });
        d.createObjectStore('places', { keyPath: 'id' });
        d.createObjectStore('postcodes', { keyPath: 'key' });
        d.createObjectStore('sos', { keyPath: 'id' });
        d.createObjectStore('ai', { keyPath: 'id' });
      },
    });
  }
  return dbp;
}

export const kv = {
  get: async (k) => (await db()).get('kv', k),
  set: async (k, v) => (await db()).put('kv', v, k),
  del: async (k) => (await db()).delete('kv', k),
};

export const all = async (store) => (await db()).getAll(store);
export const get = async (store, key) => (await db()).get(store, key);
export const put = async (store, val) => (await db()).put(store, val);
export const del = async (store, key) => (await db()).delete(store, key);

export async function messagesFor(chatId) {
  const d = await db();
  const range = IDBKeyRange.bound([chatId, 0], [chatId, Infinity]);
  return d.getAllFromIndex('messages', 'chat', range);
}

export async function putBlob(id, blob) {
  (await db()).put('blobs', blob, id);
  return id;
}
export const getBlob = async (id) => (await db()).get('blobs', id);

/** Full backup as JSON (blobs inlined as data URLs). */
export async function exportBackup() {
  const d = await db();
  const out = { app: '2qo', version: VERSION, at: Date.now(), stores: {} };
  for (const s of ['contacts', 'chats', 'messages', 'status', 'calls', 'places', 'postcodes', 'sos', 'ai']) {
    out.stores[s] = await d.getAll(s);
  }
  const kvKeys = await d.getAllKeys('kv');
  out.kv = {};
  for (const k of kvKeys) {
    const v = await d.get('kv', k);
    // CryptoKeys are not serialisable; identity keys are exported separately as JWK.
    if (k !== 'keys') out.kv[k] = v;
  }
  out.blobs = {};
  const blobKeys = await d.getAllKeys('blobs');
  for (const k of blobKeys) {
    const b = await d.get('blobs', k);
    out.blobs[k] = await blobToDataURL(b);
  }
  return out;
}

export async function importBackup(data) {
  if (data?.app !== '2qo') throw new Error('Not a 2qo backup file');
  const d = await db();
  for (const [s, rows] of Object.entries(data.stores || {})) {
    const tx = d.transaction(s, 'readwrite');
    for (const r of rows) tx.store.put(r);
    await tx.done;
  }
  for (const [k, v] of Object.entries(data.kv || {})) await d.put('kv', v, k);
  for (const [k, url] of Object.entries(data.blobs || {})) {
    await d.put('blobs', await (await fetch(url)).blob(), k);
  }
}

export function blobToDataURL(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

export async function wipe() {
  const d = await db();
  d.close();
  dbp = null;
  await new Promise((res) => {
    const r = indexedDB.deleteDatabase(DB_NAME + (globalThis.__2QO_DB_SUFFIX__ || ''));
    r.onsuccess = r.onerror = r.onblocked = res;
  });
}
