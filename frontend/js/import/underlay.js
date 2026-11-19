// Keeps the imported drawing in this browser only: the image blob in IndexedDB (localStorage is capped
// at about 5 MB), its placement per project in localStorage. Everything degrades to "no background"
// when storage is blocked (private window, quota): functions return false / null, never throw.
import { load, save } from "../store.js";

const DB_NAME = "od-underlay";
const STORE = "images";
const metaKey = (projectId) => `od.underlay.${projectId}`;

let opening = null;
function openDb() {
  opening ??= new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

async function withStore(mode, work) {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      let result = null;
      const request = work(tx.objectStore(STORE));
      if (request) request.onsuccess = () => (result = request.result ?? null);
      tx.oncomplete = () => resolve({ value: result });
      tx.onerror = tx.onabort = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function putImage(key, blob) {
  return Boolean(await withStore("readwrite", (store) => store.put(blob, key)));
}

export async function getImage(key) {
  const done = await withStore("readonly", (store) => store.get(key));
  return done?.value instanceof Blob ? done.value : null;
}

export async function deleteImage(key) {
  return Boolean(await withStore("readwrite", (store) => store.delete(key)));
}

export async function renameImage(oldKey, newKey) {
  const blob = await getImage(oldKey);
  if (!blob || !(await putImage(newKey, blob))) return false;
  await deleteImage(oldKey);
  return true;
}

export const draftKey = () => `draft:${Array.from(globalThis.crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("")}`;
export const projectKey = (projectId) => `project:${projectId}`;

const num = (v) => Number.isFinite(v);
// Placement saved per project: { x, y, width, height, opacity, visible }. Anything malformed reads as absent.
export function loadPlacement(projectId) {
  const m = load(metaKey(projectId));
  if (!m || ![m.x, m.y, m.width, m.height].every(num) || !(m.width > 0) || !(m.height > 0)) return null;
  return { x: m.x, y: m.y, width: m.width, height: m.height, opacity: num(m.opacity) ? Math.min(Math.max(m.opacity, 0), 1) : 0.5, visible: m.visible !== false };
}

export function savePlacement(projectId, placement) {
  const { x, y, width, height, opacity, visible } = placement;
  return save(metaKey(projectId), { x, y, width, height, opacity, visible: visible !== false });
}
