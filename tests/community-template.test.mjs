import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { API_CATALOG } from "../src/core/api-catalog.js";
import { createZip, readZip,
  validatePluginPackage } from "../src/plugin/package-format.js";
import { TEMPLATE_FILES } from "../src/plugin/template-generator.js";
import { TRANSLATIONS, SUPPORTED_LANGUAGES } from "../src/core/translations.js";

function readTemplate(path) {
  return new Uint8Array(readFileSync(
    new URL("../templates/plugin-example/" + path, import.meta.url)));
}
test("community template builds an installable ZIP with working file links", async () => {
  const files = Object.fromEntries(TEMPLATE_FILES.map(
    path => [path, readTemplate(path)]));
  files["docs/Cluster-API-Catalog.json"] = JSON.stringify(API_CATALOG);
  files["docs/PMU-API.json"] = JSON.stringify(API_CATALOG.filter(
    api => api.unit === "PMU" || api.unit === "Log"));
  const parsed = validatePluginPackage(await readZip(createZip(files)));
  assert.equal(parsed.manifest.id, "example.hello");
  assert.equal(parsed.manifest.entry, "index.html");
  assert.ok(parsed.files[parsed.manifest.settings]);
  const decoder = new TextDecoder();
  for (const page of [parsed.manifest.entry, parsed.manifest.settings]) {
    const html = decoder.decode(parsed.files[page]);
    const refs = [...html.matchAll(/(?:src|href)="\.\/([^"]+)"/g)];
    assert.ok(refs.length > 0);
    for (const match of refs) {
      assert.ok(parsed.files[match[1]], page + " missing " + match[1]);
    }
  }
  const pmu = JSON.parse(decoder.decode(parsed.files["docs/PMU-API.json"]));
  assert.equal(pmu.filter(x => x.unit === "PMU").length, 9);
  assert.equal(pmu.filter(x => x.unit === "Log").length, 8);
});
test("all six locales cover loader and example UI labels", () => {
  const keys = ["loadPluginZip","loadPluginFolder","loaderReady","loaderBusy",
    "loaderInstalled","loaderFailed","pluginPage","choosePluginPage",
    "pluginUnload","pluginStart","pluginRemove","confirmRemove",
    "exampleTitle","exampleDescription","exampleCapabilities",
    "communityDownload","communityQuickInstall","communityOpen",
    "communityTitle","communitySubtitle","searchCommunity","allPlugins",
    "communityInstalled","communityAvailable","sortByName",
    "sortByVersion","noCommunityResults","downloadJson","modalClose"];
  for (const [locale] of SUPPORTED_LANGUAGES) {
    for (const key of keys) assert.ok(TRANSLATIONS[locale][key], locale + "/" + key);
  }
});
test("Host UI has install selectors, iframe slots and example download", () => {
  const html = readFileSync(new URL("../plugin/index.html", import.meta.url), "utf8");
  for (const id of ["loadPlugin","loadPluginFolder","pluginZipInput",
    "pluginFolderInput","pluginPages","pluginSettingsFrame",
    "communityCards","communitySearch","communityFilter",
    "communitySort","apiDetail","apiModalClose","apiDownloadJSON"]) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.doesNotMatch(html, /id="builtinExampleCard"/);
  assert.doesNotMatch(html, /class="community-docs"/);
  assert.doesNotMatch(html, /id="openPalette"/);
  assert.doesNotMatch(html, /id="languageSelect"/);
});

test("download permission must be explicit and must not grant same-origin access", () => {
  const source = readFileSync(new URL("../src/plugin/browser-runtime.js", import.meta.url), "utf8");
  assert.match(source, /manifest\.permissions\?\.downloads === true/);
  assert.match(source, /" allow-downloads"/);
  assert.doesNotMatch(source, /allow-same-origin/);
  const files = Object.fromEntries(TEMPLATE_FILES.map(path => [path, readTemplate(path)]));
  const parsed = validatePluginPackage(files);
  assert.equal(parsed.manifest.permissions, undefined);
  const manifest = JSON.parse(new TextDecoder().decode(files["manifest.json"]));
  manifest.permissions = { downloads: true };
  files["manifest.json"] = JSON.stringify(manifest);
  assert.equal(validatePluginPackage(files).manifest.permissions.downloads, true);
  manifest.permissions = { downloads: "true" };
  files["manifest.json"] = JSON.stringify(manifest);
  assert.throws(() => validatePluginPackage(files), /permissions\.downloads/);
});
