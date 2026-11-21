/**
 * Cluster-v3 public properties (phase 1).
 * Storage is browser-local for this initial Host; future plugin access must go
 * through PRMU -> Router, not through importing this Host-internal module.
 */
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES } from './translations.js';

export const PLUGIN_SITE_URL =
  'https://xcxc84584-prog.github.io/Cluster-v3/plugin/?view=home';

/** Host-owned, read-only community transport configuration (single authority).
 * Client code must request this through PRMU; no marketplace URL literals elsewhere. */
export const DEFAULT_COMMUNITY_CONFIG = Object.freeze({
  repositoryUrl: 'https://github.com/xcxc84584-prog/cluster-v3-initplugin',
  ref: 'main',
  indexPath: 'community-index.json',
  pluginRoot: 'plugins',
  indexSchemaVersion: '1.0.0',
  indexType: 'cluster.community-index',
  githubApiBase: 'https://api.github.com',
  githubRawBase: 'https://raw.githubusercontent.com',
  maxIndexBytes: 262144,
  maxPlugins: 100,
  maxFilesPerPlugin: 100,
  maxFileBytes: 1048576,
  maxPluginBytes: 16777216,
  parallelDownloads: 5,
  example: Object.freeze({ id: 'example.hello', name: 'Hello Cluster', version: '1.0.0' })
});

export const COLOR_KEYS = Object.freeze([
  'background', 'surface', 'panel', 'control', 'hover', 'border',
  'text', 'muted', 'accent', 'editor', 'gutter',
]);

export const DEFAULT_PALETTE = Object.freeze({
  background: '#000000', surface: '#202127', panel: '#111216',
  control: '#343640', hover: '#474a58', border: '#3c3e49',
  text: '#f1f2f5', muted: '#a5a8b5', accent: '#728cfb',
  editor: '#050505', gutter: '#08090b',
});

export const PALETTE_PRESETS = Object.freeze({
  cluster: DEFAULT_PALETTE,
  midnight: Object.freeze({
    background: '#080e18', surface: '#152135', panel: '#0c1728',
    control: '#243550', hover: '#314969', border: '#334663',
    text: '#e5efff', muted: '#9aabc8', accent: '#78aaff',
    editor: '#070f1d', gutter: '#101a2c',
  }),
  graphite: Object.freeze({
    background: '#101113', surface: '#242629', panel: '#191b1e',
    control: '#383b40', hover: '#4c5058', border: '#51545c',
    text: '#f1f2f4', muted: '#afb2b8', accent: '#92a7dc',
    editor: '#0c0d0f', gutter: '#1b1d20',
  }),
});

const STORAGE_KEY = 'cluster-v3.public-properties.v1';
const LANGUAGE_CODES = new Set(SUPPORTED_LANGUAGES.map(([id]) => id));
const CSS_VARIABLES = {
  background: '--ui-background', surface: '--ui-surface',
  panel: '--ui-panel', control: '--ui-control', hover: '--ui-hover',
  border: '--ui-border', text: '--ui-text', muted: '--ui-muted',
  accent: '--ui-accent', editor: '--ui-editor', gutter: '--ui-gutter',
};

const clone = (value) => JSON.parse(JSON.stringify(value));

export function normalizeColor(value) {
  if (typeof value !== 'string') return null;
  const match = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(value.trim());
  if (!match) return null;
  const raw = match[1].toLowerCase();
  return raw.length === 3
    ? '#' + [...raw].map((part) => part + part).join('')
    : '#' + raw;
}


