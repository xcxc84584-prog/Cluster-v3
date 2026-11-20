/** Cluster-v3 standalone plugin kernel. Host-only management, autonomous plugins. */
import { API_CATALOG, queryCatalog } from "./api-catalog.js";
import { createPublicRepository } from "./public-repository.js";

const copy = value => value === undefined ? undefined : structuredClone(value);
const id = prefix => prefix + "-" + globalThis.crypto.randomUUID();
const now = () => new Date().toISOString();
export class ClusterError extends Error {
  constructor(status, code, message) {
    super(message); this.name = "ClusterError"; this.status = status; this.code = code;
  }
}
const check = (value, label) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new ClusterError(400, "BAD_ARGUMENT", label + " must be a nonempty string");
  }
};
const result = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, data, error: null });
const fail = error => ({ ok: false, status: error.status || 500,
  data: null, error: { code: error.code || "INTERNAL_ERROR", message: error.message } });

export function createPluginKernel({ storage, systemVersion = "0.1.0" } = {}) {
  const repo = createPublicRepository({ storage });
  const plugins = new Map();
  const registry = new Map();
  const handlers = new Map();
  const relations = [];
  const recent = [];
  const persistent = [];
  const listeners = new Map();
  let sequence = 0;

  function record(type, entry = {}) {
    if (!["log", "elog"].includes(type)) throw new ClusterError(400, "BAD_LOG_TYPE", type);
    const item = Object.freeze({
      schemaVersion: "1.0.0", id: id("log"), sequence: ++sequence,
      type, timestamp: now(), level: entry.level || (entry.status >= 400 ? "error" : "info"),
      source: entry.source || "host", target: entry.target || "host",
      action: entry.action || "unknown", status: entry.status ?? 200,
      result: entry.result ?? null, error: entry.error || null,
      requestId: entry.requestId || null, traceId: entry.traceId || null,
      note: entry.note || ""
    });
    recent.push(item);
    if (recent.length > 2000) recent.shift();
    if (type === "elog") persistent.push(item);
    for (const cb of listeners.values()) cb(copy(item));
    return copy(item);
  }
  function publicEntry(pluginId, source, item) {
    const key = source + "." + item;
    if (source === "parameters" && item === "system.version") return systemVersion;
    if (source === "properties" && item === "system.language") return repo.getLanguage();
    if (source === "ui" && item === "palette.baseColor") return repo.getBaseColor();
    if (source === "ui" && item === "palette") return repo.getPalette();
    const entry = registry.get(key);
    if (!entry) throw new ClusterError(404, "NOT_FOUND", key);
    return copy(entry.value);
  }
  function publicSet(pluginId, source, item, value) {
    if (source === "properties" && item === "system.language") {
      repo.setLanguage(value); return result(repo.getLanguage());
    }
    if (source === "ui" && item === "palette.baseColor") {
      repo.setBaseColor(value); return result(repo.getBaseColor());
    }
    if (source === "parameters" && item === "system.version")
      throw new ClusterError(403, "VERSION_AUTHORITY", "PMU owns the system version");
    const key = source + "." + item;
    const entry = registry.get(key);
    if (!entry) throw new ClusterError(404, "NOT_FOUND", key);
    if (entry.owner !== pluginId && !entry.sharedWrite)
      throw new ClusterError(403, "OWNER_ONLY", key);
    entry.value = copy(value); entry.revision++;
    return result(copy(entry.value));
  }
  function makePRMU(pluginId) {
    const subscriptions = new Map();
    return Object.freeze({
      get: (source, item) => result(publicEntry(pluginId, source, item)),
      set: (source, item, value) => publicSet(pluginId, source, item, value),
      list: (source, options = {}) => result([...registry].filter(([key]) =>
        key.startsWith(source + ".")).slice(0, options.limit || 100).map(([key, value]) =>
          ({ key, owner: value.owner, revision: value.revision }))),
      register(source, definition) {
        check(source, "source"); check(definition?.key, "definition.key");
        const key = source + "." + definition.key;
        if (registry.has(key)) throw new ClusterError(409, "ALREADY_REGISTERED", key);
        registry.set(key, { owner: pluginId, value: copy(definition.value),
          sharedWrite: definition.sharedWrite === true,
          persistent: definition.persistent === true, revision: 1 });
        return result({ key }, 201);
      },
      unregister(source, item) {
        const key = source + "." + item, entry = registry.get(key);
        if (entry?.owner !== pluginId) throw new ClusterError(403, "OWNER_ONLY", key);
        registry.delete(key); return result(true);
      },
      subscribe(source, item, callback) {
        const key = id("sub");
        const un = repo.subscribe(({ type, snapshot }) => {
          if ((source === "properties" && item === "system.language" && type === "language") ||
              (source === "ui" && type === "palette")) callback(copy(snapshot));
        });
        subscriptions.set(key, un); return key;
      },
      unsubscribe(key) { subscriptions.get(key)?.(); subscriptions.delete(key); },
      describe(source, item) {
        const key = source + "." + item;
        return result(registry.get(key) ? copy(registry.get(key)) :
          { key, readonly: source === "parameters" });
      },
      snapshot(source) { return result(source === "properties" ? repo.getSnapshot() :
        source === "ui" ? repo.getPalette() :
        source === "parameters" ? { "system.version": systemVersion } : {});
      },
      batch(operations) { return operations.map(op =>
        op.method === "get" ? publicEntry(pluginId, op.source, op.item) :
        publicSet(pluginId, op.source, op.item, op.value).data); },
      dispose() { for (const un of subscriptions.values()) un(); subscriptions.clear(); }
    });
  }
  function makeRouter(pluginId) {
    const owned = new Set();
    return Object.freeze({
      async request(target, action, payload, options = {}) {
        check(target, "target"); check(action, "action");
        const requestId = id("req"), traceId = options.traceId || id("trace");
        const base = { requestId, traceId, timestamp: now(), source: pluginId, target, action };
        relations.push({ ...base, direction: "req" });
        const handler = handlers.get(target + ":" + action);
        if (!handler || !plugins.has(target)) {
          const error = new ClusterError(503, "SERVICE_UNAVAILABLE", target + ":" + action);
          record("elog", { ...base, status: 503, error: fail(error).error });
          relations.push({ ...base, direction: "rep", status: 503 });
          return fail(error);
        }
        try {
          const timeoutMs = Math.max(1, Math.min(60000, options.timeoutMs || 5000));
          const data = await Promise.race([
            Promise.resolve().then(() => handler(copy(payload), copy(base))),
            new Promise((_, reject) => setTimeout(() =>
              reject(new ClusterError(408, "ROUTER_TIMEOUT", action)), timeoutMs))
          ]);
          relations.push({ ...base, direction: "rep", status: 200 });
          record("log", { ...base, status: 200 });
          return result(copy(data));
        } catch (error) {
          relations.push({ ...base, direction: "rep", status: error.status || 500 });
          record("elog", { ...base, status: error.status || 500,
            error: fail(error).error });
          return fail(error);
        }
      },
      respond(requestId, data) { return result({ requestId, data }); },
      register(action, handler) {
        check(action, "action");
        if (typeof handler !== "function") throw new ClusterError(400, "BAD_HANDLER", action);
        const key = pluginId + ":" + action;
        if (handlers.has(key)) throw new ClusterError(409, "ALREADY_REGISTERED", action);
        handlers.set(key, handler); owned.add(key); return result(true, 201);
      },
      unregister(action) { const key = pluginId + ":" + action;
        handlers.delete(key); owned.delete(key); return result(true); },
      get(source, item) { return result({ source, item, relations: relations.length }); },
      list(source, options = {}) {
        const filtered = relations.filter(e => source === "all" ||
          e.source === source || e.target === source);
        return result(filtered.slice(-(options.limit || 100)).map(copy));
      },
      subscribe(source, callback) { const key = id("router-sub");
        listeners.set(key, entry => { if (source === "all" ||
          entry.source === source || entry.target === source) callback(entry); }); return key; },
      unsubscribe(key) { listeners.delete(key); },
      probe(target) { return this.request(target, "router.handshake",
        { protocol: "cluster.router.v1" }); },
      trace(traceId) { return result(relations.filter(x => x.traceId === traceId).map(copy)); },
      dispose() { for (const key of owned) handlers.delete(key); }
    });
  }
  function load(pluginId, manifest = {}) {
    check(pluginId, "pluginId");
    if (plugins.has(pluginId)) throw new ClusterError(409, "ALREADY_LOADED", pluginId);
    const prmu = makePRMU(pluginId), router = makeRouter(pluginId);
    router.register("router.handshake", () => ({ pluginId, protocol: "cluster.router.v1" }));
    const instance = { id: pluginId, manifest: copy(manifest), PRMU: prmu,
      Router: router, state: "active" };
    plugins.set(pluginId, instance);
    record("log", { source: "PMU", target: pluginId, action: "plugin.load" });
    return instance;
  }
  function unload(pluginId) {
    const item = plugins.get(pluginId);
    if (!item) throw new ClusterError(404, "NOT_FOUND", pluginId);
    item.Router.dispose(); item.PRMU.dispose();
    for (const [key, entry] of registry) {
      if (entry.owner === pluginId && !entry.persistent) registry.delete(key);
    }
    plugins.delete(pluginId);
    record("log", { source: "PMU", target: pluginId, action: "plugin.unload" });
  }
  const host = load("cluster.pmu", { core: true, version: systemVersion });
  return Object.freeze({
    host, load, unload, repo,
    get plugins() { return [...plugins.keys()]; },
    catalog: API_CATALOG, queryCatalog,
    log: record,
    logs: (type = "log") => copy(type === "elog" ? persistent : recent),
    inspect: pluginId => ({ id: pluginId, loaded: plugins.has(pluginId),
      relations: relations.filter(x => x.source === pluginId || x.target === pluginId).map(copy) }),
    dispose() { for (const key of [...plugins.keys()]) unload(key); repo.destroy(); }
  });
}
