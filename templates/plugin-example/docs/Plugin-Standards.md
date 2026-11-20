# Cluster-v3 Plugin Folder Standard (v1)

```text
Hello-Cluster/
├─ manifest.json               REQUIRED
├─ index.html                  REQUIRED, main entry
├─ settings.html               OPTIONAL, plugin-designed UI
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
   └─ Plugin-Standards.md      This standard
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
