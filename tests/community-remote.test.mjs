import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DEFAULT_COMMUNITY_CONFIG, createPublicRepository } from
  "../src/core/public-repository.js";
import { parseCommunityIndex, fetchCommunityIndex, fetchCommunityPlugin } from
  "../src/plugin/community-remote.js";
const encoder = new TextEncoder();
const gitSha = bytes => createHash("sha1")
  .update("blob " + bytes.byteLength + "\0").update(bytes).digest("hex");
const config = DEFAULT_COMMUNITY_CONFIG;
const metadata = id => ({
  id, name: id, version: "1.2.3", description: "Dynamic plugin",
  directory: config.pluginRoot + "/" + id, initialize:true, community:true
});
const index = entries => ({
  type: config.indexType, schemaVersion: config.indexSchemaVersion,
  plugins: entries, collectionVersion: '1.0.0'
});
function ok(data) {
  const bytes = encoder.encode(JSON.stringify(data));
  return { ok: true, headers: { get: () => String(bytes.length) },
    arrayBuffer: async () => bytes.buffer };
}
test("public repository is the sole authority of community connection config", () => {
  const repo = createPublicRepository({ storage: null });
  assert.deepEqual(repo.getCommunityConfig(), DEFAULT_COMMUNITY_CONFIG);
  assert.equal(repo.getCommunityRepositoryUrl(), config.repositoryUrl);
  const copy = repo.getCommunityConfig();
  copy.ref = "elsewhere";
  assert.equal(repo.getCommunityConfig().ref, config.ref);
  assert.equal(repo.getSnapshot().community.repositoryUrl, config.repositoryUrl);
});
test("community index permits arbitrary plugins without code edits", async () => {
  const entries = [metadata("plugin.a"), metadata("plugin.b"), metadata("future.plugin")];
  const fetcher = async url => {
    if (url.includes("/commits/")) return {ok:true,json:async()=>({sha:"a".repeat(40)})};
    assert.ok(url.endsWith('/'+config.indexPath));
    assert.ok(url.includes("/"+"a".repeat(40)+"/"));
    return ok(index(entries));
  };
  const result = await fetchCommunityIndex(config, fetcher);
  assert.deepEqual(result.map(x => x.id), entries.map(x => x.id));
});
test("community index rejects duplicated, escaping or oversized metadata", () => {
  assert.throws(() => parseCommunityIndex(index([metadata("a.a"), metadata("a.a")]), config),
    /Duplicate/);
  assert.throws(() => parseCommunityIndex(index([{...metadata("a.a"),
    directory:"../private"}]), config), /directory/);
  assert.throws(() => parseCommunityIndex(index([metadata("a.a")]), {
    ...config, maxPlugins: 0
  }), /Too many/);
});
test("folder download uses authoritative URL and verifies manifest identity", async () => {
  const entry = metadata("future.plugin");
  const prefix = entry.directory + "/";
  const files = {
    [prefix + "manifest.json"]: encoder.encode(JSON.stringify({
      schemaVersion:"1.0.0", id:entry.id, name:entry.name,
      version:entry.version, entry:"index.html"
    })),
    [prefix + "index.html"]: encoder.encode("<title>Example</title>")
  };
  const calls = [];
  const fetcher = async url => {
    calls.push(url);
    if (url.includes("/git/trees/")) {
      return { ok:true, json:async () => ({truncated:false,
        tree:Object.entries(files).map(([path,bytes]) =>
          ({path,type:"blob",size:bytes.length,sha:gitSha(bytes)}))}) };
    }
    const key = Object.keys(files).find(path => url.endsWith(path));
    assert.ok(key, url);
    const bytes = files[key];
    return {ok:true, arrayBuffer:async () => bytes.buffer.slice(
      bytes.byteOffset, bytes.byteOffset + bytes.byteLength)};
  };
  const pkg = await fetchCommunityPlugin(entry, config, fetcher);
  assert.equal(pkg.manifest.id, entry.id);
  assert.equal(calls.filter(url => url.startsWith(config.githubApiBase)).length, 1);
  assert.equal(calls.filter(url => url.startsWith(config.githubRawBase)).length, 2);
});

