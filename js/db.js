// ── IndexedDB Wrapper ─────────────────────────────────
// All database operations go through this module.

const DB_NAME = 'inventory_platform';
const DB_VERSION = 3;

let dbInstance = null;

const STORES = {
  businessProfile: { keyPath: 'id' },
  products:        { keyPath: 'id', autoIncrement: true },
  materials:       { keyPath: 'id', autoIncrement: true },
  recipes:         { keyPath: 'id', autoIncrement: true },
  suppliers:       { keyPath: 'id', autoIncrement: true },
  purchaseOrders:  { keyPath: 'id', autoIncrement: true },
  batches:         { keyPath: 'id', autoIncrement: true },
  productionRuns:  { keyPath: 'id', autoIncrement: true },
  waste:           { keyPath: 'id', autoIncrement: true },
  locations:       { keyPath: 'id', autoIncrement: true },
  history:         { keyPath: 'id', autoIncrement: true },
  photos:          { keyPath: 'id', autoIncrement: true },
  dailySnapshots:  { keyPath: 'id', autoIncrement: true },
  settings:        { keyPath: 'key' },
  expenses:        { keyPath: 'id', autoIncrement: true },
  transactions:    { keyPath: 'id', autoIncrement: true },
};

const INDEXES = {
  products: [
    { name: 'status',    keyPath: 'status' },
    { name: 'locationId', keyPath: 'locationId' },
    { name: 'name',      keyPath: 'name' },
    { name: 'createdAt', keyPath: 'createdAt' },
  ],
  materials: [
    { name: 'category',   keyPath: 'category' },
    { name: 'supplierId', keyPath: 'supplierId' },
    { name: 'name',       keyPath: 'name' },
  ],
  recipes: [
    { name: 'productId', keyPath: 'productId' },
  ],
  suppliers: [
    { name: 'name', keyPath: 'name' },
  ],
  purchaseOrders: [
    { name: 'status',     keyPath: 'status' },
    { name: 'supplierId', keyPath: 'supplierId' },
    { name: 'createdAt',  keyPath: 'createdAt' },
  ],
  batches: [
    { name: 'materialId',   keyPath: 'materialId' },
    { name: 'supplierId',   keyPath: 'supplierId' },
    { name: 'receivedDate', keyPath: 'receivedDate' },
  ],
  productionRuns: [
    { name: 'productId', keyPath: 'productId' },
    { name: 'createdAt', keyPath: 'createdAt' },
  ],
  waste: [
    { name: 'itemType',  keyPath: 'itemType' },
    { name: 'createdAt', keyPath: 'createdAt' },
  ],
  locations: [
    { name: 'name', keyPath: 'name' },
  ],
  history: [
    { name: 'itemType',  keyPath: 'itemType' },
    { name: 'itemId',    keyPath: 'itemId' },
    { name: 'createdAt', keyPath: 'createdAt' },
    { name: 'changeType', keyPath: 'changeType' },
  ],
  dailySnapshots: [
    { name: 'date', keyPath: 'date', unique: true },
  ],
  expenses: [
    { name: 'category', keyPath: 'category' },
    { name: 'costType', keyPath: 'costType' },
  ],
  transactions: [
    { name: 'date',      keyPath: 'date' },
    { name: 'type',      keyPath: 'type' },
    { name: 'category',  keyPath: 'category' },
    { name: 'productId', keyPath: 'productId' },
    { name: 'source',    keyPath: 'source' },
  ],
};

export function openDB() {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      const tx = e.target.transaction;

      // Create any missing stores
      for (const [name, opts] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(name)) {
          const store = db.createObjectStore(name, opts);
          if (INDEXES[name]) {
            for (const idx of INDEXES[name]) {
              store.createIndex(idx.name, idx.keyPath, { unique: !!idx.unique });
            }
          }
        }
      }

      // Version 2 → 3: add costType index to existing expenses store
      if (e.oldVersion < 3 && db.objectStoreNames.contains('expenses')) {
        const expStore = tx.objectStore('expenses');
        if (!expStore.indexNames.contains('costType')) {
          expStore.createIndex('costType', 'costType');
        }
      }
    };

    req.onsuccess = (e) => {
      dbInstance = e.target.result;
      resolve(dbInstance);
    };

    req.onerror = (e) => {
      console.error('IndexedDB open failed:', e.target.error);
      reject(e.target.error);
    };
  });
}

function txStore(storeName, mode = 'readonly') {
  const tx = dbInstance.transaction(storeName, mode);
  return tx.objectStore(storeName);
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ── CRUD Operations ──────────────────────────────────

export async function getAll(storeName) {
  await openDB();
  return reqToPromise(txStore(storeName).getAll());
}

export async function getById(storeName, id) {
  await openDB();
  return reqToPromise(txStore(storeName).get(id));
}

export async function put(storeName, record) {
  await openDB();
  return reqToPromise(txStore(storeName, 'readwrite').put(record));
}

export async function add(storeName, record) {
  await openDB();
  return reqToPromise(txStore(storeName, 'readwrite').add(record));
}

export async function del(storeName, id) {
  await openDB();
  return reqToPromise(txStore(storeName, 'readwrite').delete(id));
}

export async function clear(storeName) {
  await openDB();
  return reqToPromise(txStore(storeName, 'readwrite').clear());
}

export async function count(storeName) {
  await openDB();
  return reqToPromise(txStore(storeName).count());
}

// ── Index Queries ────────────────────────────────────

export async function getByIndex(storeName, indexName, value) {
  await openDB();
  const store = txStore(storeName);
  const index = store.index(indexName);
  return reqToPromise(index.getAll(value));
}

export async function getAllByIndexRange(storeName, indexName, lower, upper) {
  await openDB();
  const store = txStore(storeName);
  const index = store.index(indexName);
  const range = IDBKeyRange.bound(lower, upper);
  return reqToPromise(index.getAll(range));
}

// ── Batch Operations ─────────────────────────────────

export async function putMany(storeName, records) {
  await openDB();
  const tx = dbInstance.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);
  for (const record of records) {
    store.put(record);
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── Multi-Store Transaction ──────────────────────────

export async function transaction(storeNames, mode, callback) {
  await openDB();
  const tx = dbInstance.transaction(storeNames, mode);
  const stores = {};
  for (const name of storeNames) {
    stores[name] = tx.objectStore(name);
  }
  callback(stores);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── Export / Import (Backup) ─────────────────────────

export async function exportAll() {
  await openDB();
  const data = {};
  for (const name of Object.keys(STORES)) {
    data[name] = await getAll(name);
  }
  return data;
}

export async function importAll(data) {
  await openDB();
  for (const [name, records] of Object.entries(data)) {
    if (!STORES[name]) continue;
    await clear(name);
    if (records.length) await putMany(name, records);
  }
}
