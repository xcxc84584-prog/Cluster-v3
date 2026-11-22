import test from "node:test";
import assert from "node:assert/strict";
import { API_CATALOG, queryCatalog, catalogJSON } from "../src/core/api-catalog.js";
import { createPluginKernel } from "../src/core/plugin-kernel.js";

test("catalog has unique, searchable and serializable contracts", () => {
  const ids = API_CATALOG.map(entry => entry.id);
  const exported = JSON.parse(catalogJSON());
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(exported.apiCount, API_CATALOG.length);
  assert.deepEqual(exported.apis.map(entry => entry.id), ids);
  for (const name of ["PRMU.getUIColorParameters", "PRMU.getVersion",
      "PRMU.getPluginSiteUrl"]) {
    assert.ok(ids.includes(name), "Missing public API: " + name);
  }
  assert.equal(queryCatalog({ search: "Router.request" }).total, 1);
  assert.equal(queryCatalog({ pageSize: 7 }).entries.length, 7);
});
test("PRMU public values, registration and version authority", () => {
  const kernel = createPluginKernel({ systemVersion: "3.1.0" });
  const p = kernel.load("example.a").PRMU;
  assert.equal(p.get("parameters", "system.version").data, "3.1.0");
  assert.throws(() => p.set("parameters", "system.version", "99"),
    /Host owns|VERSION_AUTHORITY/);
  assert.equal(p.getVersion().data, "3.1.0");
  assert.equal(p.getPluginSiteUrl().data,
    "https://xcxc84584-prog.github.io/Cluster-v3/");
  assert.match(p.getUIColorParameters().data.baseColor, /^#[0-9a-f]{6}$/i);
  assert.throws(() => p.set("parameters", "plugin.siteUrl", "https://invalid.example"),
    /Host owns|VERSION_AUTHORITY/);
  p.register("plugin.example", { key: "value", value: 42 });
  assert.equal(p.get("plugin.example", "value").data, 42);
  kernel.unload("example.a");
  assert.throws(() => kernel.host.PRMU.get("plugin.example", "value"), /NOT_FOUND|plugin.example.value/);
});
test("router correlates req/rep and records unavailable targets", async () => {
  const kernel = createPluginKernel();
  const a = kernel.load("example.a"), b = kernel.load("example.b");
  b.Router.register("ping", input => ({ pong: input.value }));
  assert.deepEqual((await a.Router.request("example.b", "ping", { value: 7 })).data, { pong: 7 });
  assert.equal(kernel.inspect("example.a").relations.filter(r => r.action === "ping").length, 2);
  const missing = await a.Router.request("missing", "ping", {});
  assert.equal(missing.status, 503);
  assert.ok(kernel.logs("elog").length >= 1);
});
test("recent log ring retains only last 2000; elog remains separate", () => {
  const kernel = createPluginKernel();
  for (let i = 0; i < 2010; i++) kernel.log("log", { action: "tick" });
  kernel.log("elog", { action: "fault", status: 500 });
  assert.equal(kernel.logs("log").length, 2000);
  assert.equal(kernel.logs("elog").length, 1);
});