test("stale raw content falls back to immutable Git blob", async () => {
  const entry = metadata("future.plugin");
  const prefix = entry.directory + "/";
  const files = {
    [prefix + "manifest.json"]: encoder.encode(JSON.stringify({
      schemaVersion: "1.0.0", id: entry.id, name: entry.name,
      version: entry.version, entry: "index.html"
    })),
    [prefix + "index.html"]: encoder.encode("<title>Current</title>")
  };
  let recovered = 0;
  const fetcher = async url => {
    if (url.includes("/git/trees/"))
      return { ok: true, json: async () => ({
        truncated: false,
        tree: Object.entries(files).map(([path, bytes]) =>
          ({ path, type: "blob", size: bytes.length, sha: gitSha(bytes) }))
      }) };
    if (url.includes("/git/blobs/")) {
      recovered++;
      const sha = url.split("/").at(-1);
      const bytes = Object.values(files).find(data => gitSha(data) === sha);
      return { ok: true, json: async () => ({
        sha, encoding: "base64", content: Buffer.from(bytes).toString("base64")
      }) };
    }
    const name = Object.keys(files).find(path => url.endsWith(path));
    const bytes = name.endsWith("/index.html")
      ? encoder.encode("<title>Former!</title>") : files[name];
    return { ok: true, arrayBuffer: async () => bytes.buffer.slice(
      bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  };
  const result = await fetchCommunityPlugin(entry, config, fetcher);
  assert.equal(new TextDecoder().decode(result.files["index.html"]),
    "<title>Current</title>");
  assert.equal(recovered, 1);
});

test("index and plugin remain pinned even when the branch changes", async () => {
  const entry=metadata("future.plugin");
  const sha="b".repeat(40);
  const files={
    [entry.directory+"/manifest.json"]:encoder.encode(JSON.stringify({
      schemaVersion:"1.0.0",id:entry.id,name:entry.name,version:entry.version,entry:"index.html"
    })),
    [entry.directory+"/index.html"]:encoder.encode("<title>Snapshot</title>")
  };
  const calls=[];
  const fetcher=async url=>{
    calls.push(url);
    if(url.includes("/commits/"))return {ok:true,json:async()=>({sha})};
    if(url.endsWith("/"+config.indexPath)){
      assert.ok(url.includes("/"+sha+"/"));
      return ok(index([entry]));
    }
    if(url.includes("/git/trees/")){
      assert.ok(url.includes("/git/trees/"+sha+"?"));
      return {ok:true,json:async()=>({truncated:false,tree:Object.entries(files).map(([path,bytes])=>({path,type:"blob",size:bytes.length,sha:gitSha(bytes)}))})};
    }
    assert.ok(url.includes("/"+sha+"/"));
    const key=Object.keys(files).find(path=>url.endsWith(path));
    assert.ok(key);
    const bytes=files[key];
    return {ok:true,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};
  };
  const [item]=await fetchCommunityIndex(config,fetcher);
  const pkg=await fetchCommunityPlugin(item,config,fetcher);
  assert.equal(pkg.manifest.version,entry.version);
  assert.equal(calls.filter(url=>url.includes("/commits/")).length,1);
});

test("collection policy separates initial installation from visibility",()=>{
 const entries=parseCommunityIndex(index([{...metadata("a.a"),initialize:false,community:true},{...metadata("b.b"),initialize:true,community:false}]),config);
 assert.equal(entries.collectionVersion,"1.0.0");
 assert.deepEqual(entries.filter(e=>e.initialize).map(e=>e.id),["b.b"]);
 assert.deepEqual(entries.filter(e=>e.community).map(e=>e.id),["a.a"]);
 assert.throws(()=>parseCommunityIndex(index([{...metadata("a.a"),community:"yes"}]),config),/policy/);
});
