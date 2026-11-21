import test from "node:test";
import assert from "node:assert/strict";
import { COMMUNITY_PLUGINS, fetchCommunityPlugin } from
  "../src/plugin/community-remote.js";

const encoder = new TextEncoder();
function mockRepository(id = "cluster.explorer") {
  const prefix = "plugins/" + id + "/";
  const manifest = encoder.encode(JSON.stringify({
    schemaVersion: "1.0.0", id, name: id, version: "1.0.0",
    entry: "index.html", ui: { mode: "embedded" }
  }));
  const html = encoder.encode("<!doctype html><title>Test</title>");
  const paths = {
    [prefix + "manifest.json"]: manifest,
    [prefix + "index.html"]: html
  };
  const requests = [];
  const fetcher = async url => {
    requests.push(url);
    if (url.includes("/git/trees/")) {
      return {
        ok: true, json: async () => ({
          truncated: false, tree: Object.entries(paths).map(([path, bytes]) =>
            ({ type: "blob", path, size: bytes.length }))
        })
      };
    }
    const marker = "/main/";
    const path = url.slice(url.indexOf(marker) + marker.length);
    const bytes = paths[path];
    return bytes ? {
      ok: true, arrayBuffer: async () => bytes.buffer.slice(
        bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    } : { ok: false, status: 404 };
  };
  return { fetcher, requests };
}

test("public community lists two unique Folder packages", () => {
  assert.deepEqual(COMMUNITY_PLUGINS.map(x => x.id),
    ["cluster.explorer", "cluster.text-editor"]);
});

test("community download uses one GitHub tree request and raw file downloads", async () => {
  const { fetcher, requests } = mockRepository();
  const pkg = await fetchCommunityPlugin("cluster.explorer", fetcher);
  assert.equal(pkg.manifest.id, "cluster.explorer");
  assert.equal(pkg.manifest.entry, "index.html");
  assert.equal(requests.filter(url => url.includes("api.github.com")).length, 1);
  assert.equal(requests.filter(url => url.includes("raw.githubusercontent.com")).length, 2);
  assert.equal(Object.keys(pkg.files).length, 2);
});

test("community download rejects missing or unknown plugins", async () => {
  await assert.rejects(fetchCommunityPlugin("arbitrary.plugin",
    async () => { throw Error("should never fetch"); }), /Unknown published plugin/);
  await assert.rejects(fetchCommunityPlugin("cluster.text-editor",
    mockRepository("cluster.explorer").fetcher), /missing/);
});
