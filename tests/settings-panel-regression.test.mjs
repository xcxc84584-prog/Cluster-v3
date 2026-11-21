import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/plugin/style.css', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/plugin/app.js', import.meta.url), 'utf8');
const runtime = readFileSync(
  new URL('../src/plugin/browser-runtime.js', import.meta.url), 'utf8');

test('plugin settings iframe and empty state respect hidden attribute', () => {
  assert.match(css, /\.plugin-settings-frame\[hidden\][\s\S]*?display:none!important/);
  assert.match(css, /\.plugin-settings-empty\[hidden\][\s\S]*?display:none!important/);
  assert.match(css, /\.plugin-settings-host\[hidden\][\s\S]*?display:none!important/);
});

test('unavailable plugin settings keep iframe hidden and show Host empty state', () => {
  assert.match(app, /frame\.hidden = !available/);
  assert.match(app, /empty\.hidden = available/);
  assert.match(app, /frame\.removeAttribute\('srcdoc'\)/);
});

test('stale asynchronous settings render is cancelled after plugin switch', () => {
  assert.match(app, /settingsRenderToken/);
  assert.match(app, /selectedPluginId === pluginId/);
  assert.match(runtime, /if \(!shouldRender\(\)\) return "cancelled"/);
});
