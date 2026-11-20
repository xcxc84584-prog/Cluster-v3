# Plugin Settings UI Contract (Cluster-v3)

A plugin owns its settings page. The Host **does not** inject configuration
fields or interpret plugin DOM. The PMU embeds the page inside the
**Plugin Settings** tab, which remains bounded by the tab workspace.

## Manifest registration (future package loader)

```json
{
  "id": "plugin.example",
  "name": "Example",
  "settingsUrl": "./plugins/example/settings.html"
}
```

The loaded plugin's manifest supplies `settingsUrl`. The URL must use HTTP(S),
and the embedded page is loaded into an iframe with
`sandbox="allow-scripts allow-forms"` and without `allow-same-origin`.
The browser's iframe sandbox prevents the plugin from manipulating the
Host DOM directly. A plugin with no settings URL displays a localized
empty state instead of a fake Host-generated settings screen.

## Host context (one-way, read-only)

The Host sends a `postMessage` to the embedded frame on load and when
the shared language or theme changes:

```json
{
  "protocol": "cluster.settings.context.v1",
  "pluginId": "plugin.example",
  "language": "zh-TW",
  "baseColor": "#000000",
  "palette": {
    "background": "#000000",
    "surface": "#202127",
    "text": "#f1f2f5"
  }
}
```

The palette shown here is abbreviated. The real message includes all
eleven standard palette tokens. The plugin is responsible for using
the Host context and rendering its own localized settings.

### Receiver example

```js
window.addEventListener("message", event => {
  const data = event.data;
  if (data?.protocol !== "cluster.settings.context.v1") return;
  if (data.pluginId !== "plugin.example") return;
  document.documentElement.lang = data.language;
  for (const [name, color] of Object.entries(data.palette)) {
    document.documentElement.style.setProperty("--ui-" + name, color);
  }
});
```

This is a presentation-only synchronization message. Request/Response,
public shared data, persistent settings and plugin-to-plugin operations
must go through future authorized Router/PRMU bindings, not arbitrary
iframe messages. The current release does not yet offer a full browser
plugin installer or a complete RPC bridge.
