# Hello Cluster — Common Problems and Solutions

This checklist summarizes problems seen while developing Cluster-v3 and its
text-editor plugins. It distinguishes **confirmed Host behavior** from
plugin-specific integration requirements. Start by selecting the plugin in
Plugin Manager, checking LOG / ELOG, and confirming the installed ZIP version.

## Quick diagnosis

| Symptom | Likely cause | Action / verification |
| --- | --- | --- |
| ZIP installation returns HTTP 400 | Invalid package root, manifest schema, missing entry, or unsupported ZIP | Place `manifest.json` at ZIP root; validate `schemaVersion: "1.0.0"`, a valid unique lowercase ID, semantic version, and existing HTML entry; try the downloaded Hello Cluster sample |
| Plugin failed to load with `Cannot set properties of null (setting 'hidden')` | Host attempted to update a missing DOM node | Check the Host's UI node IDs and loader ELog location; update Host code to guard optional nodes; do not make a plugin depend on private Host DOM |
| Plugin installs but API List is empty | A JavaScript handler exists locally but no runtime contract was registered | Call `Cluster.Router.register(action, handler, {contract})` after bridge initialization; verify the returned `ok` flag; choose the correct installed plugin in API List |
| API List remains stale after registration | Host didn't re-render after `Router.register` | Use a Host with API-registry refresh support; reselect plugin/API tab and inspect ELog; avoid hardcoded static API entries |
| `Router.request` returns 404 / `API_UNAVAILABLE` | Wrong target/action name or no active handler | Match the **manifest plugin ID** and registered action exactly; register on load; inspect `Router.list` and available contracts |
| Router invocation times out | Target iframe is unavailable, inactive, or didn't send `invoke-result` | Check runtime load status, registration, exact action, and asynchronous handler errors; ensure every handled invocation resolves or rejects |
| `Router.register` reports 409 | Same action registered twice | Register once per lifecycle; unregister before re-registration if necessary; avoid duplicate script startup |
| Service schema rejected / validation fails | Request or response doesn't match declared JSON Schema | Keep `contract.request` and `contract.response` aligned with actual payloads, required fields and types; inspect ELog for the failing action |
| Plugin Settings shows no available settings | Manifest has no usable `settings` page | Optional settings may be omitted; to provide one, include a local `settings.html` and manifest `settings`; language and palette remain shared Host properties |
| Language or palette doesn't update | Plugin ignores Host context or uses hardcoded colors | Subscribe via `Cluster.onContext`; use `context.language`, `context.palette` and `--ui-*` CSS variables; do not mutate Host DOM |
| White palette endpoint doesn't reach `255,255,255` | Color input / base-color mapping clamps or reverts | Normalize `#FFFFFF` to RGB `255,255,255`; check the white endpoint and Host context updates; avoid overwriting the selected value with stale local state |
| Plugin button won't open Plugin Manager | Fixed URL, popup restrictions, or iframe navigation restrictions | Ask Host for `PRMU.getPluginSiteUrl` (if available) or read `context.pluginSiteUrl`; navigate only from a user gesture and let Host manage embedded navigation |
| File editor updates appear but are not saved | `document.update` changes in-memory state only | Treat modification and persistence as separate operations; confirm a successful authorized save, re-open the file, and check saved revision |
| Explorer can't access editor tabs / documents | Plugins communicate directly instead of through Host Router, or actions lack registration | Use versioned actions, e.g. `tabs.list`, `document.open`; register their contracts; verify target plugin ID and protect document updates with revision checks |
| Local file / external asset is missing in iframe | Srcdoc bundling does not resolve every dynamic URL; browser may restrict navigation | Bundle static dependencies in the package; avoid assuming runtime `fetch("./file")` or dynamic imports work; inspect browser console and asset paths |
| Browser local data disappears | Private browsing, storage disabled, replacement install, or browser-origin differences | Check browser storage availability and origin; export important files explicitly; do not treat localStorage/IndexedDB as guaranteed durable document backup |
| Popup close button misaligned | Shared button CSS overrides modal-specific layout | Give the dialog close control explicit positioning, dimensions, stacking order and small-screen rules; test long API names and browser zoom |
| API Catalog JSON is out of date | Generated JSON and source catalog versions differ | Run `npm run api:generate`, then `npm run api:check`; keep the catalog schema version synchronized with `SYSTEM_MANIFEST.apiCatalogVersion` |
| Some API exists in catalog but fails in use | Catalog may describe a planned or Host-only method | Read each API's `implementation` field; do not rely on `planned` methods, and do not invoke `host-only` methods from plugins |

## API registration pattern

Use the browser bridge installed by `scripts/cluster-client.js`.
Register the action on the plugin's main page, not only in a documentation file.

```js
const registration = await Cluster.Router.register(
  "demo.echo",
  payload => ({ echoed: payload.text }),
  {
    contract: {
      version: "1.0.0",
      description: "Echo a string",
      request: {
        type: "object",
        required: ["text"],
        properties: { text: { type: "string" } },
        additionalProperties: false
      },
      response: {
        type: "object",
        required: ["echoed"],
        properties: { echoed: { type: "string" } },
        additionalProperties: false
      }
    }
  }
);
if (!registration.ok) {
  // Log sanitized diagnostics; avoid displaying internal errors to users.
  console.error("Router registration failed", registration.error?.code);
}
```

The Host API List is populated from the live service-contract registry.
**A handler function alone is not discoverable.** If the Host cannot refresh
the list automatically, check registration status before changing the UI.

## Public-property lookup

Prefer the three dedicated, read-only PRMU methods where available:

```js
const [colors, version, site] = await Promise.all([
  Cluster.request("PRMU.getUIColorParameters"),
  Cluster.request("PRMU.getVersion"),
  Cluster.request("PRMU.getPluginSiteUrl")
]);
if (colors.ok) console.log(colors.data.baseColor);
if (version.ok) console.log(version.data);
if (site.ok) console.log(site.data);
```

The older `PRMU.get("parameters", "system.version")` and
`PRMU.get("ui", "palette")` methods remain useful for compatibility.
Treat the plugin-site URL as Host-owned rather than copying a fixed URL
through every plugin.

## Safe ELog triage

1. Record the exact timestamp, plugin ID, action, HTTP status, and error code.
2. Check whether the failure occurred during ZIP validation, iframe load,
   API registration, Router dispatch, or file persistence.
3. Reproduce using the smallest valid Hello Cluster package.
4. Compare the installed plugin version, Host version and API Catalog version.
5. Avoid exposing access tokens, private document data, or credentials in logs.
6. After a fix, reload the plugin and verify the visible behavior; a successful
   ZIP or syntax check alone is **not** an end-to-end test.

## Host compatibility limitations

- Plugins cannot directly modify another plugin's DOM or private state; use
  Host Router request/response APIs.
- Available services depend on the Host version and installed plugin.
- Browser and Host permission controls decide whether navigation, persistent
  storage and filesystem access are possible. Do not bypass these controls.
- Successful in-memory changes are not evidence of durable disk writes.
- This file is a troubleshooting guide, not a claim that every scenario has
  passed automated or live-browser integration tests.
