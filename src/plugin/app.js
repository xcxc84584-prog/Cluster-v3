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
$('pluginSearch').addEventListener('input', (event) => {
  const label = $('pluginList').querySelector('[data-i18n]');
  label.dataset.i18n = event.target.value.trim() ? 'noPluginSearch' : 'noPlugins';
  label.textContent = t(label.dataset.i18n);
});
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
syncLanguage();
syncPalette();
selectTab('settings');

// Future plugin integration goes through Router -> PRMU, not direct DOM access.
export const hostPublicProperties = repo;
