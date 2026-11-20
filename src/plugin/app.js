// Plugin-owned card elements only live inside constrained iframe windows.
import { createBrowserPluginManager } from './browser-runtime.js';
import { createHostPMU } from './host-pmu.js';
import { createExamplePackage } from './template-generator.js';
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
  if (document.body.classList.contains('standalone-mode') &&
      name !== 'page') return;
  document.querySelectorAll('[data-tab]').forEach((button) => {
    const selected = button.dataset.tab === name;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  document.querySelectorAll('[data-view]').forEach((panel) => {
    const inactive = panel.dataset.view !== name;
    if (panel.dataset.view === 'page') {
      // Keep iframe runtimes executing even when the tab is not selected.
      panel.hidden = false;
      panel.classList.toggle('plugin-page-inactive', inactive);
    } else {
      panel.hidden = inactive;
    }
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
  button.addEventListener('click', () => {
    selectTab(button.dataset.tab);
    if (button.dataset.tab === 'apis') renderAPIs();
  });
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
let browserManager = null;
let hostPMU = null;
let apiPageNumber = 1;
let selectedAPI = null;
let selectedPluginId = 'cluster.pmu';

// The PMU is permanent; ordinary plugin settings are provided by a web page.
// Plugin management creates the list from registered runtime instances.
function pluginInstances() {
  const installed = browserManager?.list() || [];
  return [
    { id: 'cluster.pmu', core: true,
      manifest: kernel.getManifest('cluster.pmu') || {}, loaded: true },
    ...installed.map(record => ({
      id: record.id, core: false, manifest: record.manifest,
      loaded: browserManager.isLoaded(record.id)
    }))
  ];
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
    const line = document.createElement('div');
    line.className = 'plugin-entry-wrapper';
    line.append(button);
    if (!entry.core) {
      const actions = document.createElement('span');
      actions.className = 'plugin-entry-actions';
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'plugin-action';
      toggle.textContent = t(entry.loaded ? 'pluginUnload' : 'pluginStart');
      toggle.title = toggle.textContent;
      toggle.addEventListener('click', async () => {
        try {
          setLoaderState('loaderBusy');
          if (entry.loaded) await hostPMU.unload(entry.id);
          else await hostPMU.load(entry.id);
          setLoaderState('loaderReady');
          choosePlugin(entry.id);
        } catch (error) { reportLoaderError(error); }
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'plugin-action';
      remove.textContent = '×';
      remove.title = t('pluginRemove');
      remove.setAttribute('aria-label', t('pluginRemove') + ': ' + entry.id);
      remove.addEventListener('click', async () => {
        if (!window.confirm(t('confirmRemove'))) return;
        try {
          await hostPMU.uninstall(entry.id);
          if (selectedPluginId === entry.id) choosePlugin('cluster.pmu');
        } catch (error) { reportLoaderError(error); }
      });
      actions.append(toggle, remove);
      line.append(actions);
    }
    $('pluginList').append(line);
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
  renderPluginPage();
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
  const settingsURL = browserManager?.isLoaded(selectedPluginId) ?
    resolveSettingsURL(manifest?.settingsUrl, location.href) : null;
  frame.hidden = !settingsURL;
  $('pluginSettingsEmpty').hidden = Boolean(settingsURL);
  const settingsPath = manifest?.settings;
  if (settingsURL && settingsPath &&
      frame.dataset.pluginId !== selectedPluginId) {
    frame.dataset.pluginId = selectedPluginId;
    void browserManager.renderAssetFrame(
      selectedPluginId, settingsPath, frame).catch(reportLoaderError);
  }
  if (settingsURL) sendSettingsContext();
  if (!settingsURL) {
    frame.removeAttribute('src');
    frame.removeAttribute('srcdoc');
    delete frame.dataset.pluginId;
  }
}
function renderPluginPage() {
  browserManager?.show(selectedPluginId);
  const manifest = browserManager?.get(selectedPluginId)?.manifest;
  const canOpen = selectedPluginId !== 'cluster.pmu' &&
    browserManager?.isLoaded(selectedPluginId);
  $('pluginPageEmpty').hidden = Boolean(canOpen);
  $('pluginStandalone').hidden = !canOpen ||
    manifest?.ui?.mode === 'embedded';
}
function sendSettingsContext() {
  const frame = $('pluginSettingsFrame');
  if (selectedPluginId === 'cluster.pmu' ||
      (!frame.src && !frame.srcdoc) ||
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
$('pluginSettingsFrame').addEventListener('load', () => {
  sendSettingsContext();
  if (selectedPluginId !== 'cluster.pmu' &&
      browserManager?.isLoaded(selectedPluginId)) {
    browserManager.attachSettings(selectedPluginId);
  }
});
repo.subscribe(({ type }) => {
  if (type === 'language' || type === 'palette' || type === 'sync') {
    sendSettingsContext();
    browserManager?.syncContext();
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


function visibleAPIContracts() {
  if (selectedPluginId === 'cluster.pmu') return API_CATALOG;
  return kernel.contract.list().filter(contract => contract.owner === selectedPluginId)
    .map(contract => ({
      id: contract.id, unit: selectedPluginId,
      method: contract.action, type: 'execute',
      description: contract.description || contract.action,
      signature: contract.action + '(payload)',
      version: contract.version || '1.0.0',
      implementation: 'initial',
      request: contract.request || {},
      response: contract.response || {},
      errors: [400, 404, 408, 500, 503]
    }));
}
function filteredContracts() {
  const term = $('apiSearch').value.trim().toLowerCase();
  const type = $('apiFilter').value;
  return visibleAPIContracts().filter(api =>
    (type === 'all' || api.type === type) &&
    (!term || [api.id, api.description, api.signature].some(
      s => String(s).toLowerCase().includes(term))));
}
function renderAPIs() {
  const matched = filteredContracts();
  const pages = Math.max(1, Math.ceil(matched.length / 15));
  apiPageNumber = Math.max(1, Math.min(pages, apiPageNumber));
  const query = {
    entries: matched.slice((apiPageNumber - 1) * 15, apiPageNumber * 15),
    total: matched.length, pages, page: apiPageNumber
  };
  /* Legacy queryCatalog continues to power external API catalog readers. */
  /* const query = queryCatalog({
    search: $('apiSearch').value,
    type: $('apiFilter').value,
    page: apiPageNumber,
    pageSize: 15
  }); */
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
  return filteredContracts();
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
function setLoaderState(key, description = "") {
  $('loaderStatus').textContent = t(key) + (description ? ': ' + description : '');
}
function reportLoaderError(error) {
  const message = error?.message || String(error);
  setLoaderState('loaderFailed', message);
  kernel.log('elog', { source: 'cluster.pmu', target: 'plugin.loader',
    action: 'plugin.load', status: error?.status || 500,
    error: { code: error?.code || 'PLUGIN_LOAD_FAILED', message } });
  renderDiagnostics();
}
function downloadArchive(name, data) {
  const url = URL.createObjectURL(new Blob([data], { type: 'application/zip' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function installArchive(source) {
  try {
    setLoaderState('loaderBusy');
    const installed = await hostPMU.install(source);
    const manifest = installed.data;
    setLoaderState('loaderInstalled', manifest.name);
    choosePlugin(manifest.id);
    selectTab('page');
  } catch (error) {
    reportLoaderError(error);
  }
}
$('loadPlugin').addEventListener('click', () => $('pluginZipInput').click());
$('loadPluginFolder').addEventListener('click', () => $('pluginFolderInput').click());
$('pluginZipInput').addEventListener('change', async event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (file) await installArchive(new Uint8Array(await file.arrayBuffer()));
});
$('pluginFolderInput').addEventListener('change', async event => {
  const files = [...event.target.files];
  event.target.value = '';
  if (!files.length) return;
  try {
    setLoaderState('loaderBusy');
    const installed = await hostPMU.install(files, {format:'folder'});
    const manifest = installed.data;
    setLoaderState('loaderInstalled', manifest.name);
    choosePlugin(manifest.id);
    selectTab('page');
  } catch (error) { reportLoaderError(error); }
});
$('downloadExample').addEventListener('click', async () => {
  try {
    setLoaderState('loaderBusy');
    downloadArchive('Cluster-v3-Plugin-Example.zip',
      await createExamplePackage({ liveContracts: kernel.contract.list() }));
    setLoaderState('loaderReady');
  } catch (error) { reportLoaderError(error); }
});
$('pluginStandalone').addEventListener('click', () => {
  if (selectedPluginId === 'cluster.pmu') return;
  const record = browserManager?.get(selectedPluginId);
  if (record?.manifest?.ui?.mode === 'embedded') return;
  const url = new URL('../', location.href);
  url.searchParams.set('plugin', selectedPluginId);
  window.open(url.href, '_blank', 'noopener');
});
$('installExample').addEventListener('click', async () => {
  try {
    await installArchive(await createExamplePackage({
      liveContracts: kernel.contract.list()
    }));
  } catch (error) { reportLoaderError(error); }
});

function updateCommunityCards() {
  if (!browserManager) return;
  for (const existing of $('communityCards').querySelectorAll(
    '[data-community-plugin]')) existing.remove();
  for (const record of browserManager.list()) {
    if (!record.manifest.community ||
        !browserManager.isLoaded(record.id)) continue;
    const frame = document.createElement('iframe');
    frame.className = 'community-card-frame';
    frame.sandbox = 'allow-scripts allow-forms';
    frame.referrerPolicy = 'no-referrer';
    frame.title = record.manifest.name;
    frame.dataset.communityPlugin = record.id;
    void browserManager.renderAssetFrame(
      record.id, record.manifest.community, frame).catch(reportLoaderError);
    frame.addEventListener('load', () => frame.contentWindow?.postMessage({
      protocol: 'cluster.settings.context.v1', pluginId: record.id,
      language: repo.getLanguage(), palette: repo.getPalette(),
      baseColor: repo.getBaseColor()
    }, '*'));
    $('communityCards').append(frame);
    browserManager.registerAuxiliaryFrame(record.id, frame);
  }
}
function syncCommunityCards() {
  for (const frame of $('communityCards').querySelectorAll('iframe')) {
    const id = frame.dataset.communityPlugin || 'example.hello';
    frame.contentWindow?.postMessage({
      protocol: 'cluster.settings.context.v1', pluginId: id,
      language: repo.getLanguage(), palette: repo.getPalette(),
      baseColor: repo.getBaseColor()
    }, '*');
  }
}
$('builtinExampleCard').addEventListener('load', syncCommunityCards);
repo.subscribe(({ type }) => {
  if (['language','palette','sync'].includes(type)) syncCommunityCards();
});
window.addEventListener('message', event => {
  if (event.source === $('builtinExampleCard').contentWindow &&
      event.data?.protocol === 'cluster.community.v1' &&
      event.data?.type === 'install-example') {
    void createExamplePackage({ liveContracts: kernel.contract.list() })
      .then(installArchive).catch(reportLoaderError);
  }
});
function setStandaloneMode(pluginId) {
  document.body.classList.add('standalone-mode');
  selectedPluginId = pluginId;
  renderSettings();
  renderPluginPage();
  selectTab('page');
}
browserManager = createBrowserPluginManager({
  kernel,
  pagesRoot: $('pluginPages'),
  settingsFrame: $('pluginSettingsFrame'),
  getContext: () => ({
    language: repo.getLanguage(),
    palette: repo.getPalette(),
    baseColor: repo.getBaseColor(),
    systemVersion: SYSTEM_MANIFEST.version
  }),
  onChange: () => {
    updateCommunityCards();
    renderPluginExplorer();
    renderSettings();
    renderPluginPage();
    renderAPIs();
    renderDiagnostics();
  },
  onFailure: reportLoaderError
});
hostPMU = createHostPMU({kernel, runtime:browserManager});
syncLanguage();
syncPalette();
renderAPIs();
renderDiagnostics();
renderPluginExplorer();
renderSettings();
renderPluginPage();

void browserManager.ready.then(() => {
  setLoaderState('loaderReady');
  document.documentElement.dataset.clusterReady = '1';
  updateCommunityCards();
  renderPluginExplorer();
  const query = new URLSearchParams(location.search);
  const requested = query.get('plugin');
  const home = browserManager.list().find(record =>
    record.enabled && browserManager.isLoaded(record.id) &&
    record.manifest.ui?.home);
  const target = requested || (query.get('view') === 'home' ? home?.id : null);
  if (target && browserManager.isLoaded(target)) setStandaloneMode(target);
}).catch(reportLoaderError);
void kernel.ready.then(renderDiagnostics);

