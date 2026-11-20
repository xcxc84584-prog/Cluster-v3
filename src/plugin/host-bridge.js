/** Runtime call allowlist. PMU lifecycle stays Host-owned. */
import { API_CATALOG } from "../core/api-catalog.js";
import { validateAPIRequest, validateAPIResponse } from "../core/contract-validator.js";

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
  const canonical = method === "PMU.log" ? "Log.log" :
    method === "PMU.logs" ? "Log.logs" : method;
  // Translate callback-only bridge arguments to a JSON-serializable
  // placeholder before checking the advertised function signature.
  const validateArgs = method === "Router.register" ?
    [args[0], "runtime-callback", args[2]] :
    method === "PMU.get" && args.length === 1 ?
      [args[0], "manifest"] :
    method === "PMU.logs" && args.length === 0 ?
      [pluginId] :
    method === "Router.list" && args.length < 2 ?
      [pluginId, args[0]] :
    method === "Contract.get" && args.length === 1 ?
      ["contracts", args[0]] : args;
  // PMU lifecycle methods are never dispatched by untrusted plugin frames.
  if (["PMU.install", "PMU.uninstall", "PMU.load",
       "PMU.unload", "PMU.reload", "Runtime.mount",
       "Runtime.unmount"].includes(method)) {
    const denied = new Error("Host-only API: " + method);
    denied.status = 403;
    denied.code = "HOST_ONLY";
    throw denied;
  }
  const api = validateAPIRequest(API_CATALOG, canonical, validateArgs);
  let output;
  const run = async () => {
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
        invoke(pluginId, action, payload, context), args[2] || {});
    }
    case "Router.unregister": return instance.Router.unregister(args[0]);
    case "Router.probe": return instance.Router.probe(args[0]);
    case "Router.list": return instance.Router.list(pluginId, args[0]);
    case "Router.trace": return instance.Router.trace(args[0]);
    case "Contract.register":
      return kernel.contract.register(pluginId, args[0]);
    case "Contract.unregister": {
      const contract = kernel.contract.get(args[0]);
      if (!contract || contract.owner !== pluginId)
        throw invalid("Cannot remove another plugin's contract");
      return kernel.contract.unregister(pluginId, contract.action);
    }
    case "Contract.get": return { ok: true, status: 200,
      data: kernel.contract.get(args[1]) || null, error: null };
    case "Contract.validate": {
      const definition = kernel.contract.get(args[0]);
      if (!definition) throw invalid("Contract not registered");
      kernel.contract.validate(definition.owner, definition.action, args[1], false);
      return { ok: true, status: 200, data: true, error: null };
    }
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
      data: [...API_CATALOG, ...kernel.contract.list()], error: null };
    default: {
      const err = new Error("Unknown or unavailable plugin API: " + method);
      err.code = "API_UNAVAILABLE";
      err.status = 404;
      throw err;
    }
  }
  };
  const response = await run();
  validateAPIResponse(api, response);
  return response;
}
