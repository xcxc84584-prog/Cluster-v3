import { filterLogEntries, exportListJSON, resolveSettingsURL } from './list-utils.js';
import { SYSTEM_MANIFEST } from "../core/system-manifest.js";
import { createPluginKernel } from '../core/plugin-kernel.js';
import { API_CATALOG, queryCatalog, catalogJSON } from '../core/api-catalog.js';
/** Cluster-v3 Host UI: one RGB base color with legible derived surfaces. */
import { translate } from '../core/translations.js';
import {
  applyPalette, contrastRatio, normalizeColor, publicRepository,
} from '../core/public-repository.js';

const $ = (id) => document.getElementById(id);
const repo = publicRepository;
const dialog = $('paletteDialog');
const t = (key) => translate(repo.getLanguage(), key);

function channelsFromHex(hex) {
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
}
function hexFromChannels(channels) {
  return '#' + channels.map((n) =>
    Number(n).toString(16).padStart(2, '0')).join('');
}
function syncLanguage() {
  const locale = repo.getLanguage();
  document.documentElement.lang = locale;
  $('languageSelect').value = locale;
  $('settingsLanguage').value = locale;
  renderPluginExplorer();
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
    node.placeholder = t(node.dataset.i18nPlaceholder);
  });
  document.querySelectorAll('[data-i18n-title]').forEach((node) => {
    node.title = t(node.dataset.i18nTitle);
  });
  const toggle = $('explorerToggle');
  toggle.setAttribute('aria-label',
    t(toggle.getAttribute('aria-expanded') === 'true' ? 'collapse' : 'expand'));
  document.title = 'Cluster-v3 · ' + t('brand');
}
function syncPalette() {
  const palette = repo.getPalette();
  const base = repo.getBaseColor();
  applyPalette(palette);
  const dark = contrastRatio(base, '#ffffff') >=
    contrastRatio(base, '#000000');
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  $('themeState').textContent = dark ? 'DARK' : 'LIGHT';
  $('colorSwatch').style.backgroundColor = base;
  $('paletteHexLabel').textContent = base.toUpperCase();
  $('hexColor').value = base.toUpperCase();
  $('hexColor').setCustomValidity('');
  $('nativeColor').value = base;
  const values = channelsFromHex(base);
  document.querySelectorAll('[data-channel]').forEach((node) => {
    node.value = String(values[Number(node.dataset.channel)]);
  });
  document.querySelectorAll('[data-base-color]').forEach((button) => {
    button.setAttribute('aria-pressed',
      String(button.dataset.baseColor === base));
  });
}
function setColor(candidate) {
  const value = normalizeColor(candidate);
  if (!value) return false;
  repo.setBaseColor(value);
  return true;
}
function selectTab(name) {
  document.querySelectorAll('[data-tab]').forEach((button) => {
    const selected = button.dataset.tab === name;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  document.querySelectorAll('[data-view]').forEach((panel) => {
    panel.hidden = panel.dataset.view !== name;
  });
}
function showPalette() {
  if (!dialog.open) dialog.showModal();
}
function hidePalette() {
  if (dialog.open) dialog.close();
}
$('languageSelect').addEventListener('change', (e) => repo.setLanguage(e.target.value));
$('settingsLanguage').addEventListener('change', (e) => repo.setLanguage(e.target.value));
$('openPalette').addEventListener('click', showPalette);
$('settingsPalette').addEventListener('click', showPalette);
$('closePalette').addEventListener('click', hidePalette);
$('donePalette').addEventListener('click', hidePalette);
$('hexColor').addEventListener('change', (e) => {
  if (!setColor(e.target.value)) {
    e.target.setCustomValidity('Use #RRGGBB');
    e.target.reportValidity();
  }
});
$('nativeColor').addEventListener('input', (e) => setColor(e.target.value));
document.querySelectorAll('[data-channel]').forEach((field) => {
  field.addEventListener('change', () => {
    const channels = channelsFromHex(repo.getBaseColor());
    const n = Number(field.value);
    if (!Number.isInteger(n) || n < 0 || n > 255) {
      syncPalette();
      return;
    }
    channels[Number(field.dataset.channel)] = n;
    setColor(hexFromChannels(channels));
  });
});
document.querySelectorAll('[data-base-color]').forEach((button) => {
  button.addEventListener('click', () => setColor(button.dataset.baseColor));
});
$('explorerToggle').addEventListener('click', (event) => {
  const open = event.currentTarget.getAttribute('aria-expanded') !== 'true';
  $('explorer').hidden = !open;
  event.currentTarget.setAttribute('aria-expanded', String(open));
  event.currentTarget.setAttribute('aria-label', t(open ? 'collapse' : 'expand'));
});
$('pluginSearch').addEventListener('input', renderPluginExplorer);
document.querySelectorAll('[data-tab]').forEach((button) => {
  button.addEventListener('click', () => selectTab(button.dataset.tab));
  button.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const tabs = [...document.querySelectorAll('[data-tab]')];
    const offset = event.key === 'ArrowRight' ? 1 : -1;
    const next = tabs[(tabs.indexOf(button) + offset + tabs.length) % tabs.length];
    selectTab(next.dataset.tab);
    next.focus();
    event.preventDefault();
  });
});

