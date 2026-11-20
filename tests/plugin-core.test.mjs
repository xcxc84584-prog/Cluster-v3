import test from "node:test";
import assert from "node:assert/strict";
import { API_CATALOG, queryCatalog, catalogJSON } from "../src/core/api-catalog.js";
import { createPluginKernel } from "../src/core/plugin-kernel.js";

test("catalog has 48 unique, searchable and serializable contracts", () => {
  assert.equal(API_CATALOG.length, 48);
  assert.equal(new Set(API_CATALOG.map(x => x.id)).size, 48);
  assert.equal(JSON.parse(catalogJSON()).apiCount, 48);
  assert.equal(queryCatalog({ search: "Router.request" }).total, 1);
  assert.equal(queryCatalog({ pageSize: 7 }).entries.length, 7);
});
test("PRMU public values, registration and version authority", () => {
  const kernel = createPluginKernel({ systemVersion: "3.1.0" });
  const p = kernel.load("example.a").PRMU;
  assert.equal(p.get("parameters", "system.version").data, "3.1.0");
  assert.throws(() => p.set("parameters", "system.version", "99"), /PMU owns/);
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
