import test from "node:test";
import assert from "node:assert/strict";
import { dispatchPluginCall } from "../src/plugin/host-bridge.js";
import { createPluginKernel } from "../src/core/plugin-kernel.js";

test("plugin RPC can use PRMU and Router without direct Host access", async () => {
  const kernel = createPluginKernel();
  kernel.load("sample.plugin");
  const dispatch = (method, args) => dispatchPluginCall(kernel,
    "sample.plugin", method, args, async () => ({ ok: true }));
  assert.equal((await dispatch("PRMU.get", ["parameters", "system.version"])).status, 200);
  assert.equal((await dispatch("PRMU.register", ["sample", {
    key: "state", value: 8 }])).status, 201);
  assert.equal((await dispatch("PRMU.get", ["sample", "state"])).data, 8);
  assert.equal((await dispatch("Router.register", ["echo"])).status, 201);
  const reply = await kernel.host.Router.request("sample.plugin", "echo", {});
  assert.deepEqual(reply.data, { ok: true });
});
test("plugin RPC cannot uninstall, unload or replace PMU", async () => {
  const kernel = createPluginKernel();
  kernel.load("sample.plugin");
  for (const method of ["PMU.uninstall", "PMU.unload", "PMU.install"]) {
    await assert.rejects(dispatchPluginCall(kernel,
      "sample.plugin", method, []), error => error.status === 403);
  }
  assert.equal(kernel.plugins.length, 2);
});
test("PMU.log records real plugin id rather than a spoofed source", async () => {
  const kernel = createPluginKernel();
  kernel.load("sample.plugin");
  await dispatchPluginCall(kernel, "sample.plugin", "PMU.log", [
    "log", { source: "cluster.pmu", action: "sample.called", status: 200 }
  ]);
  const item = kernel.logs("log").at(-1);
  assert.equal(item.source, "sample.plugin");
});

test("PRMU Capability Registry is generic and appears in the API catalog", async () => {
  const kernel = createPluginKernel();
  kernel.load("sample.provider");
  kernel.load("sample.consumer");
  assert.ok(kernel.catalog.some(api => api.id === "PRMU.resolveCapability" &&
    api.implementation !== "planned"));
  const registered = await dispatchPluginCall(kernel, "sample.provider",
    "PRMU.register", ["capabilities", {
      key:"sample.panel.v1", value:{ kind:"ui.embed",version:"1.0.0" },
      sharedWrite:false,persistent:false
    }]);
  assert.equal(registered.status,201);
  const resolver = async capability => {
    assert.equal(capability,"sample.panel.v1");
    return { capability, pluginId:"sample.provider",
      version:"1.0.0", html:"<!doctype html><title>Panel</title>" };
  };
  const result = await dispatchPluginCall(kernel, "sample.consumer",
    "PRMU.resolveCapability", ["sample.panel.v1"], undefined, resolver);
  assert.equal(result.data.pluginId,"sample.provider");
  assert.match(result.data.html,/Panel/);
  assert.equal(kernel.host.PRMU.list("capabilities").data[0].owner,
    "sample.provider");
  kernel.unload("sample.provider");
  assert.equal(kernel.host.PRMU.list("capabilities").data.length, 0);
});

test("shared PRMU palette write updates Host snapshot and stays API discoverable", async () => {
  const kernel = createPluginKernel({elogStore:{load:async()=>[],append:async()=>{}}});
  kernel.load("sample.palette-plugin");
  const result = await dispatchPluginCall(kernel,"sample.palette-plugin",
    "PRMU.setUIColorBaseColor",["#224466"]);
  assert.equal(result.status,200);
  const reply = await dispatchPluginCall(kernel,"sample.palette-plugin",
    "PRMU.getUIColorParameters",[]);
  assert.equal(reply.data.baseColor,"#224466");
  assert.equal(reply.data.palette.background,"#224466");
  assert.ok(kernel.catalog.some(api =>
    api.id === "PRMU.setUIColorBaseColor" && api.implementation === "initial"));
  await assert.rejects(dispatchPluginCall(kernel,"sample.palette-plugin",
    "PRMU.setUIColorBaseColor",["not-a-color"]));
  kernel.dispose();
});

test("PRMU.openUIColorPalette opens the existing Host palette modal", async () => {
  const kernel = createPluginKernel({elogStore:{
    load: async () => [], append: async () => {}
  }});
  kernel.load("sample.palette-plugin");
  let opens = 0;
  const reply = await dispatchPluginCall(kernel, "sample.palette-plugin",
    "PRMU.openUIColorPalette", [], undefined, undefined, () => { opens++; });
  assert.equal(reply.status, 200);
  assert.deepEqual(reply.data, { opened: true });
  assert.equal(opens, 1);
  assert.ok(kernel.catalog.some(api =>
    api.id === "PRMU.openUIColorPalette" && api.implementation === "initial"));
  await assert.rejects(dispatchPluginCall(kernel, "sample.palette-plugin",
    "PRMU.openUIColorPalette", []), error =>
    error.status === 503 && error.code === "UI_UNAVAILABLE");
  kernel.dispose();
});
