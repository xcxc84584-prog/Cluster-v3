import { SYSTEM_MANIFEST } from "./system-manifest.js";
/** Cluster-v3 standalone plugin kernel. Host-only management, autonomous plugins. */
import { API_CATALOG, queryCatalog } from "./api-catalog.js";
import { createPublicRepository } from "./public-repository.js";
import { createElogStore } from "./elog-store.js";
import { validateServiceContract } from "./contract-validator.js";

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

export function createPluginKernel({ storage, publicRepo, elogStore, systemVersion = SYSTEM_MANIFEST.version } = {}) {
  const repo = publicRepo || createPublicRepository({ storage });
  const plugins = new Map();
  const registry = new Map();
  const handlers = new Map();
  const serviceContracts = new Map();
  const relations = [];
  const recent = [];
  const persistent = [];
  const failedElogWrites = new Map();
  let elogLastError = null;
  const pluginLogs = new Map();
  const durableLog = elogStore || createElogStore();
  const ready = durableLog.load().then(entries => {
    const known = new Set(persistent.map(item => item.id));
    for (const entry of entries) {
      if (!known.has(entry.id)) persistent.push(entry);
    }
    persistent.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return persistent.length;
  }).catch(error => {
    // ELog storage corruption/permission errors must never fail silently.
    const item = Object.freeze({
      id: id("log"), schemaVersion: "1.0.0", sequence: 0,
      type: "elog", timestamp: now(), level: "error", status: 507,
      source: "cluster.pmu", target: "ELog.Store",
      action: "elog.restore", result: null,
      error: { code: "ELOG_RESTORE_FAILED",
        message: String(error?.message || error) },
      location: { module: "elog-store.js", function: "load" },
      note: "Persistent ELog unavailable; in-memory logging continues"
    });
    recent.push(item);
    persistent.push(item);
    return 0;
  });
  const listeners = new Map();
  const registryListeners = new Map();
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
      note: entry.note || "", location: entry.location || null,
      details: entry.details || null
    });
    recent.push(item);
    if (recent.length > 2000) recent.shift();
    if (type === "elog") {
      persistent.push(item);
      void durableLog.append(item).catch(error => {
        failedElogWrites.set(item.id, item);
        elogLastError = String(error?.message || error);
        // Keep a visible in-memory diagnostic; never recursively persist it.
        const failure = Object.freeze({
          schemaVersion: "1.0.0", id: id("log"), sequence: ++sequence,
          type: "elog", timestamp: now(), level: "error",
          source: "cluster.pmu", target: "ELog.Store",
          action: "elog.persist", status: 507,
          result: null, requestId: null, traceId: null,
          error: { code: "ELOG_STORAGE_FAILED",
            message: String(error?.message || error) },
          location: { module: "elog-store.js", function: "append" },
          details: { originalLogId: item.id }, note: "Persistence requires recovery"
        });
        recent.push(failure);
        if (recent.length > 2000) recent.shift();
        persistent.push(failure);
        for (const listener of listeners.values()) listener(copy(failure));
      });
    }
    for (const pluginId of new Set([item.source, item.target])) {
      if (!plugins.has(pluginId)) continue;
      if (!pluginLogs.has(pluginId)) pluginLogs.set(pluginId, { log: [], elog: [] });
      const local = pluginLogs.get(pluginId);
      local.log.push(item);
      if (local.log.length > 2000) local.log.shift();
      if (type === "elog") local.elog.push(item);
    }
    for (const cb of listeners.values()) cb(copy(item));
    return copy(item);
  }
  async function retryElogPersistence() {
    let succeeded = 0;
    for (const [logId, event] of [...failedElogWrites]) {
      try {
        await durableLog.append(event);
        failedElogWrites.delete(logId);
        succeeded++;
      } catch (error) {
        elogLastError = String(error?.message || error);
        break;
      }
    }
    if (!failedElogWrites.size) elogLastError = null;
    return { ok: !failedElogWrites.size, pending: failedElogWrites.size,
      recovered: succeeded, error: elogLastError };
  }
  function publicEntry(pluginId, source, item) {
    const key = source + "." + item;
    if (source === "parameters" && item === "system.version") return systemVersion;
    if (source === "parameters" && item === "plugin.siteUrl") return repo.getPluginSiteUrl();
    if (source === "parameters" && item === "plugin.managerUrl") return repo.getPluginManagerUrl();
    if (source === "parameters" && item === "community.config") return repo.getCommunityConfig();
    if (source === "parameters" && item === "community.repositoryUrl") return repo.getCommunityRepositoryUrl();
    if (source === "properties" && item === "system.language") return repo.getLanguage();
    if (source === "ui" && item === "palette.baseColor") return repo.getBaseColor();
    if (source === "ui" && item === "palette") return repo.getPalette();
    if (source === "ui" && item === "palette.parameters") return {
      baseColor: repo.getBaseColor(), palette: repo.getPalette()
    };
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
    if (source === "parameters" && ["system.version", "plugin.siteUrl", "plugin.managerUrl", "community.config",
      "community.repositoryUrl"].includes(item))
      throw new ClusterError(403, "VERSION_AUTHORITY", "Host owns this public parameter");
    if (source === "ui" && ["palette", "palette.parameters"].includes(item))
      throw new ClusterError(403, "READ_ONLY", "Use supported palette setters");
    const key = source + "." + item;
    const entry = registry.get(key);
    if (!entry) throw new ClusterError(404, "NOT_FOUND", key);
    if (entry.owner !== pluginId && !entry.sharedWrite)
      throw new ClusterError(403, "OWNER_ONLY", key);
    entry.value = copy(value); entry.revision++;
    for (const listener of registryListeners.values()) {
      if (listener.key === key || listener.key === "*") listener.callback(copy(entry.value));
    }
    return result(copy(entry.value));
  }
  function makePRMU(pluginId) {
    const subscriptions = new Map();
    function emitRegistry(key, value) {
      for (const listener of registryListeners.values()) {
        if (listener.key === key || listener.key === "*") listener.callback(copy(value));
      }
    }
    return Object.freeze({
      get: (source, item) => result(publicEntry(pluginId, source, item)),
      getUIColorParameters: () => result({
        baseColor: repo.getBaseColor(), palette: repo.getPalette()
      }),
      setUIColorBaseColor: color => publicSet(pluginId, "ui", "palette.baseColor", color),
      getVersion: () => result(systemVersion),
      getPluginSiteUrl: () => result(repo.getPluginSiteUrl()),
      getPluginManagerUrl: () => result(repo.getPluginManagerUrl()),
      getCommunityConfig: () => result(repo.getCommunityConfig()),
      getCommunityRepositoryUrl: () => result(repo.getCommunityRepositoryUrl()),
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
        emitRegistry(key, definition.value);
        return result({ key }, 201);
      },
      unregister(source, item) {
        const key = source + "." + item, entry = registry.get(key);
        if (entry?.owner !== pluginId) throw new ClusterError(403, "OWNER_ONLY", key);
        registry.delete(key); emitRegistry(key, undefined); return result(true);
      },
      subscribe(source, item, callback) {
        if (typeof callback !== "function")
          throw new ClusterError(400, "BAD_CALLBACK", "callback must be a function");
        const key = id("sub");
        let un;
        if (source === "properties" || source === "ui") {
          un = repo.subscribe(({ type, snapshot }) => {
            if ((source === "properties" && item === "system.language" && type === "language") ||
                (source === "ui" && type === "palette")) callback(copy(snapshot));
          });
        } else {
          registryListeners.set(key, { key: source + "." + item, callback });
          un = () => registryListeners.delete(key);
        }
        subscriptions.set(key, un);
        return key;
      },
      unsubscribe(key) { subscriptions.get(key)?.(); subscriptions.delete(key); },
      describe(source, item) {
        const key = source + "." + item;
        return result(registry.get(key) ? copy(registry.get(key)) :
          { key, readonly: source === "parameters" ||
            (source === "ui" && ["palette", "palette.parameters"].includes(item)) });
      },
      snapshot(source) { return result(source === "properties" ? repo.getSnapshot() :
        source === "ui" ? repo.getPalette() :
        source === "parameters" ? { "system.version": systemVersion,
          "plugin.siteUrl": repo.getPluginSiteUrl(),
          "plugin.managerUrl": repo.getPluginManagerUrl(),
          "community.config": repo.getCommunityConfig(),
          "community.repositoryUrl": repo.getCommunityRepositoryUrl() } : {});
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
        const contract = serviceContracts.get(target + ":" + action);
        if (!handler || !plugins.has(target)) {
          const error = new ClusterError(503, "SERVICE_UNAVAILABLE", target + ":" + action);
          record("elog", { ...base, status: 503, error: fail(error).error });
          relations.push({ ...base, direction: "rep", status: 503 });
          return fail(error);
        }
        try {
          if (contract) validateServiceContract(contract, payload);
          const timeoutMs = Math.max(1, Math.min(60000, options.timeoutMs || 5000));
          let timeout;
          let data;
          try {
            data = await Promise.race([
              Promise.resolve().then(() => handler(copy(payload), copy(base))),
              new Promise((_, reject) => {
                timeout = setTimeout(() =>
                  reject(new ClusterError(408, "ROUTER_TIMEOUT", action)), timeoutMs);
              })
            ]);
          } finally {
            clearTimeout(timeout);
          }
          if (contract) validateServiceContract(contract, data, true);
          relations.push({ ...base, direction: "rep", status: 200 });
          record("log", { ...base, status: 200 });
          return result(copy(data));
        } catch (error) {
          relations.push({ ...base, direction: "rep", status: error.status || 500 });
          record("elog", { ...base, status: error.status || 500,
            error: fail(error).error, location: error.location || null });
          return fail(error);
        }
      },
      respond(requestId, data) { return result({ requestId, data }); },
      register(action, handler, options = {}) {
        check(action, "action");
        if (typeof handler !== "function") throw new ClusterError(400, "BAD_HANDLER", action);
        const key = pluginId + ":" + action;
        if (handlers.has(key)) throw new ClusterError(409, "ALREADY_REGISTERED", action);
        if (options.contract) {
          const contract = { ...copy(options.contract), action, owner: pluginId,
            id: key, version: options.contract.version || "1.0.0" };
          // Dry-run schema structure before registration.
          if (contract.request && typeof contract.request !== "object")
            throw new ClusterError(400, "BAD_CONTRACT", "Request schema must be an object");
          if (contract.response && typeof contract.response !== "object")
            throw new ClusterError(400, "BAD_CONTRACT", "Response schema must be an object");
          serviceContracts.set(key, contract);
        }
        handlers.set(key, handler); owned.add(key); return result(true, 201);
      },
      unregister(action) { const key = pluginId + ":" + action;
        handlers.delete(key); serviceContracts.delete(key);
        owned.delete(key); return result(true); },
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
      dispose() { for (const key of owned) {
        handlers.delete(key);
        serviceContracts.delete(key);
      } }
    });
  }
  function load(pluginId, manifest = {}) {
    check(pluginId, "pluginId");
    if (plugins.has(pluginId)) throw new ClusterError(409, "ALREADY_LOADED", pluginId);
    const prmu = makePRMU(pluginId), router = makeRouter(pluginId);
    router.register("router.handshake", () => ({ pluginId, protocol: "cluster.router.v1" }));
    const instance = { id: pluginId, manifest: copy(manifest), PRMU: prmu,
      Router: router, state: "active", ready: null };
    const existing = [...plugins.keys()];
    plugins.set(pluginId, instance);
    // A new router sends a req and receives a correlated rep from every
    // registered target. Failures are preserved in ELog by Router.request().
    instance.ready = Promise.all(existing.map(target =>
      router.probe(target).then(reply => {
        if (!reply.ok) record("elog", {
          source: pluginId, target, action: "router.initialize",
          status: reply.status, error: reply.error
        });
        return reply;
      })));

    record("log", { source: "PMU", target: pluginId, action: "plugin.load" });
    return instance;
  }
  function unload(pluginId) {
    if (pluginId === "cluster.pmu") {
      throw new ClusterError(403, "CORE_PROTECTED", "PMU cannot be unloaded");
    }
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
    contract: Object.freeze({
      get: key => copy(serviceContracts.get(key) || null),
      list: () => [...serviceContracts.values()].map(copy),
      register(pluginId, definition) {
        check(pluginId, "pluginId");
        check(definition?.action, "action");
        if (!plugins.has(pluginId)) throw new ClusterError(404, "NOT_FOUND", pluginId);
        const key = pluginId + ":" + definition.action;
        if (serviceContracts.has(key)) throw new ClusterError(409, "ALREADY_REGISTERED", key);
        serviceContracts.set(key, { ...copy(definition), owner: pluginId, id: key });
        return result({ id: key }, 201);
      },
      unregister(pluginId, action) {
        const key = pluginId + ":" + action;
        if (!serviceContracts.has(key))
          throw new ClusterError(404, "NOT_FOUND", key);
        serviceContracts.delete(key);
        return result(true);
      },
      validate: (pluginId, action, payload, response = false) =>
        validateServiceContract(serviceContracts.get(pluginId + ":" + action) ||
          { id: pluginId + ":" + action }, payload, response)
    }),
    getManifest: pluginId => copy(plugins.get(pluginId)?.manifest ?? null),
    getInstance: pluginId => plugins.get(pluginId) || null,
    get plugins() { return [...plugins.keys()]; },
    catalog: API_CATALOG, queryCatalog,
    log: record,
    logs: (type = "log") => copy(type === "elog" ? persistent : recent),
    ready,
    pluginLogs: pluginId => copy(pluginLogs.get(pluginId) || { log: [], elog: [] }),
    elogStatus: () => ({ pending: failedElogWrites.size, error: elogLastError,
      durable: durableLog.durable ?? null }),
    retryElogPersistence,
    inspect: pluginId => ({ id: pluginId, loaded: plugins.has(pluginId),
      relations: relations.filter(x => x.source === pluginId || x.target === pluginId).map(copy) }),
    dispose() {
      for (const key of [...plugins.keys()]) {
        if (key !== "cluster.pmu") unload(key);
      }
      host.Router.dispose();
      host.PRMU.dispose();
      if (!publicRepo) repo.destroy();
    }
  });
}
