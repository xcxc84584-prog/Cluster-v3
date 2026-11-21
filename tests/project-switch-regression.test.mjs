import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const app = read('src/plugin/app.js');
const runtime = read('src/plugin/browser-runtime.js');
const html = read('plugin/index.html');
const styles = read('src/plugin/style.css');
const translations = read('src/core/translations.js');

test('all project import entry points share replacement flow', () => {
  assert.match(app, /async function loadSessionPackages\(packages,/);
  assert.match(app, /await browserManager\.replaceTemporaryProject\(packages\)/);
  assert.match(app, /await readProjectArchive\(/);
  assert.match(app, /unpackProjectFiles\(files\)/);
  assert.match(app, /fetchGitHubProject\(address\)/);
  assert.doesNotMatch(app, /window\.confirm\(t\('repoRunConfirm'\)\)/);
});

test('confirmation is required before replacing nonempty projects', () => {
  assert.match(app, /if \(currentCount === 0 && !fromGitHub\)/);
  assert.match(app, /if \(!accepted\)[\s\S]*?return false;/);
  assert.match(app, /await confirmProjectReplacement\(/);
  assert.match(html, /id="projectSwitchDialog"/);
  assert.match(html, /id="projectSwitchConfirm"/);
  assert.match(html, /id="projectSwitchCancel"/);
  assert.match(html, /id="projectSwitchCurrentCount"/);
});

test('all incoming plugins are validated before removing old packages', () => {
  const start = runtime.indexOf('async function replaceTemporaryProject(packages)');
  const end = runtime.indexOf('async function exportProjectPackages()', start);
  assert.ok(start >= 0 && end > start);
  const logic = runtime.slice(start, end);
  assert.ok(logic.indexOf('validatePluginPackage(pkg.files)') <
    logic.indexOf('await remove(record.id)'));
  assert.ok(logic.indexOf('previous.push(') <
    logic.indexOf('await remove(record.id)'));
  assert.match(logic, /catch \(cause\)/);
  assert.match(logic, /store\.install\(record\.manifest, files\)/);
  assert.match(logic, /PROJECT_ROLLBACK_INCOMPLETE/);
  assert.match(logic, /await installTemporaryFiles\(pkg\.files\)/);
});

test('dialog styling uses Host theme tokens and six localized strings', () => {
  assert.match(styles, /\.project-switch-dialog/);
  assert.match(styles, /background:var\(--ui-panel\)/);
  assert.match(styles, /\.project-switch-dialog::backdrop/);
  assert.equal((translations.match(/projectSwitchTitle:/g) || []).length, 6);
  assert.equal((translations.match(/projectSwitchConfirm:/g) || []).length, 6);
  assert.match(html, /data-i18n="projectSwitchWarning"/);
});

test('project switch arrow is large and vertically centered at every viewport', () => {
  assert.match(html, /class="project-switch-arrow"/);
  assert.match(html, /<svg viewBox="0 0 40 40"/);
  assert.match(styles, /\.project-switch-summary\{display:grid;grid-template-columns:/);
  assert.match(styles, /\.project-switch-arrow\{width:48px;height:48px;display:grid;place-items:center;/);
  assert.match(styles, /\.project-switch-arrow svg\{display:block;width:34px;height:34px;/);
  assert.match(styles, /\.project-switch-arrow\{width:40px;height:40px\}/);
});
