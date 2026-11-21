// Plugin-owned card elements only live inside plugin iframe windows.
import { createBrowserPluginManager } from './browser-runtime.js';
import { createHostPMU } from './host-pmu.js';
import { createExamplePackage } from './template-generator.js';
import { fetchCommunityIndex, fetchCommunityPlugin } from './community-remote.js';
import { createZip } from './package-format.js';
import { createProjectArchive, readProjectArchive, unpackProjectFiles,
  fetchGitHubProject } from './project-repository.js';
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
  $('settingsLanguage').value = locale;
  renderPluginExplorer();
  if (browserManager) updateCommunityCards();
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
  renderProjectRepository();
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
$('settingsLanguage').addEventListener('change', (e) => repo.setLanguage(e.target.value));
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
selectTab('repository');

// Future plugin integration goes through Router -> PRMU, not direct DOM access.
export const hostPublicProperties = repo;


/** API list and diagnostic views are driven by executable core metadata. */
const kernel = createPluginKernel({ publicRepo: repo, systemVersion: SYSTEM_MANIFEST.version });
let browserManager = null;
let hostPMU = null;
let apiPageNumber = 1;
let selectedAPI = null;
let selectedPluginId = 'cluster.pmu';

/* Project repository: export installed + session packages; session imports
   never call the persistent PMU.install / IndexedDB path. */
function setRepositoryStatus(message, error = false) {
  $('repoStatus').textContent = message;
  $('repoStatus').dataset.error = String(error);
}
function renderProjectRepository() {
  const records = browserManager?.list() || [];
  $('repoCount').textContent = String(records.length).padStart(2, '0');
  const list = $('repoPackages');
  list.replaceChildren();
  for (const entry of records) {
    const row = document.createElement('div');
    row.className = 'repo-file';
    row.setAttribute('role', 'listitem');
    const icon = document.createElement('span');
    icon.className = 'repo-file-icon';
    icon.textContent = '▤';
    const info = document.createElement('div');
    info.className = 'repo-file-info';
    const name = document.createElement('strong');
    name.textContent = entry.manifest.name || entry.id;
    const details = document.createElement('small');
    details.textContent = entry.id + ' · v' + entry.manifest.version;
    info.append(name, details);
    const badge = document.createElement('span');
    badge.className = 'repo-file-badge';
    badge.textContent = t(entry.temporary ? 'repoSession' : 'repoInstalled');
    row.append(icon, info, badge);
    list.append(row);
  }
  if (!records.length) {
    const empty = document.createElement('div');
    empty.className = 'repo-empty';
    empty.textContent = t('repoEmpty');
    list.append(empty);
  }
  $('repoExport').disabled = !records.length;
}
function confirmProjectReplacement(currentCount, incomingCount, fromGitHub) {
  if (currentCount === 0 && !fromGitHub) return Promise.resolve(true);
  const modal = $('projectSwitchDialog');
  if (modal.open) return Promise.resolve(false);
  $('projectSwitchCurrentCount').textContent = String(currentCount);
  $('projectSwitchIncomingCount').textContent = String(incomingCount);
  $('projectSwitchThirdParty').hidden = !fromGitHub;
  modal.returnValue = 'cancel';
  return new Promise(resolve => {
    modal.addEventListener('close', () => {
      resolve(modal.returnValue === 'confirm');
    }, { once: true });
    modal.showModal();
    $('projectSwitchCancel').focus();
  });
}
$('projectSwitchConfirm').addEventListener('click', () =>
  $('projectSwitchDialog').close('confirm'));
$('projectSwitchCancel').addEventListener('click', () =>
  $('projectSwitchDialog').close('cancel'));
$('projectSwitchClose').addEventListener('click', () =>
  $('projectSwitchDialog').close('cancel'));
$('projectSwitchDialog').addEventListener('cancel', () => {
  $('projectSwitchDialog').returnValue = 'cancel';
});

