/** Browser loader: package -> IndexedDB -> service-worker URL -> sandbox. */
import { validatePluginPackage, readZip } from "./package-format.js";
import { createPackageStore } from "./package-store.js";
import { dispatchPluginCall } from "./host-bridge.js";

const PROTOCOL = "cluster.plugin.v1";
const timeoutMs = 10000;
const clone = value => structuredClone(value);
function errorResult(error) {
  return { ok: false, status: error.status || 500, data: null,
    error: { code: error.code || "RUNTIME_ERROR", message: error.message } };
}
export function createBrowserPluginManager({ kernel, pagesRoot,
  settingsFrame, getContext, onChange, onFailure,
  packageStore = null, registerServiceWorker = null }) {
  const store = packageStore || createPackageStore();
  const installed = new Map();
  const frames = new Map();
  const pending = new Map();
  let disposed = false;
  const scopeURL = new URL("../../", import.meta.url);
  const assetURL = (id, file) => new URL(
    "__cluster_plugins/" + encodeURIComponent(id) + "/" +
    file.split("/").map(encodeURIComponent).join("/"), scopeURL).href;

  async function serviceWorkerReady() {
    if (registerServiceWorker) return registerServiceWorker();
    if (!("serviceWorker" in navigator) ||
        !["https:", "http:"].includes(location.protocol)) {
      throw new Error("Plugin pages require a secure HTTP(S) origin and Service Worker");
    }
    const path = new URL("../../plugin-sw.js", import.meta.url);
    await navigator.serviceWorker.register(path, { scope: scopeURL.pathname });
    await navigator.serviceWorker.ready;
  }
  function context(id) {
    return { protocol: PROTOCOL, type: "context", pluginId: id, ...getContext() };
  }
  function currentWindow(id) {
    return frames.get(id)?.iframe.contentWindow || null;
  }
  function sendContext(id, targetWindow) {
    targetWindow?.postMessage(context(id), "*");
  }
  function frameOwner(source) {
    for (const [id, state] of frames) {
      if (state.iframe.contentWindow === source) return id;
      if (settingsFrame.contentWindow === source &&
          settingsFrame.dataset.pluginId === id) return id;
    }
    return null;
  }
  function invoke(pluginId, action, payload, trace) {
    const target = currentWindow(pluginId);
    if (!target) return Promise.reject(new Error("Plugin frame unavailable"));
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error("Plugin action timed out: " + action));
      }, timeoutMs);
      pending.set(requestId, { pluginId, resolve, reject, timer });
      target.postMessage({ protocol: PROTOCOL, type: "invoke", requestId,
        action, payload: clone(payload), trace: clone(trace) }, "*");
    });
  }
  function post(source, payload) {
    source?.postMessage({ protocol: PROTOCOL, ...payload }, "*");
  }
  async function onMessage(event) {
    const pluginId = frameOwner(event.source);
    if (!pluginId) return;
    const message = event.data;
    if (disposed || !message || message.protocol !== PROTOCOL) return;
    if (message.type === "invoke-result") {
      const item = pending.get(message.requestId);
      if (!item || item.pluginId !== pluginId) return;
      clearTimeout(item.timer);
      pending.delete(message.requestId);
      if (message.ok) item.resolve(message.data);
      else {
        const error = new Error(message.error?.message || "Plugin service rejected");
        error.code = message.error?.code || "PLUGIN_REJECTED";
        error.location = message.error?.location || {
          module: "plugin-frame", action: message.action || "unknown"
        };
        item.reject(error);
      }
      return;
    }
    if (message.type === "hello") {
      sendContext(pluginId, event.source);
      return;
    }
    if (message.type !== "request" ||
        typeof message.requestId !== "string" ||
        message.requestId.length > 128 ||
        typeof message.method !== "string" ||
        message.method.length > 128) return;
    try {
      const output = await dispatchPluginCall(
        kernel, pluginId, message.method, message.args, invoke);
      post(event.source, { type: "response",
        requestId: message.requestId, ...output });
    } catch (error) {
      const failure = errorResult(error);
      kernel.log("elog", { source: pluginId, target: "cluster.pmu",
        action: message.method, status: failure.status, error: failure.error,
        location: error.location || { module: "host-bridge.js",
          function: "dispatchPluginCall", method: message.method },
        details: { requestId: message.requestId } });
      post(event.source, { type: "response",
        requestId: message.requestId, ...failure });
    }
  }
  window.addEventListener("message", onMessage);
  const ready = (async () => {
    await serviceWorkerReady();
    const records = await store.list();
    for (const item of records) installed.set(item.id, item);
    for (const item of records) {
      if (item.enabled) {
        try { await load(item.id, false); }
        catch (error) {
          onFailure?.(error);
          kernel.log("elog", { source: "cluster.pmu",
            target: item.id, action: "plugin.restore",
            status: 500, error: errorResult(error).error,
            location: { module: "browser-runtime.js",
              function: "restore", pluginId: item.id } });
        }
      }
    }
    onChange();
  })();
  async function load(pluginId, save = true) {
    if (disposed) throw new Error("Runtime disposed");
    if (frames.has(pluginId)) return kernel.getInstance(pluginId);
    const record = installed.get(pluginId);
    if (!record) throw new Error("Plugin not installed: " + pluginId);
    const manifest = record.manifest;
    const instance = kernel.load(pluginId, {
      ...manifest,
      settingsUrl: manifest.settings ? assetURL(pluginId, manifest.settings) : null
    });
    const host = document.createElement("div");
    host.className = "plugin-main-host";
    host.dataset.pluginId = pluginId;
    host.dataset.inactive = "true";
    host.hidden = false;
    const iframe = document.createElement("iframe");
    iframe.className = "plugin-main-frame";
    iframe.sandbox = "allow-scripts allow-forms";
    iframe.referrerPolicy = "no-referrer";
    iframe.title = manifest.name;
    host.append(iframe);
    pagesRoot.append(host);
    frames.set(pluginId, { iframe, host });
    iframe.addEventListener("load", () => sendContext(pluginId, iframe.contentWindow));
    iframe.src = assetURL(pluginId, manifest.entry);
    try {
      if (save) await store.setEnabled(pluginId, true);
      record.enabled = true;
      onChange();
      return instance;
    } catch (error) {
      frames.delete(pluginId);
      host.remove();
      kernel.unload(pluginId);
      throw error;
    }
  }
  async function unload(pluginId) {
    if (pluginId === "cluster.pmu") throw new Error("Cannot unload PMU");
    const state = frames.get(pluginId);
    if (state) {
      for (const [id, req] of pending) {
        if (req.pluginId === pluginId) {
          clearTimeout(req.timer);
          req.reject(new Error("Plugin unloaded"));
          pending.delete(id);
        }
      }
      state.host.remove();
      frames.delete(pluginId);
      kernel.unload(pluginId);
    }
    if (installed.has(pluginId)) {
      await store.setEnabled(pluginId, false);
      installed.get(pluginId).enabled = false;
    }
    onChange();
  }
  async function reload(pluginId) {
    if (!installed.has(pluginId)) throw new Error("Unknown plugin: " + pluginId);
    if (frames.has(pluginId)) await unload(pluginId);
    return load(pluginId);
  }
  async function configure(pluginId, values = {}) {
    const record = installed.get(pluginId);
    if (!record) throw new Error("Plugin not installed: " + pluginId);
    const editable = ["enabled"];
    for (const key of Object.keys(values)) {
      if (!editable.includes(key)) throw new Error("Unsupported PMU config: " + key);
    }
    if (values.enabled === true) return load(pluginId);
    if (values.enabled === false) return unload(pluginId);
    return record;
  }
  async function remove(pluginId) {
    if (pluginId === "cluster.pmu") throw new Error("Cannot remove PMU");
    await unload(pluginId);
    await store.remove(pluginId);
    installed.delete(pluginId);
    onChange();
  }
  async function installFiles(rawFiles) {
    await ready;
    const { manifest, files } = validatePluginPackage(rawFiles);
    const id = manifest.id;
    const previous = installed.get(id) || null;
    if (frames.has(id)) await unload(id);
    try {
      await store.install(manifest, files);
    } catch (error) {
      // Failed replacement must not leave an already-installed plugin disabled.
      if (previous?.enabled) {
        installed.set(id, previous);
        await load(id).catch(recovery => {
          kernel.log("elog", { source: "cluster.pmu", target: id,
            action: "plugin.install.rollback", status: 500,
            error: errorResult(recovery).error });
        });
      }
      throw error;
    }
    installed.set(id, { id, manifest, enabled: true });
    await load(id);
    onChange();
    return manifest;
  }
  async function installZip(input) {
    const unpacked = await readZip(input);
    return installFiles(unpacked);
  }
  async function installFolder(fileList) {
    const files = {};
    for (const file of Array.from(fileList)) {
      const path = file.webkitRelativePath || file.name;
      files[path] = new Uint8Array(await file.arrayBuffer());
    }
    return installFiles(files);
  }
  function show(pluginId) {
    for (const [id, state] of frames) {
      state.host.hidden = false;
      state.host.dataset.inactive = String(id !== pluginId);
    }
  }
  function attachSettings(pluginId) {
    settingsFrame.dataset.pluginId = pluginId;
    sendContext(pluginId, settingsFrame.contentWindow);
  }
  function syncContext() {
    for (const [id, state] of frames)
      sendContext(id, state.iframe.contentWindow);
    if (settingsFrame.dataset.pluginId)
      sendContext(settingsFrame.dataset.pluginId, settingsFrame.contentWindow);
  }
  return Object.freeze({
    ready, installZip, installFolder, installFiles, load, unload, reload,
    remove, configure, show, attachSettings, syncContext, assetURL,
    list: () => [...installed.values()].map(clone),
    get: id => clone(installed.get(id) || null),
    isLoaded: id => frames.has(id),
    dispose() {
      disposed = true;
      window.removeEventListener("message", onMessage);
      for (const req of pending.values()) {
        clearTimeout(req.timer);
        req.reject(new Error("Plugin manager disposed"));
      }
      pending.clear();
      for (const state of frames.values()) state.host.remove();
    }
  });
}
