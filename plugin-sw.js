/* Cluster-v3 virtual package web server. No third-party network required. */
const DB = "cluster-v3-plugin-packages-v1";
const MIME = {
  html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8", txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8", svg: "image/svg+xml",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", webp: "image/webp", ico: "image/x-icon",
  wasm: "application/wasm", woff: "font/woff", woff2: "font/woff2"
};
self.addEventListener("install", event => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function loadFile(pluginId, path) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const request = db.transaction("files", "readonly")
      .objectStore("files").get([pluginId, path]);
    request.onsuccess = () => resolve(request.result?.data || null);
    request.onerror = () => reject(request.error);
  });
}
const basePath = new URL(self.registration.scope).pathname;
const virtualPrefix = basePath + "__cluster_plugins/";
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin ||
      !url.pathname.startsWith(virtualPrefix)) return;
  event.respondWith((async () => {
    const path = url.pathname.slice(virtualPrefix.length).split("/");
    const pluginId = decodeURIComponent(path.shift() || "");
    const file = path.map(decodeURIComponent).join("/");
    if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(pluginId) ||
        !file || file.split("/").some(x => !x || x === "." || x === "..")) {
      return new Response("Invalid package path", { status: 400 });
    }
    try {
      const data = await loadFile(pluginId, file);
      if (!data) return new Response("Plugin asset not found", { status: 404 });
      const extension = file.split(".").pop().toLowerCase();
      return new Response(data, {
        headers: {
          "Content-Type": MIME[extension] || "application/octet-stream",
          "Access-Control-Allow-Origin": "*",
          "Cross-Origin-Resource-Policy": "cross-origin",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          // Also sandbox package pages opened outside the Host iframe.
          "Content-Security-Policy":
            "sandbox allow-scripts allow-forms; object-src 'none'; base-uri 'none'"
        }
      });
    } catch {
      return new Response("Plugin storage unavailable", { status: 503 });
    }
  })());
});
