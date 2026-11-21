# Cluster-v3 Plugin Folder Standard (v1)

```text
Hello-Cluster/
├─ manifest.json               REQUIRED
├─ index.html                  REQUIRED, main entry
├─ settings.html               OPTIONAL, plugin-designed UI
├─ community.html              OPTIONAL, plugin-designed card UI
├─ scripts/
│  ├─ cluster-client.js        Host communication bridge
│  ├─ app.js                   Plugin main logic
│  └─ settings.js              Own settings logic
├─ styles/
│  └─ main.css                 Uses --ui-* theme tokens
└─ docs/
   ├─ Cluster-API-Catalog.json Full Host API contracts
   ├─ PMU-API.json             PMU contract subset
   ├─ Public-Repository.md    Language, color, version
   ├─ Plugin-Standards.md      This standard
   └─ Troubleshooting.md      Common errors and diagnostics
```

## Required manifest

```json
{
  "schemaVersion": "1.0.0",
  "id": "example.hello",
  "name": "Hello Cluster",
  "version": "1.0.0",
  "entry": "index.html",
  "settings": "settings.html",
  "apiVersion": "1.0.0"
}
```

- IDs are lowercase dot/hyphen-separated identifiers, unique per installation.
- Package root must contain `manifest.json`; a single outer folder is allowed.
- Entry and optional settings files must exist and be local HTML files.
- Avoid absolute file paths, embedded keys, and executable test prompts in UI.
- Use tidy names, comments and consistent indentation.
- Keep each plugin autonomous and replaceable; do not import Host internals.
- Communication: `Router.request(target, action, payload)` and RPC replies.
- Shared state: `PRMU.get/set/register` rather than direct cross-plugin data access.
- Logs: `PMU.log("log" | "elog", entry)`.
- Palette: consume `context.palette` / `--ui-*`; language via `context.language`.
- Host manages install/remove and protects core PMU; plugins cannot request
  these operations via general RPC.
- Runtime uses a sandboxed iframe with no `allow-same-origin`.
- Normal ZIPs (STORE/DEFLATE) and directory selection are supported. The
  browser must support IndexedDB and Service Worker on a secure origin.
- Files over 16 MiB unpacked, 500 entries, or ZIPs above 20 MiB are rejected.
- A plugin should not assume all catalog APIs are implemented; check the
  `implementation` field.


## Browser execution and lifecycle

- Host mounts the package's entry and optional settings/community documents
  into bounded iframes with `sandbox="allow-scripts allow-forms"`.
- Host assembles local assets as data URLs and CSS before insertion. Avoid
  assuming that arbitrary dynamic imports or runtime `fetch("./file")`
  automatically resolve: this first-generation loader does not virtualize
  them inside an opaque-origin frame.
- `Router.register(action, handler, {contract})` publishes the service's
  input/output JSON Schema to the Host. The Host enforces those contracts
  at req/rep boundaries.
- Plugin runtime pages can live offscreen while their Router services
  remain active; their lifecycle is tied to the installed plugin.
- `ui.mode` supports embedded, standalone and both. `ui.home` makes
  a plugin eligible for the default Cluster landing view.
- The community card is fully plugin-authored `community.html`, while
  the Host controls iframe size, lifecycle and event source identity.
- PMU install/uninstall/reload operations are Host-only; plugin RPC is
  limited to allowed Router, PRMU and diagnostic services.

## Failure handling and diagnostics

Use [`Troubleshooting.md`](Troubleshooting.md) for package validation,
missing service registrations, Host context, navigation, CORS/sandbox,
and persistent file-save failures. Never display secrets or stack traces
in normal user-facing UI; record sanitized location and error codes in ELog.