async function loadSessionPackages(packages, { fromGitHub = false } = {}) {
  if (!packages.length) throw Error(t('repoEmpty'));
  const current = browserManager.list();
  const accepted = await confirmProjectReplacement(
    current.length, packages.length, fromGitHub);
  if (!accepted) {
    setRepositoryStatus('');
    return false;
  }
  // The PMU core is protected; previous plugin data is snapshotted by
  // the runtime and restored if the replacement cannot complete.
  selectedPluginId = 'cluster.pmu';
  await browserManager.replaceTemporaryProject(packages);
  renderPluginExplorer();
  renderSettings();
  renderPluginPage();
  renderAPIs();
  renderProjectRepository();
  selectTab('repository');
  setRepositoryStatus(t('repoImportDone') + ': ' + packages.length);
  return true;
}
async function runRepoOperation(callback) {
  for (const id of ['repoExport','repoImportZip','repoImportFolder',
      'repoGitHubConnect']) $(id).disabled = true;
  setRepositoryStatus(t('repoBusy'));
  try { await callback(); }
  catch (error) {
    setRepositoryStatus(t('repoFailed') + ': ' + String(error.message || error), true);
    reportLoaderError(error);
  } finally {
    for (const id of ['repoImportZip','repoImportFolder',
        'repoGitHubConnect']) $(id).disabled = false;
    renderProjectRepository();
  }
}
$('repoExport').addEventListener('click', () => void runRepoOperation(async () => {
  const packages = await browserManager.exportProjectPackages();
  const archive = createProjectArchive(packages);
  downloadArchive('cluster-v3-project.zip', archive);
  setRepositoryStatus(t('repoExportDone') + ': ' + packages.length);
}));
$('repoImportZip').addEventListener('click', () => $('repoZipInput').click());
$('repoImportFolder').addEventListener('click', () => $('repoFolderInput').click());
$('repoZipInput').addEventListener('change', event => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  void runRepoOperation(async () => loadSessionPackages(
    await readProjectArchive(new Uint8Array(await file.arrayBuffer()))));
});
$('repoFolderInput').addEventListener('change', event => {
  const selected = [...event.target.files];
  event.target.value = '';
  if (!selected.length) return;
  void runRepoOperation(async () => {
    const files = {};
    for (const file of selected) {
      const path = file.webkitRelativePath || file.name;
      files[path] = new Uint8Array(await file.arrayBuffer());
    }
    await loadSessionPackages(unpackProjectFiles(files));
  });
});
const GITHUB_REPOSITORY_KEY = 'cluster-v3.project.github-url.v1';
try { $('repoGitHubUrl').value = localStorage.getItem(GITHUB_REPOSITORY_KEY) || ''; }
catch { /* Browser storage is optional; linked packages remain session-only. */ }
$('repoGitHubForm').addEventListener('submit', event => {
  event.preventDefault();
  const address = $('repoGitHubUrl').value.trim();
  void runRepoOperation(async () => {
    const packages = await fetchGitHubProject(address);
    const loaded = await loadSessionPackages(packages, { fromGitHub: true });
    if (!loaded) return;
    try { localStorage.setItem(GITHUB_REPOSITORY_KEY, address); }
    catch { /* URL memory is optional; plugin packages are never persisted. */ }
  });
});


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
    button.setAttribute('aria-current',
      selectedPluginId === entry.id ? 'true' : 'false');
    button.dataset.pluginId = entry.id;
    const glyph = document.createElement('span');
    glyph.className = 'plugin-glyph';
    glyph.textContent = entry.core ? '◇' : '⬡';
    const info = document.createElement('span');
    info.className = 'plugin-entry-label';
    const title = document.createElement('span');
    title.className = 'plugin-entry-name';
    title.textContent = entry.core ? t('publicManagement') :
      (entry.manifest.name || entry.id);
    const state = document.createElement('span');
    state.className = 'plugin-led';
    state.dataset.running = String(entry.loaded);
    state.setAttribute('aria-hidden', 'true');
    info.append(title);
    const description = entry.core ? t('systemProtected') :
      (entry.manifest.description || entry.id);
    button.title = title.textContent + ' · ' +
      (entry.core ? 'CORE' : 'v' + (entry.manifest.version || '0.0.0')) +
      '\n' + description;
    button.setAttribute('aria-label', button.title);
    button.append(glyph, info, state);
    button.addEventListener('click', () => choosePlugin(entry.id));
    const line = document.createElement('div');
    line.className = 'plugin-entry-wrapper';
    line.setAttribute('role', 'listitem');
    line.append(button);
    if (!entry.core) {
      const actions = document.createElement('span');
      actions.className = 'plugin-entry-actions';
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'plugin-action';
      toggle.textContent = entry.loaded ? '■' : '▶';
      toggle.title = t(entry.loaded ? 'pluginUnload' : 'pluginStart');
      toggle.setAttribute('aria-label', toggle.title + ': ' + entry.id);
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
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'plugin-action plugin-open-action';
      open.textContent = '↗';
      open.title = t('openStandalone');
      open.setAttribute('aria-label', open.title + ': ' + entry.id);
      open.addEventListener('click', () => {
        void openPluginSite(entry.id);
      });
      actions.append(open, toggle, remove);
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
/**
 * Open the plugin's standalone website from Explorer.
 * Open a tab synchronously to avoid popup blockers before any async startup.
 */
async function openPluginSite(pluginId) {
  const record = browserManager?.get(pluginId);
  if (!record || pluginId === 'cluster.pmu') return;
  const url = new URL('../', location.href);
  url.searchParams.set('plugin', pluginId);
  const tab = window.open('about:blank', '_blank');
  if (!tab) {
    reportLoaderError(new Error('Browser blocked the plugin window'));
    return;
  }
  try {
    if (!browserManager.isLoaded(pluginId)) {
      setLoaderState('loaderBusy');
      await hostPMU.load(pluginId);
      setLoaderState('loaderReady');
    }
    tab.location.replace(url.href);
  } catch (error) {
    tab.close();
    reportLoaderError(error);
  }
}
function choosePlugin(pluginId) {
  selectedPluginId = pluginId;
  apiPageNumber = 1;
  selectedAPI = null;
  if ($('apiDetail').open) $('apiDetail').close();
  renderPluginExplorer();
  renderSettings();
  renderAPIs();
  renderDiagnostics();
  renderPluginPage();
  selectTab(pluginId === 'cluster.pmu' ? 'apis' : 'settings');
}
let settingsRenderToken = 0;
function renderSettings() {
  const isCore = selectedPluginId === 'cluster.pmu';
  const publicSettings = $('publicSettings');
  const host = $('pluginSettingsHost');
  const frame = $('pluginSettingsFrame');
  const empty = $('pluginSettingsEmpty');
  publicSettings.hidden = !isCore;
  host.hidden = isCore;

  if (isCore) {
    // Invalidate pending plugin asset reads before clearing their frame.
    settingsRenderToken++;
    frame.hidden = true;
    empty.hidden = true;
    frame.removeAttribute('src');
    frame.removeAttribute('srcdoc');
    delete frame.dataset.pluginId;
    delete frame.dataset.settingsPath;
    return;
  }

  const manifest = kernel.getManifest(selectedPluginId);
  const settingsPath = manifest?.settings;
  const settingsURL = browserManager?.isLoaded(selectedPluginId) ?
    resolveSettingsURL(manifest?.settingsUrl, location.href) : null;
  const available = Boolean(settingsURL && settingsPath);
  const pluginId = selectedPluginId;

  // Never show a blank browser document when the plugin has no settings.
  frame.hidden = !available;
  empty.hidden = available;
  if (!available) {
    settingsRenderToken++;
    frame.removeAttribute('src');
    frame.removeAttribute('srcdoc');
    delete frame.dataset.pluginId;
    delete frame.dataset.settingsPath;
    return;
  }

  if (frame.dataset.pluginId === pluginId &&
      frame.dataset.settingsPath === settingsPath) {
    sendSettingsContext();
    return;
  }

  const token = ++settingsRenderToken;
  frame.dataset.pluginId = pluginId;
  frame.dataset.settingsPath = settingsPath;
  frame.hidden = true; // Show only after the correct plugin's asset is ready.
  empty.hidden = false;
  void browserManager.renderAssetFrame(pluginId, settingsPath, frame,
    () => token === settingsRenderToken &&
      selectedPluginId === pluginId &&
      frame.dataset.pluginId === pluginId).then(result => {
    if (result === 'cancelled' || token !== settingsRenderToken ||
        selectedPluginId !== pluginId) return;
    frame.hidden = false;
    empty.hidden = true;
    sendSettingsContext();
  }).catch(error => {
    if (token !== settingsRenderToken || selectedPluginId !== pluginId) return;
    frame.hidden = true;
    empty.hidden = false;
    delete frame.dataset.pluginId;
    delete frame.dataset.settingsPath;
    reportLoaderError(error);
  });
}
function renderPluginPage() {
  browserManager?.show(selectedPluginId);
  const canOpen = selectedPluginId !== 'cluster.pmu' &&
    browserManager?.isLoaded(selectedPluginId);
  $('pluginPageEmpty').hidden = Boolean(canOpen);
}
function sendSettingsContext() {
  const frame = $('pluginSettingsFrame');
  if (selectedPluginId === 'cluster.pmu' ||
      (!frame.src && !frame.srcdoc) ||
      frame.hidden || !frame.contentWindow) return;
  // Send public UI context to plugin settings iframe.
  // Plugin authors can subscribe to this message without Host DOM access.
  frame.contentWindow.postMessage({
    protocol: 'cluster.settings.context.v1',
    pluginId: selectedPluginId,
    language: repo.getLanguage(),
    palette: repo.getPalette(),
    baseColor: repo.getBaseColor(),
    pluginSiteUrl: repo.getPluginSiteUrl()
  }, '*');
}
$('pluginSettingsFrame').addEventListener('load', () => {
  const frame = $('pluginSettingsFrame');
  if (frame.hidden || frame.dataset.pluginId !== selectedPluginId ||
      selectedPluginId === 'cluster.pmu') return;
  sendSettingsContext();
  if (browserManager?.isLoaded(selectedPluginId))
    browserManager.attachSettings(selectedPluginId);
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
  $('apiDetailTitle').textContent = api.id;
  $('apiDetailJSON').textContent = JSON.stringify(api, null, 2);
  if (!$('apiDetail').open) $('apiDetail').showModal();
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
function uniqueRouterRelations() {
  const distinct = new Map();
  for (const event of kernel.inspect(selectedPluginId).relations) {
    const key = [event.source, event.target, event.action,
      event.direction, event.status ?? ''].join('\u0000');
    const old = distinct.get(key);
    distinct.set(key, { ...event, occurrences: (old?.occurrences || 0) + 1 });
  }
  return [...distinct.values()];
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
  for (const relation of uniqueRouterRelations().slice(-200).reverse()) {
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
$('apiModalClose').addEventListener('click', () => $('apiDetail').close());
$('apiModalDone').addEventListener('click', () => $('apiDetail').close());
$('apiDetail').addEventListener('click', event => {
  if (event.target === $('apiDetail')) $('apiDetail').close();
});
$('apiDownloadJSON').addEventListener('click', () => {
  if (selectedAPI) downloadJSON(
    'cluster-api-' + selectedAPI.id.replace(/[^a-zA-Z0-9.-]/g, '-') + '.json',
    JSON.stringify(selectedAPI, null, 2));
});
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
$('routerDownloadList').addEventListener('click', () => downloadJSON(
  'cluster-v3-router-list.json', exportListJSON('router', uniqueRouterRelations(), {
    pluginId: selectedPluginId, deduplicated: true
  })));
$('refreshRouter').addEventListener('click', () => {
  const button = $('refreshRouter');
  button.classList.remove('is-refreshing');
  void button.offsetWidth;
  button.classList.add('is-refreshing');
  renderDiagnostics();
});
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
// The catalog is discovered from the public repository's authoritative index.
let remoteCommunity = [];
let remoteCommunityError = null;
async function refreshRemoteCommunity() {
  try {
    const incoming = await fetchCommunityIndex(repo.getCommunityConfig());
    remoteCommunity = incoming;
    remoteCommunityError = null;
  } catch (error) {
    remoteCommunityError = error;
    // Retain the last successful snapshot when a network refresh fails.
    console.warn("Community index refresh failed:", error);
  }
  updateCommunityCards();
}
async function exampleArchive() {
  return createExamplePackage({ liveContracts: kernel.contract.list() });
}
async function communityInstall(id) {
  try {
    if (browserManager?.get(id)) {
      if (!browserManager.isLoaded(id)) await hostPMU.load(id);
      setLoaderState('loaderReady');
      choosePlugin(id);
      return;
    }
    const settings = repo.getCommunityConfig();
    const item = remoteCommunity.find(entry => entry.id === id);
    const archive = id === settings.example.id ?
      await exampleArchive() :
      item ? createZip((await fetchCommunityPlugin(item, settings)).files) : null;
    if (!archive) throw Error('No indexed community package: ' + id);
    await installArchive(archive);
  } catch (error) { reportLoaderError(error); }
}
async function communityDownload(id) {
  try {
    setLoaderState('loaderBusy');
    const settings = repo.getCommunityConfig();
    const item = remoteCommunity.find(entry => entry.id === id);
    const archive = id === settings.example.id ? await exampleArchive() :
      item ? createZip((await fetchCommunityPlugin(item, settings)).files) :
        await browserManager.exportZip(id);
    downloadArchive(id.replace(/[^a-z0-9.-]/gi, '-') + '.zip', archive);
    setLoaderState('loaderReady');
  } catch (error) { reportLoaderError(error); }
}
function communityCatalog() {
  const installed = browserManager?.list() || [];
  const example = repo.getCommunityConfig().example;
  const known = new Set([example.id, ...remoteCommunity.map(entry => entry.id)]);
  return [{
    ...example, installed: installed.some(x => x.id === example.id),
    description: t('exampleDescription'), isExample: true,
    manifest: installed.find(x => x.id === example.id)?.manifest || {}
  }, ...remoteCommunity.filter(entry => entry.id !== example.id).map(entry => ({
    ...entry, installed: installed.some(record => record.id === entry.id),
    isExample: false,
    manifest: installed.find(record => record.id === entry.id)?.manifest || {}
  })), ...installed.filter(x => !known.has(x.id)).map(record => ({
    id: record.id, installed: true, name: record.manifest.name || record.id,
    version: record.manifest.version || '0.0.0',
    description: record.manifest.description || record.id,
    manifest: record.manifest, isExample: false
  }))];
}
function communityVisibleEntries() {
  const text = $('communitySearch').value.trim().toLocaleLowerCase();
  const filter = $('communityFilter').value;
  const sort = $('communitySort').value;
  return communityCatalog().filter(item =>
    (filter === 'all' ||
      (filter === 'installed' ? item.installed : !item.installed)) &&
    [item.name, item.id, item.description].some(value =>
      String(value).toLocaleLowerCase().includes(text)))
    .sort((a, b) => sort === 'version' ?
      b.version.localeCompare(a.version, undefined, { numeric: true }) :
      a.name.localeCompare(b.name));
}
function buildCommunityCard(item) {
  const article = document.createElement('article');
  article.className = 'community-card';
  article.dataset.communityId = item.id;
  article.setAttribute('role', 'listitem');

  // Use the previous Explorer-style identity card for every plugin.
  // Third-party previews stay in a clipped iframe and do not own Host buttons.
  const head = document.createElement('div');
  head.className = 'community-card-identity';
  const glyph = document.createElement('span');
  glyph.className = 'community-card-glyph';
  glyph.textContent = '⬡';
  glyph.setAttribute('aria-hidden', 'true');
  const information = document.createElement('div');
  information.className = 'community-card-information';
  const heading = document.createElement('div');
  heading.className = 'community-card-heading';
  const title = document.createElement('strong');
  title.textContent = item.name;
  title.title = item.name;
  const version = document.createElement('small');
  version.textContent = 'v' + item.version;
  heading.append(title, version);
  const summary = document.createElement('p');
  summary.className = 'community-card-description';
  summary.textContent = item.description;
  const details = document.createElement('small');
  details.className = 'community-card-status';
  details.textContent = item.installed ?
    t('communityInstalled') : t('communityAvailable');
  information.append(heading, summary, details);
  head.append(glyph, information);
  article.append(head);

  const custom = item.installed && item.manifest.community &&
    browserManager?.isLoaded(item.id);
  if (custom) {
    // A plugin may design its own preview, but the Host controls the
    // border, size, overflow and install/download action layout.
    const preview = document.createElement('div');
    preview.className = 'community-card-preview';
    const frame = document.createElement('iframe');
    frame.className = 'community-card-frame';
    // Community frame is intentionally unsandboxed; plugin is fully trusted.
    frame.referrerPolicy = 'no-referrer';
    frame.title = item.name;
    frame.dataset.communityPlugin = item.id;
    preview.append(frame);
    article.append(preview);
    browserManager.registerAuxiliaryFrame(item.id, frame);
    void browserManager.renderAssetFrame(
      item.id, item.manifest.community, frame).catch(reportLoaderError);
  }

  const actions = document.createElement('div');
  actions.className = 'community-card-actions';
  const download = document.createElement('button');
  download.type = 'button';
  download.className = 'community-download-button';
  download.textContent = '↓ ' + t('communityDownload');
  download.title = t('communityDownload');
  download.addEventListener('click', () => void communityDownload(item.id));
  const install = document.createElement('button');
  install.type = 'button';
  install.className = 'community-install-button';
  install.textContent = item.installed ?
    t('communityOpen') : t('communityQuickInstall');
  install.addEventListener('click', () => void communityInstall(item.id));
  actions.append(download, install);
  article.append(actions);
  return article;
}
function updateCommunityCards() {
  if (!browserManager) return;
  const cards = $('communityCards');
  const entries = communityVisibleEntries();
  cards.replaceChildren(...entries.map(buildCommunityCard));
  $('communityCount').textContent = String(entries.length).padStart(2, '0');
  $('communityEmpty').hidden = entries.length !== 0 && !remoteCommunityError;
  $('communityEmpty').textContent = remoteCommunityError ?
    String(remoteCommunityError.message || remoteCommunityError) :
    t('noCommunityResults');
}
function syncCommunityCards() {
  for (const frame of $('communityCards').querySelectorAll('iframe')) {
    frame.contentWindow?.postMessage({
      protocol: 'cluster.settings.context.v1', pluginId: frame.dataset.communityPlugin,
      language: repo.getLanguage(), palette: repo.getPalette(),
      baseColor: repo.getBaseColor()
    }, '*');
  }
}
$('communitySearch').addEventListener('input', updateCommunityCards);
$('communityFilter').addEventListener('change', updateCommunityCards);
$('communitySort').addEventListener('change', updateCommunityCards);
repo.subscribe(({ type }) => {
  if (type === 'language' || type === 'palette' || type === 'sync') {
    updateCommunityCards();
    syncCommunityCards();
  }
});
window.addEventListener('message', event => {
  const frame = [...$('communityCards').querySelectorAll('iframe')].find(
    item => item.contentWindow === event.source);
  if (!frame || event.data?.protocol !== 'cluster.community.v1') return;
  const id = frame.dataset.communityPlugin;
  if (event.data.type === 'install-example' && id === repo.getCommunityConfig().example.id)
    void communityInstall(id);
  if (event.data.type === 'download' && id)
    void communityDownload(id);
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
    pluginSiteUrl: repo.getPluginSiteUrl(),
    systemVersion: SYSTEM_MANIFEST.version
  }),
  onChange: () => {
    updateCommunityCards();
    renderPluginExplorer();
    renderProjectRepository();
    renderSettings();
    renderPluginPage();
    renderAPIs();
    renderDiagnostics();
  },
  onFailure: reportLoaderError,
  openUIColorPalette: showPalette
});
hostPMU = createHostPMU({kernel, runtime:browserManager});
syncLanguage();
syncPalette();
renderAPIs();
renderDiagnostics();
renderPluginExplorer();
renderProjectRepository();
renderSettings();
renderPluginPage();

void browserManager.ready.then(() => {
  setLoaderState('loaderReady');
  document.documentElement.dataset.clusterReady = '1';
  updateCommunityCards();
  void refreshRemoteCommunity();
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

