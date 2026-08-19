// Local cache of the scorer's state, so a refresh or an app kill mid-over does
// not lose anything and the scoreboard paints instantly before the socket
// connects. Carried over from the original app, including the write queue.

const DB_NAME = 'cricketScoreboardDB';
const DB_VERSION = 1;
const STORE = 'scorerState';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) {
      reject(new Error('IndexedDB unsupported'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Every operation goes through one chained queue. Without it, a save queued
// just before a clear can land AFTER that clear and resurrect stale state —
// a real bug the original app hit and fixed exactly this way.
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task) as Promise<T>;
  queue = next.then(
    () => {},
    () => {},
  );
  return next;
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const req = fn(transaction.objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

export function idbSave(key: string, value: unknown): Promise<void> {
  return enqueue(async () => {
    try {
      await tx('readwrite', (store) => store.put(value, key));
    } catch {
      /* cache only — never block scoring on it */
    }
  });
}

export function idbLoad<T>(key: string): Promise<T | null> {
  return enqueue(async () => {
    try {
      return (await tx<T>('readonly', (store) => store.get(key))) ?? null;
    } catch {
      return null;
    }
  });
}

export function idbClear(key: string): Promise<void> {
  return enqueue(async () => {
    try {
      await tx('readwrite', (store) => store.delete(key));
    } catch {
      /* ignore */
    }
  });
}