repo.subscribe(({type}) => {
  if (type === 'language' || type === 'sync') syncLanguage();
  if (type === 'palette' || type === 'sync') syncPalette();
});
selectTab('settings');

// Future plugin integration goes through Router -> PRMU, not direct DOM access.
export const hostPublicProperties = repo;


/** API list and diagnostic views are driven by executable core metadata. */
const kernel = createPluginKernel({ publicRepo: repo, systemVersion: SYSTEM_MANIFEST.version });
let apiPageNumber = 1;
let selectedAPI = null;
let selectedPluginId = 'cluster.pmu';

// The PMU is permanent; ordinary plugin settings are provided by a web page.
// Plugin management creates the list from registered runtime instances.
function pluginInstances() {
  return kernel.plugins.map(id => ({
    id,
    core: id === 'cluster.pmu',
    manifest: kernel.getManifest(id) || {}
  }));
}
function renderPluginExplorer() {
  const needle = $('pluginSearch').value.trim().toLocaleLowerCase();
  const entries = pluginInstances().filter(entry =>
    [entry.id, entry.core ? t('publicManagement') : entry.manifest.name]
      .some(value => String(value || '').toLocaleLowerCase().includes(needle)));
  $('pluginList').replaceChildren();
  $('pluginCount').textContent = String(pluginInstances().length).padStart(2, '0');
  for (const entry of entries) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'plugin-entry';
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', String(selectedPluginId === entry.id));
    button.dataset.pluginId = entry.id;
    const glyph = document.createElement('span');
    glyph.className = 'plugin-glyph';
    glyph.textContent = entry.core ? '◇' : '▣';
    const info = document.createElement('span');
    info.className = 'plugin-entry-label';
    const title = document.createElement('strong');
    title.textContent = entry.core ? t('publicManagement') :
      (entry.manifest.name || entry.id);
    const desc = document.createElement('small');
    desc.textContent = entry.core ? t('systemProtected') : entry.id;
    info.append(title, desc);
    button.append(glyph, info);
    button.addEventListener('click', () => choosePlugin(entry.id));
    $('pluginList').append(button);
  }
  if (!entries.length) {
    const empty = document.createElement('p');
    empty.className = 'no-plugins';
    empty.textContent = t('noPluginSearch');
    $('pluginList').append(empty);
  }
}
function choosePlugin(pluginId) {
  selectedPluginId = pluginId;
  apiPageNumber = 1;
  selectedAPI = null;
  $('apiDetail').hidden = true;
  renderPluginExplorer();
  renderSettings();
  renderAPIs();
  renderDiagnostics();
  selectTab(pluginId === 'cluster.pmu' ? 'apis' : 'settings');
}
function renderSettings() {
  const isCore = selectedPluginId === 'cluster.pmu';
  $('publicSettings').hidden = !isCore;
  $('pluginSettingsHost').hidden = isCore;
  const frame = $('pluginSettingsFrame');
  if (isCore) {
    frame.removeAttribute('src');
    return;
  }
  const manifest = kernel.getManifest(selectedPluginId);
  const settingsURL = resolveSettingsURL(manifest?.settingsUrl, location.href);
  frame.hidden = !settingsURL;
  $('pluginSettingsEmpty').hidden = Boolean(settingsURL);
  if (settingsURL && frame.src !== settingsURL) frame.src = settingsURL;
  if (settingsURL) sendSettingsContext();
  if (!settingsURL) frame.removeAttribute('src');
}
function sendSettingsContext() {
  const frame = $('pluginSettingsFrame');
  if (selectedPluginId === 'cluster.pmu' || !frame.src ||
      frame.hidden || !frame.contentWindow) return;
  // Opaque-origin iframe: only send nonsecret UI context to the selected frame.
  // Plugin authors can subscribe to this message without Host DOM access.
  frame.contentWindow.postMessage({
    protocol: 'cluster.settings.context.v1',
    pluginId: selectedPluginId,
    language: repo.getLanguage(),
    palette: repo.getPalette(),
    baseColor: repo.getBaseColor()
  }, '*');
}
$('pluginSettingsFrame').addEventListener('load', sendSettingsContext);
repo.subscribe(({ type }) => {
  if (type === 'language' || type === 'palette' || type === 'sync') {
    sendSettingsContext();
  }
});
function downloadJSON(filename, data) {
  const blob = new Blob([data], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}


function renderAPIs() {
  const query = queryCatalog({
    search: $('apiSearch').value,
    type: $('apiFilter').value,
    page: apiPageNumber,
    pageSize: 15
  });
  if (selectedPluginId !== 'cluster.pmu') {
    // Plugin-specific APIs will appear once they publish contracts.
    query.entries = [];
    query.total = 0;
    query.pages = 1;
    query.page = 1;
  }
  apiPageNumber = query.page;
  $('apiTableBody').replaceChildren();
  for (const api of query.entries) {
    const tr = document.createElement('tr');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'api-link';
    button.textContent = api.id;
    button.addEventListener('click', () => showAPI(api));
    const name = document.createElement('td');
    name.append(button);
    tr.append(name);
    for (const value of [api.version, api.type, api.description]) {
      const cell = document.createElement('td');
      cell.textContent = value;
      tr.append(cell);
    }
    $('apiTableBody').append(tr);
  }
  $('apiTotal').textContent = query.total + ' API';
  if (query.total === 0) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 4;
    cell.className = 'table-empty';
    cell.textContent = t('noApis');
    row.append(cell);
    $('apiTableBody').append(row);
  }
  $('apiPage').textContent = query.page + ' / ' + query.pages;
  $('apiPrevious').disabled = query.page <= 1;
  $('apiNext').disabled = query.page >= query.pages;
}
function showAPI(api) {
  selectedAPI = api;
  $('apiDetail').hidden = false;
  $('apiDetailTitle').textContent = api.id + ' — JSON Contract';
  $('apiDetailJSON').textContent = JSON.stringify(api, null, 2);
}
function apiFilteredEntries() {
  if (selectedPluginId !== 'cluster.pmu') return [];
  const search = $('apiSearch').value.toLocaleLowerCase().trim();
  const type = $('apiFilter').value;
  return API_CATALOG.filter(api =>
    (type === 'all' || api.type === type) &&
    (!search || [api.id, api.description, api.signature].some(
      value => value.toLocaleLowerCase().includes(search))));
}
function currentLogs() {
  // The current ring already contains ELog; fetch it separately only for
  // history that has rotated out of the last 2,000 entries.
  const recent = kernel.logs('log');
  const all = new Map(recent.map(entry => [entry.id, entry]));
  for (const entry of kernel.logs('elog')) all.set(entry.id, entry);
  return filterLogEntries([...all.values()].sort(
    (a, b) => a.timestamp.localeCompare(b.timestamp)), {
      search: $('logSearch').value,
      type: $('logType').value,
      status: $('logStatus').value,
      pluginId: selectedPluginId
    });
}
function renderDiagnostics() {
  const events = currentLogs();
  $('logTotal').textContent = events.length + ' ' + t('logEntries');
  $('logList').replaceChildren();
  for (const entry of events.slice(-200).reverse()) {
    const row = document.createElement('pre');
    row.className = 'diagnostic-row';
    row.textContent = JSON.stringify(entry);
    $('logList').append(row);
  }
  if (!events.length) $('logList').textContent = t('noLogs');
  $('routerList').replaceChildren();
  for (const relation of kernel.inspect(selectedPluginId).relations.slice(-200).reverse()) {
    const row = document.createElement('pre');
    row.className = 'diagnostic-row';
    row.textContent = JSON.stringify(relation);
    $('routerList').append(row);
  }
  if (!$('routerList').childElementCount) $('routerList').textContent = t('noRelations');
}
$('apiSearch').addEventListener('input', () => { apiPageNumber = 1; renderAPIs(); });
$('apiFilter').addEventListener('change', () => { apiPageNumber = 1; renderAPIs(); });
$('apiPrevious').addEventListener('click', () => { apiPageNumber--; renderAPIs(); });
$('apiNext').addEventListener('click', () => { apiPageNumber++; renderAPIs(); });
$('apiCopyJSON').addEventListener('click', async () => {
  if (selectedAPI) await navigator.clipboard.writeText(JSON.stringify(selectedAPI, null, 2));
});
$('apiDownloadList').addEventListener('click', () => downloadJSON(
  'cluster-v3-api-list.json',
  exportListJSON('api', apiFilteredEntries(), {
    pluginId: selectedPluginId, search: $('apiSearch').value,
    type: $('apiFilter').value
  })
));
$('logType').addEventListener('change', renderDiagnostics);
$('logSearch').addEventListener('input', renderDiagnostics);
$('logStatus').addEventListener('change', renderDiagnostics);
$('logDownloadList').addEventListener('click', () => downloadJSON(
  'cluster-v3-log-list.json', exportListJSON('log', currentLogs(), {
    pluginId: selectedPluginId, search: $('logSearch').value,
    type: $('logType').value, status: $('logStatus').value
  })
));
$('refreshRouter').addEventListener('click', renderDiagnostics);
document.querySelectorAll('[data-tab]').forEach(button => {
  button.addEventListener('click', () => {
    if (['logs', 'router'].includes(button.dataset.tab)) renderDiagnostics();
  });
});
syncLanguage();
syncPalette();
renderAPIs();
renderDiagnostics();

void kernel.ready.then(() => renderDiagnostics());
renderPluginExplorer();
renderSettings();
