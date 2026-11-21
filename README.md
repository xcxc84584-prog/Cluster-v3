# Cluster-v3

Plugin-first website shell. Every plugin is an independent web application;
future PRMU registration publishes UI descriptors to the Public Repository,
while Router carries request/response messages between black-box plugins.

## Foundation 0.1 (implemented)

- `/plugin/` — legacy Cluster-like dark Plugin Manager shell.
- Public Repository bootstrap properties: six languages (zh-TW, en, fr, ja, es, hi)
  and eleven RGB palette tokens.
- Instant language switching for the Host UI, with browser-local persistence.
- Token-based colors with presets, hexadecimal picker, RGB sliders, reset,
  live preview, cross-tab synchronization, and browser-local persistence.
- Explorer collapse/search and five tab views. Unimplemented plugin actions are
  disabled or show clearly labeled empty states. No demo plugins are fabricated.

## Not implemented yet

Plugin installation, service registry, Router, PRMU registration, plugin-provided
settings/API/LOG/Community data, and secure iframe execution. Public properties
are currently stored in `localStorage` on the Host. Future plugin access must
be mediated through the Router/PRMU contract; **do not import Host internals in
third-party plugins**.

## Development

Open `plugin/` from a static web server (ES module imports require HTTP):

```bash
python3 -m http.server 8080
# open http://localhost:8080/plugin/
```

```bash
npm run check
npm test
```

The project has no runtime npm dependencies. `index.html` points to `./plugin/`.

## Initial public property contract

Host-only module `src/core/public-repository.js` exports `createPublicRepository`
and `publicRepository`, which support:

- `getLanguage()`, `setLanguage(locale)`
- `getPalette()`, `setPaletteToken(key, '#rrggbb')`
- `replacePalette(palette)`, `resetPalette()`
- `getSnapshot()`, `subscribe(listener)`, `destroy()`

Events include `language`, `palette`, and `sync`. Invalid values are rejected,
and local browser storage failures degrade gracefully. When Router and PRMU are
introduced, these operations should be surfaced as request/response APIs rather
than direct cross-plugin access.

## Foundation 0.2 — Global RGB and compact layout

- One UI base RGB derives all eleven standard color tokens, including automatic readable text/muted/accent contrasts.
- ClusterOpt-style 405px palette modal: preview, swatch, HEX, R/G/B fields, black/white endpoints and auto-save.
- Compact icon tabs appear immediately below the Host toolbar; the redundant Plugin Manager title section is removed.
- The six-language public setting remains available; earlier browser palette state is migrated at initialization.
- Plugin installation, Router and PRMU remain out of scope. CSS tokens continue to be published from the browser-local public property store.

## Project Repository (session-based plugin packages)

The **Project Repository** tab is placed before Plugin Settings. It offers:

- **Download Project ZIP:** combine every currently installed and session-loaded
  plugin into a single `cluster-v3-project.zip`. The archive has a
  `cluster-project.json` manifest and `plugins/<plugin-id>/` directories,
  each containing an original validated plugin package.
- **Open ZIP:** load a single plugin ZIP or a multi-plugin project ZIP.
- **Open Folder:** load a local plugin folder or multiple plugin folders
  contained in one parent directory (browser folder picker).
- **Connect GitHub:** read public `github.com/owner/repo` URLs, including
  `/tree/<branch>/<folder>` folder links, as plugin folders and/or ZIP
  package files. A `?ref=<branch>` query can explicitly select a ref.
  The last successful GitHub URL is remembered, but remote plugins are **not**
  automatically executed again on reload.

**Persistence guarantee:** Project Repository imports are held in memory only.
No plugin bytes or installation state from these imports are written to IndexedDB.
They vanish after a refresh. The existing Explorer install controls still use
the persistent IndexedDB flow; plugins already installed through that flow
continue to be restored normally.

**Safety and limits:** Importing and running external plugin code is a
security-sensitive operation. GitHub imports require confirmation and support
**public repositories only**, without credentials. The GitHub Contents API is
used, subject to unauthenticated rate limits; each GitHub file currently
needs to be smaller than 1 MiB. The project exchange inherits the ZIP format
limits (at most 500 entries, 20 MiB compressed ZIP, 16 MiB uncompressed
project content); oversized imports/exports fail visibly without silent
truncation. No GitHub write, sync, or private-repository OAuth is implemented.

## Router status list

The Router Status tab groups repeated relations by
`source + target + action + direction + status`, showing only the latest
relation per group with an `occurrences` count. Download List exports the
same deduplicated rows as JSON. This is **display/export deduplication**:
the underlying individual req/rep events and ELog remain unchanged so
traces and request diagnostics still work.
