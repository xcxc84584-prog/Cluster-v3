# Hello Cluster — Standard Plugin Template

This directory is **itself an installable plugin**. Keep the folder structure,
or zip the entire directory and load it in the Plugin Explorer.

## Files

- `manifest.json` — required package identity and HTML entry points.
- `index.html` — self-contained plugin page.
- `settings.html` — **plugin-owned** settings UI, rendered in the Host tab.
- `community.html` — plugin-owned community card, kept within a bounded frame.
- `ui.mode` — choose `embedded`, `standalone`, or `both`;
  `ui.home` optionally selects the website landing plugin.
- `scripts/cluster-client.js` — generic Router/PRMU/PMU bridge.
- `scripts/app.js` — Router service, public-version read and logging examples.
- `scripts/settings.js` — changes shared language and UI base RGB color.
- `styles/main.css` — responsive, theme-token-based independent CSS.
- `docs/` — full API catalog, PMU API subset, shared repository and standards.
- `docs/Troubleshooting.md` — common failures, symptoms, causes and verification steps.

## Quick start

1. In Cluster-v3 open `/plugin/` and choose **Community**.
2. Download the sample ZIP or install it directly from Community.
3. In Explorer choose **Hello Cluster** and open **Plugin Page**.
4. Click **Read System Version**, **Call Echo API**, or **Write LOG**.
5. Open **Plugin Settings** and change language or palette.

Plugins communicate using `Cluster.request(method, ...args)`.
All cross-plugin requests are routed through the Host Router. Plugin settings
are free-form HTML/CSS/JS within an iframe boundary; no Host DOM mutation.

Important: this sample API client is intentionally small and supports only
the currently implemented Host RPC subset. Review the `implementation`
field in the full API catalog before relying on another method.


## Runtime, standalone and community card

The standard package manifest sets `ui.mode = "both"` and `ui.home = true`.
The Host presents the plugin in its main workspace and supports standalone
routing via `/Cluster-v3/?plugin=example.hello`. If the package is set as
the home plugin, the root URL routes to the installed plugin.

`community.html` is a **plugin-owned UI**, not a Host generated card.
Cluster embeds it in a bounded sandbox and forwards the same public
Router/PRMU RPC bridge as the main page. The card may declare its own
content and interactions, but must not modify the Host DOM.

## API catalog sync

When the developer example ZIP is produced, the Host bundles its live
registered plugin API contracts together with the versioned core catalog.
Each entry includes the implementation status and JSON request/response
contract. Runtime service registration through `Router.register` can
provide `options.contract` with JSON Schema request and response types.
The Host rejects invalid payloads and records ELog diagnostics.

## Asset bundling and security limitations

The Host packages local scripts, styles and basic images into a sandboxed
opaque-origin `srcdoc` document so the browser can execute the plugin
without granting same-origin access. External URLs still follow browser
restrictions. Advanced lazy-loaded assets, dynamic module imports and
network service access must be explicitly supported by the plugin.

## Troubleshooting

If installation, API registration, UI themes, navigation, or file persistence
fails, read [Common Problems and Solutions](docs/Troubleshooting.md) before
changing the Host. The checklist distinguishes plugin-only fixes from changes
that require Host Router or browser support; check ELog for the exact failure.

## Compose UI with the generic Capability Registry

Providers may publish one embeddable UI using `PRMU.register("capabilities",
{ key: "example.hello.ui.v1", value: {kind:"ui.embed",version:"1.0.0"} })`.
This registration is scoped to the provider's active lifecycle; never store
HTML, an unverified URL, or a hard-coded peer ID in the registry.

Consumers use `Cluster.PRMU.resolveCapability("example.hello.ui.v1")`.
The Host verifies the provider and returns `data.html` (a packaged HTML
entry) plus `data.pluginId` and `data.version`. The consumer may render
that document in a child iframe, while data operations remain on Router.
The embedding consumer must forward a suitable Host bridge or scope requests
carefully; loading HTML alone does not magically grant the embedded frame
its own Host plugin identity.

The capability becomes unavailable when its provider is unloaded. For the
Explorer + Editor example, register `workspace.explorer.v1` from Explorer and
resolve it from Editor. API List includes `PRMU.resolveCapability` as a Host
API; provider-specific service calls should separately register Router
contracts for their own API List entries.
