import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COLOR_KEYS, DEFAULT_PALETTE, PALETTE_PRESETS, createPublicRepository,
  normalizeColor, validatePalette,
} from '../src/core/public-repository.js';
import {
  DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, TRANSLATIONS, translate,
} from '../src/core/translations.js';

function createMemoryStorage() {
  const data = new Map();
  return {
    getItem(key) { return data.get(key) ?? null; },
    setItem(key, value) { data.set(key, value); },
    removeItem(key) { data.delete(key); },
  };
}

test('six locales contain every host UI translation key', () => {
  assert.equal(SUPPORTED_LANGUAGES.length, 6);
  const reference = Object.keys(TRANSLATIONS[DEFAULT_LANGUAGE]);
  for (const [language] of SUPPORTED_LANGUAGES) {
    assert.deepEqual(Object.keys(TRANSLATIONS[language]).sort(), reference.slice().sort());
    for (const key of reference) assert.ok(translate(language, key).length > 0);
  }
  assert.equal(translate('not-a-language', 'brand'), TRANSLATIONS[DEFAULT_LANGUAGE].brand);
});

test('palette colors are normalized and invalid values are rejected', () => {
  assert.equal(normalizeColor('#aBc'), '#aabbcc');
  assert.equal(normalizeColor('#123456'), '#123456');
  assert.equal(normalizeColor('rgb(1,2,3)'), null);
  assert.throws(() => validatePalette({ root: '#222222' }), RangeError);
  assert.throws(() => validatePalette({ accent: 'url(javascript:bad)' }), TypeError);
  assert.deepEqual(Object.keys(validatePalette({})), COLOR_KEYS);
});

test('language, palette, notifications and browser-local persistence', () => {
  const storage = createMemoryStorage();
  const repo = createPublicRepository({ storage });
  const events = [];
  const unsubscribe = repo.subscribe((change) => events.push(change.type));
  repo.setLanguage('ja');
  repo.setPaletteToken('accent', '#aBc');
  assert.equal(repo.getLanguage(), 'ja');
  assert.equal(repo.getPalette().accent, '#aabbcc');
  assert.deepEqual(events, ['language', 'palette']);
  assert.throws(() => repo.setLanguage('ru'), RangeError);
  assert.throws(() => repo.setPaletteToken('accent', 'bad'), TypeError);
  unsubscribe();
  repo.resetPalette();
  assert.equal(events.length, 2);
  assert.deepEqual(repo.getPalette(), DEFAULT_PALETTE);
  const restored = createPublicRepository({ storage });
  assert.equal(restored.getLanguage(), 'ja');
  assert.deepEqual(restored.getPalette(), DEFAULT_PALETTE);
});

test('snapshots are not mutable references', () => {
  const repo = createPublicRepository({ storage: createMemoryStorage() });
  const snapshot = repo.getSnapshot();
  snapshot.palette.text = '#000000';
  assert.equal(repo.getPalette().text, DEFAULT_PALETTE.text);
});

test('presets conform to complete RGB token contract', () => {
  for (const palette of Object.values(PALETTE_PRESETS)) {
    assert.deepEqual(Object.keys(palette), COLOR_KEYS);
    assert.deepEqual(validatePalette(palette), palette);
  }
});

test('invalid stored values fall back safely', () => {
  const storage = createMemoryStorage();
  storage.setItem('cluster-v3.public-properties.v1', JSON.stringify({
    language: 'ru', palette: { accent: '#aabbcc', unknown: '#123456', text: 'malformed' },
  }));
  const repo = createPublicRepository({ storage });
  assert.equal(repo.getLanguage(), DEFAULT_LANGUAGE);
  assert.equal(repo.getPalette().accent, '#aabbcc');
  assert.equal(repo.getPalette().text, DEFAULT_PALETTE.text);
});
