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
      "sample.plugin", method, []), error => error.status === 404);
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
