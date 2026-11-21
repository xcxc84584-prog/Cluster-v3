import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("marketplace deduplicates example and has a bounded custom iframe", () => {
  const code = readFileSync(new URL("../src/plugin/app.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("../plugin/index.html", import.meta.url), "utf8");
  assert.match(code, /id: 'example\.hello'/);
  assert.match(code, /COMMUNITY_PLUGINS\.map\(entry =>/);
  assert.match(code, /!COMMUNITY_PLUGINS\.some\(entry => entry\.id === x\.id\)/);
  assert.match(code, /browserManager\.exportZip\(id\)/);
  assert.doesNotMatch(code, /frame\.sandbox\s*=/);
  assert.match(html, /id="communitySearch"/);
  assert.doesNotMatch(html, /id="builtinExampleCard"/);
  assert.doesNotMatch(html, /class="community-docs"/);
});
test("API detail belongs to a modal dialog, not the table", () => {
  const html = readFileSync(new URL("../plugin/index.html", import.meta.url), "utf8");
  assert.match(html, /<dialog id="apiDetail"/);
  assert.match(html, /id="apiDownloadJSON"/);
  const section = html.slice(html.indexOf('data-view="apis"'), html.indexOf('data-view="logs"'));
  assert.doesNotMatch(section, /id="apiDetail"/);
});

test("Explorer uses a single-line keyboard-accessible action layout", () => {
  const code = readFileSync(new URL("../src/plugin/app.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/plugin/style.css", import.meta.url), "utf8");
  assert.match(code, /toggle\.textContent = entry\.loaded \? '■' : '▶'/);
  assert.match(code, /toggle\.setAttribute\('aria-label'/);
  assert.match(code, /line\.setAttribute\('role', 'listitem'\)/);
  assert.match(css, /\.plugin-entry-wrapper\{[\s\S]*?height:32px/);
  assert.match(css, /\.plugin-entry-wrapper:hover \.plugin-entry-actions/);
  assert.match(css, /@media \(hover:none\)/);
});
test("Marketplace has horizontal fixed-width actions and a clipped preview", () => {
  const css = readFileSync(new URL("../src/plugin/style.css", import.meta.url), "utf8");
  const code = readFileSync(new URL("../src/plugin/app.js", import.meta.url), "utf8");
  assert.match(css, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /word-break:keep-all;overflow-wrap:normal;writing-mode:horizontal-tb/);
  assert.match(code, /community-card-identity/);
  assert.match(code, /community-card-preview/);
  assert.match(code, /community-card-actions/);
});

test("Explorer provides Open/Stop/Remove icons, without page-level launcher", () => {
  const code = readFileSync(new URL("../src/plugin/app.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("../plugin/index.html", import.meta.url), "utf8");
  assert.match(code, /actions\.append\(open, toggle, remove\)/);
  assert.match(code, /open\.textContent = '↗'/);
  assert.match(code, /open\.setAttribute\('aria-label'/);
  assert.match(code, /url\.searchParams\.set\('plugin', pluginId\)/);
  assert.match(code, /window\.open\('about:blank', '_blank'\)/);
  assert.match(code, /await hostPMU\.load\(pluginId\)/);
  assert.doesNotMatch(html, /id="pluginStandalone"/);
  assert.doesNotMatch(code, /\$\('pluginStandalone'\)/);
});

test("all plugin views omit iframe sandbox and CSP sandbox directives", () => {
  const runtime = readFileSync(new URL("../src/plugin/browser-runtime.js", import.meta.url), "utf8");
  const app = readFileSync(new URL("../src/plugin/app.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("../plugin/index.html", import.meta.url), "utf8");
  const worker = readFileSync(new URL("../plugin-sw.js", import.meta.url), "utf8");
  assert.doesNotMatch(runtime, /iframe\.sandbox\s*=/);
  assert.doesNotMatch(app, /frame\.sandbox\s*=/);
  assert.doesNotMatch(html, /<iframe[^>]*\bsandbox\s*=/);
  assert.doesNotMatch(worker, /sandbox allow-scripts/);
});
