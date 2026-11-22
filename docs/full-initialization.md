# Cluster 完全初始化（Host PRMU）

## Purpose
Use **Plugin Manager → Plugin Settings → Public Repository → Full initialization**
to return the current Cluster browser installation to its initial state.

This is a destructive operation. Back up documents and plugin packages before
starting it. The setting is available only inside the Host Public Repository
settings page; plugins must not implement their own reset routine.

## Confirmation and lifecycle
1. Show a PRMU palette-themed, localized confirmation dialog.
2. Require an unchecked-by-default acknowledgement before enabling Confirm.
3. Issue a short-lived, one-time `sessionStorage` authorization token.
4. Navigate the top-level window to the isolated `reset.html` document.
5. The reset document consumes the token before touching storage.
6. Unregister the registered Cluster Service Worker for the current application.
7. Delete Cluster-owned IndexedDB databases (installed packages/files,
   ELOG, workspace snapshot, and additional databases matching the
   configured Cluster namespace), relevant CacheStorage entries,
   Cluster localStorage/sessionStorage keys.
8. Redirect to the ordinary Cluster home page, which detects no installed
   packages and shows the original initialization actions.

The live Host and plugin frames have left the document before cleanup.
In-memory Router relations, UI state and recent LOG therefore disappear.
Persistent ELOG is removed by deletion of its database.

## Centralized configuration
`src/core/public-repository.js` is the *single authority* for
`FULL_RESET_POLICY`, including database names, namespace prefixes,
Service Worker entry path, confirmation key and reset route. A new
Host-owned store must be registered here. Third-party plugins should use
the published Cluster naming convention; otherwise the Host cannot know
which data to erase.

## Boundaries
- **Never deletes the user's native files** on the local disk.
- **Never clears the entire origin indiscriminately**: GitHub Pages can share
  an origin among unrelated repositories, so only the registered Cluster
  namespaced records are deleted. Data stored by plugins outside those
  namespaces cannot be guaranteed to be removed.
- Other open Cluster tabs may keep a database locked. The reset displays
  an error and offers Retry, rather than claiming success.
- Direct navigation to `reset.html` does not authorize erasure.
- This is an accident-prevention mechanism, **not a security boundary**
  against untrusted same-origin plugins; installed plugins currently run
  in unsandboxed frames.
- This reset changes browser-local state only. It does not delete GitHub
  repositories or remotely hosted files.

## Verification
`tests/full-reset.test.mjs` checks the scoped storage inventory,
same-origin protection, database lock/error handling, authorization
and six-language UI.
`scripts/browser-smoke.mjs` performs a full reset using a disposable
Chromium profile and checks the initial home screen afterward.
