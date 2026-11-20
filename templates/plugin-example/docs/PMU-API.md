# PMU API Overview

The **PMU** is authoritative for plugin installation, activation, removal,
Host integrity, and general plugin diagnostics.

- `PMU.get(source, item, options?)`: query metadata (plugin RPC only exposes self).
- `PMU.list(options?)`: installed/loaded plugin identities.
- `PMU.install(source, options?)`: **Host UI only**, package import.
- `PMU.uninstall(id, options?)`: **Host UI only**, remove plugin.
- `PMU.load(id, options?)`: **Host UI only**, start a plugin.
- `PMU.unload(id, options?)`: **Host UI only**, stop a plugin.
- `PMU.reload(id, options?)`: planned.
- `PMU.configure(id, config)`: planned.
- `PMU.inspect(id, options?)`: Host diagnostics; plugin RPC not available.

Logging endpoints (currently exposed in the generic bridge):
```js
await Cluster.PMU.log("log", {
  target: "cluster.pmu", action: "demo.loaded", status: 200
});
await Cluster.PMU.log("elog", {
  target: "example.hello", action: "demo.failed", status: 500,
  error: { code: "EXAMPLE_ERROR", message: "Test failure" }
});
```

The ZIP includes `PMU-API.json` generated from the live API catalog with
full JSON request/response schemas. `Cluster-API-Catalog.json` provides
all 48 API entries including planned ones. The `implementation` field is
the definitive distinction between available and planned functionality.
