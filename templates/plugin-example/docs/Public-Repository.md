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

## Reusable UI capabilities (PRMU Capability Registry)

```js
// Provider plugin, after Cluster Host context is ready:
await Cluster.PRMU.register("capabilities", {
  key: "example.hello.ui.v1",
  value: { kind: "ui.embed", version: "1.0.0", entry: "index.html" },
  sharedWrite: false, persistent: false
});

// Any consumer may resolve the provider's packaged entry HTML:
const reply = await Cluster.PRMU.resolveCapability("example.hello.ui.v1");
if (reply.ok) frame.srcdoc = reply.data.html;
```

The Host selects the provider by its owned PRMU registration, checks it is
loaded, and reads its manifest entry from the verified plugin package.
`PRMU.resolveCapability` is generic: no Explorer/Editor-specific Host branch.
The API is implemented in the Host browser runtime and must not be called
without the updated Host. Nested frames do not automatically acquire the
provider's Host identity; route requests through the owning main frame.

To publish multiple UI elements from one plugin, register distinct capability
keys with different package-local `entry` HTML paths (for example,
`panels/tree.html` and `panels/details.html`). The Host checks each path
against the installed plugin package; absolute URLs and `..` are rejected.
