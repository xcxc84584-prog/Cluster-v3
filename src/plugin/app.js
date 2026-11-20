/** Host Plugin Manager UI (phase 1: language + palette). */
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, translate } from '../core/translations.js';
import {
  COLOR_KEYS, PALETTE_PRESETS, applyPalette, normalizeColor, publicRepository,
} from '../core/public-repository.js';

const $ = (id) => document.getElementById(id);
const repo = publicRepository;
const dialog = $('paletteDialog');
const tokenList = $('tokenList');
let activeToken = 'accent';

const COLOR_LABELS = {
  background: 'colorBackground', surface: 'colorSurface', panel: 'colorPanel',
  control: 'colorControl', hover: 'colorHover', border: 'colorBorder',
  text: 'colorText', muted: 'colorMuted', accent: 'colorAccent',
  editor: 'colorEditor', gutter: 'colorGutter',
};
const t = (key) => translate(repo.getLanguage(), key);

function syncLanguage() {
  const language = repo.getLanguage();
  document.documentElement.lang = language;
  $('languageSelect').value = language;
  $('settingsLanguage').value = language;
  document.querySelectorAll('[data-i18n]').forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
    element.placeholder = t(element.dataset.i18nPlaceholder);
  });
  document.querySelectorAll('[data-i18n-title]').forEach((element) => {
    element.title = t(element.dataset.i18nTitle);
  });
  const toggle = $('explorerToggle');
  toggle.setAttribute('aria-label', t(toggle.getAttribute('aria-expanded') === 'true' ? 'collapse' : 'expand'));
  document.title = `Cluster-v3 · ${t('brand')}`;
  renderTokens();
  renderEditor();
}

function syncPalette() {
  const palette = repo.getPalette();
  applyPalette(palette);
  for (const button of tokenList.querySelectorAll('[data-color-token]')) {
    const key = button.dataset.colorToken;
    button.querySelector('.token-dot').style.backgroundColor = palette[key];
    button.querySelector('.token-hex').textContent = palette[key].toUpperCase();
  }
  renderEditor();
}

function renderTokens() {
  const palette = repo.getPalette();
  tokenList.replaceChildren();
  COLOR_KEYS.forEach((key) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'token-item';
    button.dataset.colorToken = key;
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', String(key === activeToken));
    const swatch = document.createElement('span');
    swatch.className = 'token-dot';
    swatch.style.backgroundColor = palette[key];
    const label = document.createElement('span');
    label.textContent = t(COLOR_LABELS[key]);
    const hex = document.createElement('span');
    hex.className = 'token-hex';
    hex.textContent = palette[key].toUpperCase();
    button.append(swatch, label, hex);
    button.addEventListener('click', () => {
      activeToken = key;
      tokenList.querySelectorAll('.token-item').forEach((item) => {
        item.setAttribute('aria-selected', String(item === button));
      });
      renderEditor();
    });
    tokenList.append(button);
  });
}

function hexToRgb(hex) {
  return [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
}
function rgbToHex(values) {
  return '#' + values.map((n) => Math.round(n).toString(16).padStart(2, '0')).join('');
}
function renderEditor() {
  const color = repo.getPalette()[activeToken];
  $('colorEditorTitle').textContent = t(COLOR_LABELS[activeToken]);
  $('colorSwatch').style.backgroundColor = color;
  $('hexColor').value = color.toUpperCase();
  $('nativeColor').value = color;
  const channels = hexToRgb(color);
  document.querySelectorAll('[data-channel]').forEach((element) => {
    const index = Number(element.dataset.channel);
    element.value = String(channels[index]);
    document.querySelector(`[data-output="${index}"]`).textContent = String(channels[index]);
  });
}

function changeActiveColor(value) {
  const color = normalizeColor(value);
  if (color) {
    repo.setPaletteToken(activeToken, color);
    $('hexColor').setCustomValidity('');
    return true;
  }
  return false;
}

function showPalette() {
  if (!dialog.open) dialog.showModal();
}
function hidePalette() {
  if (dialog.open) dialog.close();
}

function selectTab(name) {
  document.querySelectorAll('[data-tab]').forEach((button) => {
    const selected = button.dataset.tab === name;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  document.querySelectorAll('[data-view]').forEach((view) => {
    view.hidden = view.dataset.view !== name;
  });
}

// UI events: the unimplemented plugin actions are deliberately disabled.
$('languageSelect').addEventListener('change', (e) => repo.setLanguage(e.target.value));
$('settingsLanguage').addEventListener('change', (e) => repo.setLanguage(e.target.value));
$('openPalette').addEventListener('click', showPalette);
$('settingsPalette').addEventListener('click', showPalette);
$('closePalette').addEventListener('click', hidePalette);
$('donePalette').addEventListener('click', hidePalette);
$('hexColor').addEventListener('change', (event) => {
  if (!changeActiveColor(event.target.value)) {
    event.target.setCustomValidity('Use #RRGGBB');
    event.target.reportValidity();
  }
});
$('nativeColor').addEventListener('input', (event) => changeActiveColor(event.target.value));
document.querySelectorAll('[data-channel]').forEach((range) => {
  range.addEventListener('input', (event) => {
    const channels = hexToRgb(repo.getPalette()[activeToken]);
    channels[Number(event.target.dataset.channel)] = Number(event.target.value);
    changeActiveColor(rgbToHex(channels));
  });
});
document.querySelectorAll('[data-preset]').forEach((button) => {
  button.addEventListener('click', () => repo.replacePalette(PALETTE_PRESETS[button.dataset.preset]));
});
$('resetPalette').addEventListener('click', () => {
  if (window.confirm(t('resetConfirm'))) repo.resetPalette();
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
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const tabs = [...document.querySelectorAll('[data-tab]')];
    const offset = event.key === 'ArrowRight' ? 1 : -1;
    const next = tabs[(tabs.indexOf(button) + offset + tabs.length) % tabs.length];
    selectTab(next.dataset.tab);
    next.focus();
    event.preventDefault();
  });
});

repo.subscribe(({ type }) => {
  if (type === 'language' || type === 'sync') syncLanguage();
  if (type === 'palette' || type === 'sync') syncPalette();
});
syncLanguage();
syncPalette();
selectTab('settings');

// Reserved for the Host's Router/PRMU integration. This phase intentionally
// does not implement cross-plugin calls or make a plugin-installer claim.
export const hostPublicProperties = repo;
