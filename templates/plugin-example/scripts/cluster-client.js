/* Generic Cluster-v3 plugin client; no direct Host DOM access. */
(() => {
  "use strict";
  const protocol = "cluster.plugin.v1";
  const pending = new Map();
  const handlers = new Map();
  const contextListeners = new Set();
  let context = null;
  // Sandboxed opaque-origin iframes may not expose crypto.randomUUID().
  // getRandomValues remains available and preserves strong request IDs.
  const id = () => {
    const values = crypto.getRandomValues(new Uint8Array(16));
    return [...values].map(byte => byte.toString(16).padStart(2, "0")).join("");
  };
  function applyContext(value) {
    context = value;
    document.documentElement.lang = value.language || "zh-TW";
    for (const [name, color] of Object.entries(value.palette || {})) {
      if (/^#[0-9a-f]{6}$/i.test(color))
        document.documentElement.style.setProperty("--ui-" + name, color);
    }
    for (const fn of contextListeners) fn(context);
  }
  window.addEventListener("message", async event => {
    if (event.source !== parent) return;
    const message = event.data || {};
    if (message.protocol === "cluster.settings.context.v1") {
      applyContext(message);
      return;
    }
    if (message.protocol !== protocol) return;
    if (message.type === "context") {
      applyContext(message);
    } else if (message.type === "response") {
      const request = pending.get(message.requestId);
      if (!request) return;
      clearTimeout(request.timer);
      pending.delete(message.requestId);
      request.resolve(message);
    } else if (message.type === "invoke") {
      const handler = handlers.get(message.action);
      try {
        if (!handler) throw Error("Unknown action: " + message.action);
        const value = await handler(message.payload, message.trace);
        parent.postMessage({ protocol, type: "invoke-result",
          requestId: message.requestId, ok: true, data: value }, "*");
      } catch (error) {
        parent.postMessage({ protocol, type: "invoke-result",
          requestId: message.requestId, ok: false,
          error: { message: String(error.message || error) } }, "*");
      }
    }
  });
  function request(method, ...args) {
    const requestId = id();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(Error("Host request timeout: " + method));
      }, 12000);
      pending.set(requestId, { resolve, reject, timer });
      parent.postMessage({ protocol, type: "request", requestId, method, args }, "*");
    });
  }
  window.Cluster = Object.freeze({
    request,
    context: () => context,
    onContext(handler) {
      contextListeners.add(handler);
      if (context) handler(context);
      return () => contextListeners.delete(handler);
    },
    PRMU: Object.freeze({
      get: (source, item) => request("PRMU.get", source, item),
      resolveCapability: capability => request("PRMU.resolveCapability", capability),
      set: (source, item, value) => request("PRMU.set", source, item, value),
      register: (source, definition) => request("PRMU.register", source, definition),
      list: source => request("PRMU.list", source)
    }),
    Router: Object.freeze({
      request: (target, action, payload) =>
        request("Router.request", target, action, payload),
      async register(action, handler, options = {}) {
        const result = await request("Router.register",
          action, "runtime-callback", options);
        if (result.ok) handlers.set(action, handler);
        return result;
      },
      unregister: async action => {
        const result = await request("Router.unregister", action);
        if (result.ok) handlers.delete(action);
        return result;
      }
    }),
    Contract: Object.freeze({
      register: definition => request("Contract.register", definition),
      unregister: id => request("Contract.unregister", id),
      list: () => request("Contract.list", "all")
    }),
    PMU: Object.freeze({
      log: (type, entry) => request("PMU.log", type, entry),
      get: () => request("PMU.get", "self"),
      list: () => request("PMU.list")
    })
  });
  parent.postMessage({ protocol, type: "hello" }, "*");
})();
