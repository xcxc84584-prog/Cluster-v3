import test from "node:test";
import assert from "node:assert/strict";
import { createZip, readZip, validatePluginPackage,
  normalizePackagePath, crc32 } from "../src/plugin/package-format.js";

const files = {
  "manifest.json": JSON.stringify({ schemaVersion: "1.0.0",
    id: "demo.sample", name: "Demo", version: "1.0.0",
    entry: "index.html", settings: "settings.html" }),
  "index.html": "<h1>Hello</h1>",
  "settings.html": "<h1>Settings</h1>",
  "scripts/main.js": "console.log('hi')"
};
test("ZIP store archive round-trips and validates plugin folder", async () => {
  const parsed = await readZip(createZip(files));
  const value = validatePluginPackage(parsed);
  assert.equal(value.manifest.id, "demo.sample");
  assert.equal(new TextDecoder().decode(value.files["scripts/main.js"]),
    "console.log('hi')");
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});
test("one-root directory ZIP is accepted", async () => {
  const prefixed = Object.fromEntries(Object.entries(files).map(([k,v]) => ["demo/"+k,v]));
  const parsed = validatePluginPackage(await readZip(createZip(prefixed)));
  assert.equal(parsed.manifest.entry, "index.html");
});
test("bad package paths, missing entry and reserved ID are rejected", () => {
  for (const path of ["../bad", "foo/../bar", "/absolute", "C:/hidden"]) {
    assert.throws(() => normalizePackagePath(path), /./);
  }
  assert.throws(() => validatePluginPackage({
    ...files, "manifest.json": JSON.stringify({
      ...JSON.parse(files["manifest.json"]), id: "cluster.pmu"
    })
  }), /Invalid schemaVersion/);
  assert.throws(() => validatePluginPackage({
    "manifest.json": files["manifest.json"]
  }), /entry/);
});
test("tampered ZIP CRC is rejected", async () => {
  const archive = createZip(files);
  const marker = new TextEncoder().encode("<h1>Hello</h1>");
  const at = archive.findIndex((b,i) =>
    marker.every((value,j) => archive[i+j] === value));
  assert.ok(at > 0);
  archive[at] ^= 1;
  await assert.rejects(readZip(archive), error =>
    error.code === "ZIP_CRC_MISMATCH");
});
