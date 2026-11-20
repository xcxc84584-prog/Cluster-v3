import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COLOR_KEYS, DEFAULT_PALETTE, contrastRatio,
  derivePalette, createPublicRepository,
} from '../src/core/public-repository.js';
import { SUPPORTED_LANGUAGES, translate } from '../src/core/translations.js';

const surfaceTokens = [
  'background','surface','panel','control','hover','editor','gutter',
];

test('single RGB input derives all eleven standard UI tokens', () => {
  assert.deepEqual(derivePalette('#000000'), DEFAULT_PALETTE);
  for (const color of ['#ffffff','#787878','#3b526d','#eeeeee','#af2859','#168c7d','#999999']) {
    const palette = derivePalette(color);
    assert.deepEqual(Object.keys(palette), COLOR_KEYS);
    assert.equal(palette.background, color);
    for (const surface of surfaceTokens) {
      assert.ok(contrastRatio(palette.text, palette[surface]) >= 4.5,
        color + ' text on ' + surface);
      assert.ok(contrastRatio(palette.muted, palette[surface]) >= 4.5,
        color + ' muted on ' + surface);
      assert.ok(contrastRatio(palette.accent, palette[surface]) >= 4.5,
        color + ' accent on ' + surface);
    }
  }
  assert.throws(() => derivePalette('red'), TypeError);
});

test('one base color persists and deterministically restores derived colors', () => {
  const cells = new Map();
  const storage = {
    getItem: (key) => cells.get(key) ?? null,
    setItem: (key, value) => cells.set(key, value),
  };
  const repo = createPublicRepository({storage});
  repo.setLanguage('fr');
  repo.setBaseColor('#6b7180');
  assert.equal(repo.getBaseColor(), '#6b7180');
  assert.deepEqual(repo.getPalette(), derivePalette('#6b7180'));
  const clone = createPublicRepository({storage});
  assert.equal(clone.getLanguage(), 'fr');
  assert.deepEqual(clone.getPalette(), derivePalette('#6b7180'));
  clone.resetPalette();
  assert.equal(clone.getBaseColor(), '#000000');
  assert.deepEqual(clone.getPalette(), DEFAULT_PALETTE);
  assert.throws(() => clone.setBaseColor('#xxyyzz'), TypeError);
});

test('updated palette labels are present in every one of six languages', () => {
  const keys = ['standardColor','paletteOneHint','presetBlack','presetWhite',
    'paletteSaved','paletteDone','contrastAutomatic','palettePreviewCaption'];
  assert.equal(SUPPORTED_LANGUAGES.length,6);
  for (const [language] of SUPPORTED_LANGUAGES) {
    for (const key of keys) assert.ok(translate(language,key).length>0);
  }
});
