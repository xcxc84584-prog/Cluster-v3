import test from 'node:test';
import assert from 'node:assert/strict';
import { filterLogEntries, exportListJSON, resolveSettingsURL } from
  '../src/plugin/list-utils.js';
import { createPluginKernel } from '../src/core/plugin-kernel.js';
import { SUPPORTED_LANGUAGES, TRANSLATIONS } from '../src/core/translations.js';

test('public PMU cannot be unloaded', () => {
  const kernel = createPluginKernel();
  assert.throws(() => kernel.unload('cluster.pmu'),
    error => error.status === 403 && error.code === 'CORE_PROTECTED');
  assert.ok(kernel.plugins.includes('cluster.pmu'));
});
test('log type/status/search and export reflect filtered entries', () => {
  const items = [
    { id:'1', type:'log', status:200, source:'a', target:'b', action:'get' },
    { id:'2', type:'elog', status:403, source:'a', target:'b',
      action:'deny', error: { code: 'ACCESS_DENIED' } },
    { id:'3', type:'elog', status:400, source:'c', target:'d', action:'bad' }
  ];
  const found = filterLogEntries(items, {
    type:'elog', status:'403', search:'access_denied', pluginId:'a'
  });
  assert.equal(found.length, 1);
  assert.equal(JSON.parse(exportListJSON('log', found)).count, 1);
});
test('settings URL rejects executable and local schemes', () => {
  assert.equal(resolveSettingsURL('javascript:alert(1)', 'https://example.com'), null);
  assert.equal(resolveSettingsURL('data:text/html,foo', 'https://example.com'), null);
  assert.equal(resolveSettingsURL('./settings.html', 'https://example.com/plugin/'),
    'https://example.com/plugin/settings.html');
});
test('new management labels have translations for all six locales', () => {
  for (const [lang] of SUPPORTED_LANGUAGES) {
    for (const key of ['publicManagement','systemProtected','settingsUnavailable',
      'downloadList','copyJson','searchLogs','allTypes','allStatuses','logEntries']) {
      assert.equal(typeof TRANSLATIONS[lang][key], 'string', lang + ':' + key);
    }
  }
});

test('LOG view paginates rows without hiding export history', async () => {
  const {readFileSync}=await import('node:fs');
  const app=readFileSync(new URL('../src/plugin/app.js',import.meta.url),'utf8');
  const html=readFileSync(new URL('../plugin/index.html',import.meta.url),'utf8');
  const css=readFileSync(new URL('../src/plugin/style.css',import.meta.url),'utf8');
  for(const id of ['logPageSize','logPrevious','logNext','logPage'])
    assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(app,/const pageSize = Number\(\$\('logPageSize'\)\.value\) \|\| 50/);
  assert.match(app,/const pageEntries = events\.slice\(first, last\)\.reverse\(\)/);
  assert.doesNotMatch(app,/events\.slice\(-200\)\.reverse\(\)/);
  assert.match(app,/exportListJSON\('log', currentLogs\(\)/);
  assert.match(css,/\.log-pagination\{/);
});

test('LOG pagination is translated in every Host locale', () => {
  for (const [language] of SUPPORTED_LANGUAGES)
    for (const key of ['logPageSize','logPrevious','logNext'])
      assert.ok(TRANSLATIONS[language][key],language+' '+key);
});
