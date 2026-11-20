/** IndexedDB package storage, shared by Host and Service Worker. */
export const PLUGIN_DB_NAME = "cluster-v3-plugin-packages-v1";
export function openPackageDatabase() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is required for local plugin loading"));
      return;
    }
    const request = indexedDB.open(PLUGIN_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("packages"))
        db.createObjectStore("packages", { keyPath: "id" });
      if (!db.objectStoreNames.contains("files"))
        db.createObjectStore("files", { keyPath: ["pluginId", "path"] });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export function createPackageStore() {
  const dbReady = openPackageDatabase();
  async function transact(mode, stores, callback) {
    const db = await dbReady;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let output;
      try { output = callback(tx); }
      catch (error) { tx.abort(); reject(error); return; }
      tx.oncomplete = () => resolve(output?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Storage transaction aborted"));
    });
  }
  return Object.freeze({
    ready: dbReady,
    async list() {
      const db = await dbReady;
      return new Promise((resolve, reject) => {
        const request = db.transaction("packages", "readonly")
          .objectStore("packages").getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    },
    async getFiles(pluginId) {
      const db = await dbReady;
      return new Promise((resolve, reject) => {
        const request = db.transaction("files", "readonly")
          .objectStore("files").getAll();
        request.onsuccess = () => {
          const files = Object.create(null);
          for (const entry of request.result) {
            if (entry.pluginId === pluginId)
              files[entry.path] = new Uint8Array(entry.data);
          }
          resolve(files);
        };
        request.onerror = () => reject(request.error);
      });
    },
    async install(manifest, files) {
      const db = await dbReady;
      return new Promise((resolve, reject) => {
        const tx = db.transaction(["packages", "files"], "readwrite");
        const registry = tx.objectStore("packages");
        const assets = tx.objectStore("files");
        const keys = assets.getAllKeys();
        keys.onsuccess = () => {
          for (const key of keys.result) {
            if (key[0] === manifest.id) assets.delete(key);
          }
          for (const [path, data] of Object.entries(files))
            assets.put({ pluginId: manifest.id, path, data: data.slice().buffer });
          registry.put({ id: manifest.id, manifest, enabled: true,
            installedAt: new Date().toISOString() });
        };
        tx.oncomplete = () => resolve(manifest);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error("Package save aborted"));
      });
    },
    async remove(pluginId) {
      const db = await dbReady;
      return new Promise((resolve, reject) => {
        const tx = db.transaction(["packages", "files"], "readwrite");
        tx.objectStore("packages").delete(pluginId);
        const assets = tx.objectStore("files");
        const keys = assets.getAllKeys();
        keys.onsuccess = () => {
          for (const key of keys.result) {
            if (key[0] === pluginId) assets.delete(key);
          }
        };
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error("Package removal aborted"));
      });
    },
    async setEnabled(pluginId, enabled) {
      const db = await dbReady;
      return new Promise((resolve, reject) => {
        const tx = db.transaction("packages", "readwrite");
        const store = tx.objectStore("packages");
        const request = store.get(pluginId);
        request.onsuccess = () => {
          const entry = request.result;
          if (entry) store.put({ ...entry, enabled });
        };
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    }
  });
}
