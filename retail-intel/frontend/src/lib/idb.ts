/** Minimal promise wrapper around IndexedDB: a key-value store and the offline queue. */
const DB_NAME = "kwaderno-retail-intel";
const VERSION = 1;
let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  return (dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      if (!db.objectStoreNames.contains("queue")) db.createObjectStore("queue", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbp = null; reject(req.error); };
  }));
}

function run<T>(store: "kv" | "queue", mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then((db) => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

export const kv = {
  get: <T>(key: string) => run<T | undefined>("kv", "readonly", (s) => s.get(key) as IDBRequest<T | undefined>),
  set: (key: string, value: unknown) => run("kv", "readwrite", (s) => s.put(value, key)).then(() => undefined),
  del: (key: string) => run("kv", "readwrite", (s) => s.delete(key)).then(() => undefined),
};

export const queueStore = {
  all: <T>() => run<T[]>("queue", "readonly", (s) => s.getAll() as IDBRequest<T[]>),
  put: (value: unknown) => run("queue", "readwrite", (s) => s.put(value)).then(() => undefined),
  del: (id: string) => run("queue", "readwrite", (s) => s.delete(id)).then(() => undefined),
  clear: () => run("queue", "readwrite", (s) => s.clear()).then(() => undefined),
};

/** For tests: forget the cached connection (fake-indexeddb resets between tests). */
export function _resetDbForTests() { dbp = null; }
