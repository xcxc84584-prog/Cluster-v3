/** Browser loader: package -> IndexedDB -> service-worker URL -> plugin iframe. */
import { validatePluginPackage, readZip, createZip } from "./package-format.js";
import { createPackageStore } from "./package-store.js";
import { dispatchPluginCall } from "./host-bridge.js";
import { buildPluginDocument } from "./document-bundler.js";

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
  const temporaryFiles = new Map(); // Session-only: never stored in IndexedDB.
  const frames = new Map();
  const pending = new Map();
  const auxiliaryFrames = new Map();
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
  async function renderAssetFrame(id, path, frame, shouldRender = () => true) {
    const files = temporaryFiles.get(id) || await store.getFiles?.(id);
    // A tab/plugin selection can change while IndexedDB resolves.
    // Never mount an old plugin document into the current settings frame.
    if (!shouldRender()) return "cancelled";
    if (files && files[path] && typeof DOMParser !== "undefined") {
      frame.removeAttribute("src");
      frame.srcdoc = buildPluginDocument(files, path);
      frame.dataset.virtualPath = path;
      return "srcdoc";
    }
    if (packageStore) {
      if (!shouldRender()) return "cancelled";
      frame.src = assetURL(id, path);
      return "virtual";
    }
    throw Error("Installed plugin file not found: " + id + "/" + path);
  }
  function frameOwner(source) {
    for (const [frame, id] of auxiliaryFrames) {
      if (frame.isConnected && frame.contentWindow === source &&
          frames.has(id)) return id;
    }
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
  /** Resolve UI capability using the generic PRMU registration. */
  async function resolveCapability(capability) {
    if (typeof capability !== "string" ||
        !/^[a-z][a-z0-9.-]{2,100}$/.test(capability)) {
      const error = new Error("Invalid capability ID");
      error.status = 400; error.code = "BAD_CAPABILITY"; throw error;
    }
    const entries = kernel.host.PRMU.list("capabilities", { limit: 1000 }).data;
    const selected = entries.find(entry =>
      entry.key === "capabilities." + capability);
    if (!selected) {
      const error = new Error("Capability not registered: " + capability);
      error.status = 404; error.code = "CAPABILITY_NOT_FOUND"; throw error;
    }
    const pluginId = selected.owner;
    const record = installed.get(pluginId);
    if (!record?.enabled || !frames.has(pluginId)) {
      const error = new Error("Capability provider is not loaded");
      error.status = 503; error.code = "PROVIDER_UNAVAILABLE"; throw error;
    }
    const descriptor = kernel.host.PRMU.get("capabilities", capability).data;
    if (descriptor?.kind !== "ui.embed" || descriptor?.version !== "1.0.0") {
      const error = new Error("Unsupported capability descriptor");
      error.status = 400; error.code = "BAD_DESCRIPTOR"; throw error;
    }
    const files = temporaryFiles.get(pluginId) ||
      await store.getFiles?.(pluginId);
    // A provider may expose multiple UI components, each in its own
    // packaged HTML file. Never accept network URLs or path traversal.
    const entry = descriptor.entry || record.manifest.entry;
    if (typeof entry !== "string" ||
        !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_.-]+)*\.html$/.test(entry) ||
        entry.split("/").includes("..")) {
      const error = new Error("Capability entry must be a package-local HTML file");
      error.status = 400; error.code = "BAD_UI_ENTRY"; throw error;
    }
    if (!files?.[entry]) {
      const error = new Error("Capability entry resource unavailable");
      error.status = 404; error.code = "ENTRY_NOT_FOUND"; throw error;
    }
    return { capability, pluginId, version: record.manifest.version,
      html: buildPluginDocument(files, entry) };
  }

  async function onMessage(event) {
    const pluginId = frameOwner(event.source);
    if (!pluginId) return;
    const message = event.data;
    if (disposed || !message) return;
    if (message.protocol !== PROTOCOL) return;
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
        kernel, pluginId, message.method, message.args, invoke, resolveCapability);
      post(event.source, { type: "response",
        requestId: message.requestId, ...output });
      // Plugin APIs are registered asynchronously after iframe load.
      // Refresh the selected plugin's API List as soon as its registry changes.
      if (output?.ok && ["Router.register", "Router.unregister",
          "Contract.register", "Contract.unregister"].includes(message.method)) {
        onChange?.();
      }
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
    // Unrestricted iframe: inherits Host origin for srcdoc-based plugins.
    // WARNING: installed plugin code can access Host DOM and origin storage.
    iframe.referrerPolicy = "no-referrer";
    iframe.title = manifest.name;
    host.append(iframe);
    pagesRoot.append(host);
    frames.set(pluginId, { iframe, host });
    iframe.addEventListener("load", () => sendContext(pluginId, iframe.contentWindow));
    try {
      await renderAssetFrame(pluginId, manifest.entry, iframe);
      if (save && !temporaryFiles.has(pluginId))
        await store.setEnabled(pluginId, true);
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
      for (const [frame, owner] of auxiliaryFrames) {
        if (owner === pluginId) auxiliaryFrames.delete(frame);
      }
      kernel.unload(pluginId);
    }
    if (installed.has(pluginId)) {
      if (!temporaryFiles.has(pluginId)) await store.setEnabled(pluginId, false);
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
    if (!temporaryFiles.has(pluginId)) await store.remove(pluginId);
    temporaryFiles.delete(pluginId);
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
  async function installTemporaryFiles(rawFiles) {
    await ready;
    const { manifest, files } = validatePluginPackage(rawFiles);
    const id = manifest.id;
    if (installed.has(id) && !temporaryFiles.has(id)) {
      const error = new Error("Plugin already installed persistently: " + id);
      error.code = "PLUGIN_ID_CONFLICT"; error.status = 409;
      throw error;
    }
    if (frames.has(id)) await unload(id);
    temporaryFiles.set(id, files);
    installed.set(id, { id, manifest, enabled: true, temporary: true });
    try { await load(id, false); }
    catch (error) {
      temporaryFiles.delete(id); installed.delete(id); onChange(); throw error;
    }
    onChange();
    return manifest;
  }
  /**
   * Replace the entire managed plugin project with validated session packages.
   * Snapshot existing packages (including persisted bytes) before removal.
   * On import failure, restore previous plugin records and their enabled states.
   * New imports never write their package bytes to IndexedDB.
   */
  async function replaceTemporaryProject(packages) {
    await ready;
    if (!Array.isArray(packages) || !packages.length)
      throw new Error("A new project must contain at least one plugin");
    // Validate the full incoming project before mutating any current plugin.
    const incoming = [];
    const incomingIds = new Set();
    for (const pkg of packages) {
      const checked = validatePluginPackage(pkg.files);
      if (incomingIds.has(checked.manifest.id))
        throw new Error("Duplicate incoming plugin: " + checked.manifest.id);
      incomingIds.add(checked.manifest.id);
      incoming.push(checked);
    }
    const previous = [];
    for (const record of installed.values()) {
      const files = temporaryFiles.get(record.id) ||
        await store.getFiles?.(record.id);
      if (!files) throw new Error("Cannot back up plugin: " + record.id);
      previous.push({ record: clone(record), files: clone(files),
        temporary: temporaryFiles.has(record.id),
        loaded: frames.has(record.id) });
    }
    try {
      for (const record of [...installed.values()])
        await remove(record.id);
      for (const pkg of incoming) await installTemporaryFiles(pkg.files);
      return incoming.map(pkg => clone(pkg.manifest));
    } catch (cause) {
      const rollbackErrors = [];
      // Remove anything from the failed new project before restoring.
      for (const record of [...installed.values()]) {
        try { await remove(record.id); }
        catch (error) { rollbackErrors.push(error); }
      }
      for (const previousPlugin of previous) {
        const { record, files, temporary, loaded } = previousPlugin;
        try {
          if (temporary) {
            temporaryFiles.set(record.id, files);
          } else {
            await store.install(record.manifest, files);
          }
          installed.set(record.id, clone(record));
          if (loaded) {
            await load(record.id, false);
          } else if (!temporary) {
            await store.setEnabled(record.id, Boolean(record.enabled));
          }
        } catch (error) { rollbackErrors.push(error); }
      }
      onChange();
      if (rollbackErrors.length) {
        const error = new Error(
          "Project load failed and rollback was incomplete: " +
          rollbackErrors.map(item => item.message).join("; "));
        error.code = "PROJECT_ROLLBACK_INCOMPLETE";
        error.cause = cause;
        throw error;
      }
      throw cause;
    }
  }
  async function exportProjectPackages() {
    await ready;
    const packages = [];
    for (const record of installed.values()) {
      const files = temporaryFiles.get(record.id) ||
        await store.getFiles?.(record.id);
      if (!files) throw new Error("Missing plugin files: " + record.id);
      packages.push({ manifest: record.manifest, files });
    }
    return packages;
  }
  async function exportZip(pluginId) {
    const item = installed.get(pluginId);
    if (!item) throw new Error("Plugin not installed: " + pluginId);
    const files = temporaryFiles.get(pluginId) ||
      await store.getFiles?.(pluginId);
    if (!files || !Object.keys(files).length)
      throw new Error("Plugin files are unavailable for download: " + pluginId);
    return createZip(files);
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
  function registerAuxiliaryFrame(pluginId, frame) {
    if (!frames.has(pluginId))
      throw new Error("Plugin is not active: " + pluginId);
    auxiliaryFrames.set(frame, pluginId);
    frame.addEventListener("load", () =>
      sendContext(pluginId, frame.contentWindow));
    return () => auxiliaryFrames.delete(frame);
  }
  function syncContext() {
    for (const [id, state] of frames)
      sendContext(id, state.iframe.contentWindow);
    for (const [frame, id] of auxiliaryFrames)
      if (frame.isConnected) sendContext(id, frame.contentWindow);
    if (settingsFrame.dataset.pluginId)
      sendContext(settingsFrame.dataset.pluginId, settingsFrame.contentWindow);
  }
  return Object.freeze({
    ready, installZip, installFolder, installFiles, installTemporaryFiles,
    exportProjectPackages, replaceTemporaryProject, exportZip, load, unload, reload,
    remove, configure, show, attachSettings, syncContext, assetURL,
    renderAssetFrame, registerAuxiliaryFrame,
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
      auxiliaryFrames.clear();
      temporaryFiles.clear();
    }
  });
}
