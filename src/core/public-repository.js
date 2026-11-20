/**
 * Cluster-v3 public properties (phase 1).
 * Storage is browser-local for this initial Host; future plugin access must go
 * through PRMU -> Router, not through importing this Host-internal module.
 */
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES } from './translations.js';

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
  let state = { language: DEFAULT_LANGUAGE, palette: { ...DEFAULT_PALETTE } };

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

  function getSnapshot() { return clone(state); }
  function getLanguage() { return state.language; }
  function getPalette() { return { ...state.palette }; }

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

  function resetPalette() { replacePalette(DEFAULT_PALETTE); }

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
    getSnapshot, getLanguage, getPalette, setLanguage,
    setPaletteToken, replacePalette, resetPalette, subscribe,
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
