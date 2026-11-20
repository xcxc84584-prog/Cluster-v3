import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("marketplace deduplicates example and has a bounded custom iframe", () => {
  const code = readFileSync(new URL("../src/plugin/app.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("../plugin/index.html", import.meta.url), "utf8");
  assert.match(code, /id: 'example\.hello'/);
  assert.match(code, /installed\.filter\(x => x\.id !== 'example\.hello'\)/);
  assert.match(code, /browserManager\.exportZip\(id\)/);
  assert.match(code, /frame\.sandbox = 'allow-scripts allow-forms'/);
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
