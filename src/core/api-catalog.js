/** API catalog is the discoverable contract, not a hard-coded UI-only list. */
const groups = {
  PRMU: [
    ["get","read","Read a public value","source:string,item:string,options?:object"],
    ["resolveCapability","read","Resolve registered embeddable UI capability via Host","capability:string"],
    ["getUIColorParameters","read","Read global UI base RGB and all derived palette tokens",""],
    ["openUIColorPalette","execute","Open the Host public UI palette settings dialog",""],
    ["setUIColorBaseColor","write","Set the authoritative shared base RGB color for all plugin UIs","color:string"],
    ["getVersion","read","Read authoritative Host system version",""],
    ["getPluginSiteUrl","read","Read canonical Cluster home URL",""],
    ["getPluginManagerUrl","read","Read canonical Plugin Manager URL from PRMU",""],
    ["getCommunityConfig","read","Read authoritative community registry configuration and limits",""],
    ["getCommunityRepositoryUrl","read","Read the unique community source repository URL",""],
    ["set","write","Update a writable public value","source:string,item:string,value:any,options?:object"],
    ["list","read","Enumerate public entries","source:string,options?:object"],
    ["register","write","Register owned public data","source:string,definition:object"],
    ["unregister","write","Remove an owned registration","source:string,item:string"],
    ["subscribe","execute","Observe changes","source:string,item:string,callback:function"],
    ["unsubscribe","execute","Remove an observer","subscriptionId:string"],
    ["describe","read","Read entry metadata","source:string,item:string"],
    ["snapshot","read","Read a consistent repository snapshot","source:string,options?:object"],
    ["batch","write","Run a validated batch","operations:array,options?:object"]
  ],
  PMU: [
    ["get","read","Read plugin metadata","source:string,item:string,options?:object"],
    ["list","read","List installed plugins","options?:object"],
    ["install","execute","Install a package","source:string,options?:object"],
    ["uninstall","execute","Remove a plugin","pluginId:string,options?:object"],
    ["load","execute","Start a plugin runtime","pluginId:string,options?:object"],
    ["unload","execute","Stop a plugin runtime","pluginId:string,options?:object"],
    ["reload","execute","Restart a plugin runtime","pluginId:string,options?:object"],
    ["configure","write","Configure a plugin","pluginId:string,config:object"],
    ["inspect","read","Inspect plugin runtime units","pluginId:string,options?:object"]
  ],
  Router: [
    ["request","execute","Send a correlated request","target:string,action:string,payload:any,options?:object"],
    ["respond","execute","Reply to pending request","requestId:string,result:any,options?:object"],
    ["register","write","Register action handler","action:string,handler:function,options?:object"],
    ["unregister","write","Unregister owned handler","action:string"],
    ["get","read","Read router metadata","source:string,item:string,options?:object"],
    ["list","read","Enumerate dependency events","source:string,options?:object"],
    ["subscribe","execute","Observe router events","source:string,callback:function"],
    ["unsubscribe","execute","Remove router observer","subscriptionId:string"],
    ["probe","execute","Handshake with a target","target:string,options?:object"],
    ["trace","read","Read correlated events","traceId:string,options?:object"]
  ],
  Log: [
    ["log","write","Append log or permanent elog","type:string,entry:object"],
    ["logs","read","Query recorded events","source:string,options?:object"],
    ["logGet","read","Read one event","logId:string,options?:object"],
    ["logStats","read","Summarize status counts","source:string,options?:object"],
    ["logSubscribe","execute","Observe new entries","filter:object,callback:function"],
    ["logUnsubscribe","execute","Remove log observer","subscriptionId:string"],
    ["logExport","read","Export JSON or JSONL","source:string,options?:object"],
    ["logVerify","read","Inspect recorded event integrity","source:string,options?:object"]
  ],
  Runtime: [
    ["get","read","Read runtime state","item:string,options?:object"],
    ["mount","execute","Mount plugin web app","target:string,options?:object"],
    ["unmount","execute","Unmount plugin web app","target:string,options?:object"],
    ["emit","execute","Emit runtime event","event:string,data:any"],
    ["subscribe","execute","Observe runtime event","event:string,handler:function"],
    ["unsubscribe","execute","Remove runtime observer","subscriptionId:string"]
  ],
  Contract: [
    ["get","read","Read contract definition","source:string,item:string,options?:object"],
    ["list","read","List contracts","source:string,options?:object"],
    ["register","write","Publish a service schema","definition:object"],
    ["unregister","write","Remove owned schema","contractId:string"],
    ["validate","execute","Validate payload against contract","contractId:string,payload:any"]
  ]
};
export const API_CATALOG_VERSION = "1.1.0";
const hostOnly = new Set([
  "PMU.install", "PMU.uninstall", "PMU.load", "PMU.unload",
  "Runtime.mount", "Runtime.unmount"
]);
const implemented = new Set([
  "PMU.get", "PMU.list", "Contract.list", "Contract.get",
  "Contract.register", "Contract.unregister", "Contract.validate",
  "PRMU.get", "PRMU.resolveCapability", "PRMU.getUIColorParameters",
  "PRMU.openUIColorPalette",
  "PRMU.setUIColorBaseColor", "PRMU.getVersion",
  "PRMU.getPluginSiteUrl", "PRMU.getCommunityConfig",
  "PRMU.getCommunityRepositoryUrl", "PRMU.set", "PRMU.list", "PRMU.register",
  "PRMU.unregister", "PRMU.subscribe", "PRMU.unsubscribe",
  "PRMU.describe", "PRMU.snapshot", "PRMU.batch",
  "Router.request", "Router.register", "Router.unregister",
  "Router.get", "Router.list", "Router.probe", "Router.trace",
  "Log.log", "Log.logs"
]);
function requestSchema(signature) {
  const properties = {};
  const required = [];
  for (const part of signature ? signature.split(",") : []) {
    const [rawKey, rawType] = part.trim().split(":");
    const optional = rawKey.endsWith("?");
    const key = optional ? rawKey.slice(0, -1) : rawKey;
    const type = rawType === "any" ? undefined :
      rawType === "function" ? "string" : rawType;
    properties[key] = type ? { type } : {};
    if (rawType === "function")
      properties[key].description = "Runtime callback registration; not JSON-serializable";
    if (!optional) required.push(key);
  }
  return { type: "object", properties, required, additionalProperties: false };
}
export const API_CATALOG = Object.freeze(Object.entries(groups).flatMap(([unit, entries]) =>
  entries.map(([method, type, description, signature]) => Object.freeze({
    id: unit + "." + method,
    unit, method, type, description, signature,
    version: API_CATALOG_VERSION,
    implementation: hostOnly.has(unit + "." + method) ? "host-only" :
      implemented.has(unit + "." + method) ? "initial" : "planned",
    request: requestSchema(signature),
    response: { type: "object", required: ["ok", "status"], properties: {
      ok: { type: "boolean" }, status: { type: "integer" },
      data: {}, error: { type: ["object", "null"] }
    }},
    errors: [400, 403, 404, 408, 409, 500, 503]
  }))
));
export const catalogJSON = () => JSON.stringify({
  schemaVersion: API_CATALOG_VERSION, generatedFrom: "src/core/api-catalog.js",
  apiCount: API_CATALOG.length, apis: API_CATALOG
}, null, 2);
export function queryCatalog({ search = "", type = "all", page = 1, pageSize = 20 } = {}) {
  const term = String(search).trim().toLowerCase();
  const matched = API_CATALOG.filter(api =>
    (type === "all" || api.type === type) &&
    (!term || [api.id, api.description, api.signature].some(s => s.toLowerCase().includes(term))));
  const size = Math.min(100, Math.max(1, Number(pageSize) || 20));
  const pages = Math.max(1, Math.ceil(matched.length / size));
  const current = Math.max(1, Math.min(pages, Number(page) || 1));
  return { entries: matched.slice((current - 1) * size, current * size),
    total: matched.length, page: current, pages, pageSize: size };
}
