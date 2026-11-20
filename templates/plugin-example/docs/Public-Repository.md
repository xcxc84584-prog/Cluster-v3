# Public Repository / PRMU

| Scope | Item | Example | Notes |
|---|---|---|---|
| parameters | system.version | 0.1.0 | Read-only; PMU authority |
| properties | system.language | zh-TW | Six supported locales |
| ui | palette.baseColor | #000000 | Sets all standard palette tokens |
| ui | palette | { ... } | Full derived palette |
| plugin-owned | custom.key | any JSON | Register then get/set |

```js
const version = await Cluster.PRMU.get("parameters", "system.version");
const language = await Cluster.PRMU.get("properties", "system.language");
const color = await Cluster.PRMU.get("ui", "palette.baseColor");
await Cluster.PRMU.set("properties", "system.language", "en");
await Cluster.PRMU.set("ui", "palette.baseColor", "#202127");
await Cluster.PRMU.register("example.hello", {
  key: "public.status", value: { ready: true }, sharedWrite: false
});
```

Every plugin is assigned its own PRMU lifecycle. Owned registrations are
removed on unload unless marked persistent. Host version is not writable.
The supplied `cluster-client.js` is a simple RPC client and does not import
internal Host modules. All successful RPC calls return a JSON envelope with
`ok`, `status`, `data` and `error`.
