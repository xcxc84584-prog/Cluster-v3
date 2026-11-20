import test from "node:test";
import assert from "node:assert/strict";
import { createPluginKernel } from "../src/core/plugin-kernel.js";
import { dispatchPluginCall } from "../src/plugin/host-bridge.js";
test("Host RPC checks typed arguments and avoids invoking invalid API", async () => {
  const kernel = createPluginKernel();
  kernel.load("demo.plugin");
  await assert.rejects(dispatchPluginCall(kernel, "demo.plugin",
    "PRMU.get", [22, "system.version"]), e => e.status === 400);
  const valid = await dispatchPluginCall(kernel, "demo.plugin",
    "PRMU.get", ["parameters", "system.version"]);
  assert.equal(valid.status,200);
  await assert.rejects(dispatchPluginCall(kernel,"demo.plugin",
    "PMU.uninstall",["cluster.pmu"]), e => e.status === 404);
});
test("Contract registration is scoped to plugin identity", async () => {
  const kernel = createPluginKernel();
  kernel.load("demo.a"); kernel.load("demo.b");
  const definition = { action:"demo.ping", request: {
    type:"object",required:["n"],properties:{n:{type:"integer"}} } };
  const out = await dispatchPluginCall(kernel,"demo.a",
    "Contract.register",[definition]);
  assert.equal(out.status,201);
  await assert.rejects(dispatchPluginCall(kernel,"demo.b",
    "Contract.unregister",["demo.a:demo.ping"]),e=>e.status===400);
  const checked = await dispatchPluginCall(kernel,"demo.a",
    "Contract.validate",["demo.a:demo.ping",{n:2}]);
  assert.equal(checked.data,true);
});
