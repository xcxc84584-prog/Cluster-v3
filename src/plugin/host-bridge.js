/** Runtime call allowlist. PMU lifecycle stays Host-owned. */
import { API_CATALOG } from "../core/api-catalog.js";

function invalid(message) {
  const err = new Error(message);
  err.code = "BAD_PLUGIN_CALL";
  err.status = 400;
  return err;
}
export async function dispatchPluginCall(kernel, pluginId, method, args, invoke) {
  if (!Array.isArray(args) || args.length > 8)
    throw invalid("Arguments must be an array of up to eight items");
  const instance = kernel.getInstance(pluginId);
  if (!instance) throw invalid("Plugin is not loaded");
  switch (method) {
    case "PRMU.get": return instance.PRMU.get(args[0], args[1]);
    case "PRMU.set": return instance.PRMU.set(args[0], args[1], args[2]);
    case "PRMU.list": return instance.PRMU.list(args[0], args[1]);
    case "PRMU.describe": return instance.PRMU.describe(args[0], args[1]);
    case "PRMU.snapshot": return instance.PRMU.snapshot(args[0]);
    case "PRMU.register": return instance.PRMU.register(args[0], args[1]);
    case "PRMU.unregister": return instance.PRMU.unregister(args[0], args[1]);
    case "Router.request":
      return instance.Router.request(args[0], args[1], args[2], args[3]);
    case "Router.register": {
      const action = args[0];
      return instance.Router.register(action, (payload, context) =>
        invoke(pluginId, action, payload, context));
    }
    case "Router.unregister": return instance.Router.unregister(args[0]);
    case "Router.probe": return instance.Router.probe(args[0]);
    case "Router.list": return instance.Router.list(pluginId, args[0]);
    case "Router.trace": return instance.Router.trace(args[0]);
    case "PMU.log": {
      if (!["log", "elog"].includes(args[0])) throw invalid("Invalid log type");
      const entry = args[1] || {};
      return { ok: true, status: 201, data: kernel.log(args[0], {
        ...entry, source: pluginId
      }), error: null };
    }
    case "PMU.logs": return { ok: true, status: 200,
      data: kernel.pluginLogs(pluginId), error: null };
    case "PMU.get": return { ok: true, status: 200,
      data: args[0] === "system" ? kernel.host.PRMU.snapshot("parameters").data :
        kernel.getManifest(pluginId), error: null };
    case "PMU.list": return { ok: true, status: 200,
      data: kernel.plugins, error: null };
    case "Contract.list": return { ok: true, status: 200,
      data: API_CATALOG.filter(api => api.implementation !== "planned"), error: null };
    default: {
      const err = new Error("Unknown or unavailable plugin API: " + method);
      err.code = "API_UNAVAILABLE";
      err.status = 404;
      throw err;
    }
  }
}
