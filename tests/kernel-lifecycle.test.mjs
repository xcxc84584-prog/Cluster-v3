import test from "node:test";
import assert from "node:assert/strict";
import { createPluginKernel } from "../src/core/plugin-kernel.js";

test("new router handshakes with every existing plugin", async () => {
  const kernel = createPluginKernel();
  const a = kernel.load("a");
  await a.ready;
  const b = kernel.load("b");
  const replies = await b.ready;
  assert.equal(replies.length, 2);
  assert.ok(replies.every(reply => reply.status === 200));
  assert.ok(kernel.inspect("b").relations.some(r => r.action === "router.handshake"));
});
test("plugin log mirror and durable ELog adapter", async () => {
  const entries = [];
  const store = {
    load: async () => [],
    append: async entry => { entries.push(entry); }
  };
  const kernel = createPluginKernel({ elogStore: store });
  await kernel.ready;
  kernel.load("a");
  kernel.log("elog", { source: "a", target: "cluster.pmu", status: 500 });
  assert.equal(kernel.pluginLogs("a").elog.length, 1);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(entries.length, 1);
});
test("PRMU notifies subscribers for plugin-owned shared entries", () => {
  const kernel = createPluginKernel();
  const a = kernel.load("a").PRMU;
  a.register("app.a", { key: "hello", value: 1 });
  const observed = [];
  const id = a.subscribe("app.a", "hello", value => observed.push(value));
  a.set("app.a", "hello", 2);
  a.unsubscribe(id);
  assert.deepEqual(observed, [2]);
});
