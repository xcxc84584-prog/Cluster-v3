import test from 'node:test';
import assert from 'node:assert/strict';
import { TextEncoder } from 'node:util';
import {
  createProjectArchive, readProjectArchive, unpackProjectFiles,
  parseGitHubLocation, fetchGitHubProject
} from '../src/plugin/project-repository.js';

const encode = value => new TextEncoder().encode(value);
function plugin(id) {
  return {
    manifest: { schemaVersion: '1.0.0', id, name: id, version: '1.0.0',
      entry: 'index.html' },
    files: {
      'manifest.json': encode(JSON.stringify({ schemaVersion: '1.0.0',
        id, name: id, version: '1.0.0', entry: 'index.html' })),
      'index.html': encode('<!doctype html><title>' + id + '</title>')
    }
  };
}

test('project ZIP exports and restores multiple validated plugins', async () => {
  const archive = createProjectArchive([plugin('sample.alpha'), plugin('sample.beta')]);
  const loaded = await readProjectArchive(archive);
  assert.deepEqual(loaded.map(x => x.manifest.id),
    ['sample.alpha', 'sample.beta']);
});

test('folder imports allow a single plugin and a collection of folders', () => {
  const one = plugin('sample.one');
  const single = Object.fromEntries(Object.entries(one.files).map(
    ([key, data]) => ['my-plugin/' + key, data]));
  assert.equal(unpackProjectFiles(single)[0].manifest.id, 'sample.one');
  const multi = { ...single };
  for (const [key, value] of Object.entries(plugin('sample.two').files))
    multi['my-plugins/other/' + key] = value;
  assert.equal(unpackProjectFiles(multi).length, 2);
});

test('a duplicate plugin identifier is rejected', () => {
  const files = {};
  const pkg = plugin('sample.duplicate');
  for (const [key, value] of Object.entries(pkg.files)) {
    files['one/' + key] = value;
    files['two/' + key] = value;
  }
  assert.throws(() => unpackProjectFiles(files), /sample.duplicate/);
});

test('GitHub URLs must be HTTPS and public github.com links', () => {
  assert.equal(parseGitHubLocation(
    'https://github.com/owner/repo/tree/main/plugins').folder, 'plugins');
  assert.throws(() => parseGitHubLocation('http://github.com/owner/repo'));
  assert.throws(() => parseGitHubLocation('https://evil.example/a/b'));
});

test('public GitHub plugin folders can load without persistent storage', async () => {
  const pkg = plugin('sample.remote');
  const responseMap = {
    'https://api.github.com/repos/tester/repo/contents/plugins?ref=main':
      [{type:'dir',path:'plugins/remote'}],
    'https://api.github.com/repos/tester/repo/contents/plugins/remote?ref=main':
      Object.entries(pkg.files).map(([name, data]) => ({
        type:'file', path:'plugins/remote/' + name, size:data.length,
        url:'https://api.github.com/blob/' + name
      })),
    ...Object.fromEntries(Object.entries(pkg.files).map(([name, data]) =>
      ['https://api.github.com/blob/' + name, {
        encoding:'base64', content:Buffer.from(data).toString('base64')
      }]))
  };
  const fakeFetch = async url => ({
    ok: Boolean(responseMap[url]), status: responseMap[url] ? 200 : 404,
    json: async () => responseMap[url]
  });
  const result = await fetchGitHubProject(
    'https://github.com/tester/repo/tree/main/plugins', fakeFetch);
  assert.equal(result.length, 1);
  assert.equal(result[0].manifest.id, 'sample.remote');
});
