# Hello Cluster — Standard Plugin Template

This directory is **itself an installable plugin**. Keep the folder structure,
or zip the entire directory and load it in the Plugin Explorer.

## Files

- `manifest.json` — required package identity and HTML entry points.
- `index.html` — self-contained plugin page.
- `settings.html` — **plugin-owned** settings UI, rendered in the Host tab.
- `scripts/cluster-client.js` — generic Router/PRMU/PMU bridge.
- `scripts/app.js` — Router service, public-version read and logging examples.
- `scripts/settings.js` — changes shared language and UI base RGB color.
- `styles/main.css` — responsive, theme-token-based independent CSS.
- `docs/` — full API catalog, PMU API subset, shared repository and standards.

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