function colorChannels(hex) {
  return [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
}
function channelsHex(values) {
  return '#' + values.map((value) =>
    Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')).join('');
}
function blendColor(from, to, amount) {
  const a = colorChannels(from);
  const b = colorChannels(to);
  return channelsHex(a.map((value, index) => value + (b[index] - value) * amount));
}
function luminance(hex) {
  const values = colorChannels(hex).map((value) => {
    const channel = value / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}
export function contrastRatio(first, second) {
  const a = luminance(normalizeColor(first) ?? '#000000');
  const b = luminance(normalizeColor(second) ?? '#000000');
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * Derive every legacy UI token from one user-selected RGB base.
 * The editor, toolbar and control surfaces stay within a readable range.
 * Text and muted labels meet at least WCAG 4.5:1 on the standard surfaces.
 */
export function derivePalette(baseColor) {
  const base = normalizeColor(baseColor);
  if (!base) throw new TypeError('Invalid global base RGB color');
  if (base === '#000000') return { ...DEFAULT_PALETTE };

  const text = contrastRatio(base, '#ffffff') >=
    contrastRatio(base, '#000000') ? '#ffffff' : '#000000';
  const dark = text === '#ffffff';
  const opposite = dark ? '#000000' : '#ffffff';
  const shade = (up, down) => blendColor(
    base, dark ? '#ffffff' : '#000000', dark ? up : down
  );
  const ensureReadable = (color, foreground = text, minimum = 4.5) => {
    if (contrastRatio(color, foreground) >= minimum) return color;
    for (let i = 1; i <= 100; i += 1) {
      const candidate = blendColor(color, opposite, i / 100);
      if (contrastRatio(candidate, foreground) >= minimum) return candidate;
    }
    return opposite;
  };
  const palette = {
    background: base,
    surface: ensureReadable(shade(0.13, 0.085)),
    panel: ensureReadable(shade(0.065, 0.035)),
    control: ensureReadable(shade(0.21, 0.13)),
    hover: ensureReadable(shade(0.275, 0.17)),
    border: shade(0.26, 0.23),
    text,
    muted: text,
    accent: dark ? '#a7baff' : '#3453ad',
    editor: ensureReadable(blendColor(base, dark ? '#000000' : '#ffffff', 0.025)),
    gutter: ensureReadable(shade(0.04, 0.04)),
  };
  const surfaces = [
    'background', 'surface', 'panel', 'control', 'hover', 'editor', 'gutter',
  ];
  // Make muted copy secondary in appearance without compromising readability.
  let muted = blendColor(text, base, 0.19);
  for (let i = 0; i < 100; i += 1) {
    if (surfaces.every((key) => contrastRatio(muted, palette[key]) >= 4.5)) break;
    muted = blendColor(muted, text, 0.10);
  }
  palette.muted = surfaces.every((key) =>
    contrastRatio(muted, palette[key]) >= 4.5) ? muted : text;
  // Accent is also used for inline code and active controls.
  let accent = palette.accent;
  for (let i = 0; i < 100; i += 1) {
    if (surfaces.every((key) => contrastRatio(accent, palette[key]) >= 4.5)) break;
    accent = blendColor(accent, text, 0.10);
  }
  palette.accent = surfaces.every((key) =>
    contrastRatio(accent, palette[key]) >= 4.5) ? accent : text;
  return palette;
}

export function validatePalette(palette) {
  if (!palette || typeof palette !== 'object' || Array.isArray(palette)) {
    throw new TypeError('Palette must be an object');
  }
  const result = { ...DEFAULT_PALETTE };
  for (const [key, value] of Object.entries(palette)) {
    if (!COLOR_KEYS.includes(key)) throw new RangeError(`Unknown color token: ${key}`);
    const color = normalizeColor(value);
    if (!color) throw new TypeError(`Invalid RGB color for token: ${key}`);
    result[key] = color;
  }
  return result;
}

export function createPublicRepository({ storage, eventTarget } = {}) {
  let store = storage;
  if (store === undefined) {
    try { store = globalThis.localStorage ?? null; }
    catch { store = null; /* Opaque-origin / sandboxed browser contexts. */ }
  }
  const listeners = new Set();
  let state = { language: DEFAULT_LANGUAGE, baseColor: '#000000', palette: { ...DEFAULT_PALETTE } };

  function load() {
    if (!store) return;
    try {
      const raw = JSON.parse(store.getItem(STORAGE_KEY) || '{}');
      if (LANGUAGE_CODES.has(raw.language)) state.language = raw.language;
      if (raw.palette && typeof raw.palette === 'object') {
        const allowed = Object.fromEntries(
          Object.entries(raw.palette).filter(([key, value]) =>
            COLOR_KEYS.includes(key) && normalizeColor(value))
        );
        state.palette = validatePalette(allowed);
        state.baseColor = state.palette.background;
      }
      if (normalizeColor(raw.baseColor)) {
        state.baseColor = normalizeColor(raw.baseColor);
        state.palette = derivePalette(state.baseColor);
      }
    } catch { /* Damaged browser storage falls back to defaults. */ }
  }

  function save() {
    try { store?.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch { /* UI remains usable when storage is disabled. */ }
  }

  function emit(type) {
    const snapshot = getSnapshot();
    listeners.forEach((fn) => fn({ type, snapshot }));
  }

  function getSnapshot() { return { ...clone(state), pluginSiteUrl: PLUGIN_SITE_URL, community: getCommunityConfig() }; }
  function getPluginSiteUrl() { return PLUGIN_SITE_URL; }
  function getCommunityConfig() { return clone(DEFAULT_COMMUNITY_CONFIG); }
  function getCommunityRepositoryUrl() { return DEFAULT_COMMUNITY_CONFIG.repositoryUrl; }
  function getLanguage() { return state.language; }
  function getPalette() { return { ...state.palette }; }
  function getBaseColor() { return state.baseColor; }

  function setBaseColor(color) {
    const normalized = normalizeColor(color);
    if (!normalized) throw new TypeError('Invalid base RGB color');
    if (normalized === state.baseColor &&
        JSON.stringify(state.palette) === JSON.stringify(derivePalette(normalized))) return;
    state.baseColor = normalized;
    state.palette = derivePalette(normalized);
    save(); emit('palette');
  }

  function setLanguage(language) {
    if (!LANGUAGE_CODES.has(language)) throw new RangeError(`Unsupported language: ${language}`);
    if (state.language === language) return;
    state.language = language;
    save(); emit('language');
  }

  function setPaletteToken(key, color) {
    if (!COLOR_KEYS.includes(key)) throw new RangeError(`Unknown color token: ${key}`);
    const normalized = normalizeColor(color);
    if (!normalized) throw new TypeError(`Invalid RGB color: ${color}`);
    if (state.palette[key] === normalized) return;
    state.palette = { ...state.palette, [key]: normalized };
    save(); emit('palette');
  }

  function replacePalette(palette) {
    state.palette = validatePalette(palette);
    save(); emit('palette');
  }

  function resetPalette() { setBaseColor('#000000'); }

  function subscribe(fn) {
    if (typeof fn !== 'function') throw new TypeError('Listener must be a function');
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function syncFromStorage(event) {
    if (event.key !== STORAGE_KEY) return;
    load(); emit('sync');
  }

  load();
  eventTarget?.addEventListener('storage', syncFromStorage);

  return Object.freeze({
    getSnapshot, getLanguage, getPalette, getBaseColor, getPluginSiteUrl,
    getCommunityConfig, getCommunityRepositoryUrl, setLanguage,
    setBaseColor, setPaletteToken, replacePalette, resetPalette, subscribe,
    destroy() { listeners.clear(); eventTarget?.removeEventListener('storage', syncFromStorage); },
  });
}

export function applyPalette(palette, root = document.documentElement) {
  const validated = validatePalette(palette);
  for (const [token, value] of Object.entries(validated)) {
    root.style.setProperty(CSS_VARIABLES[token], value);
  }
}

export const publicRepository = createPublicRepository({
  eventTarget: typeof window !== 'undefined' ? window : undefined,
});
