/** Append-only browser ELog store. Export/backup is required for archival guarantees. */
export function createElogStore(name = "cluster-v3-elog-v1") {
  function dbOpen() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") { resolve(null); return; }
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("records")) {
          const store = db.createObjectStore("records", { keyPath: "id" });
          store.createIndex("sequence", "sequence");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  const dbPromise = dbOpen();
  async function transact(mode, handler) {
    const db = await dbPromise;
    if (!db) return null;
    return new Promise((resolve, reject) => {
      const tx = db.transaction("records", mode);
      const store = tx.objectStore("records");
      const request = handler(store);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  return Object.freeze({
    durable: typeof indexedDB !== "undefined",
    append: entry => transact("readwrite", store => store.put(entry)),
    load: async () => (await transact("readonly", store => store.getAll())) || [],
    async count() { return (await transact("readonly", store => store.count())) || 0; }
  });
}
