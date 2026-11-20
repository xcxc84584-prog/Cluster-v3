import test from "node:test";
import assert from "node:assert/strict";
import { createPluginKernel } from "../src/core/plugin-kernel.js";
test("Router request and reply must both conform to declared contract", async () => {
  const kernel = createPluginKernel();
  const sender = kernel.load("demo.sender");
  const receiver = kernel.load("demo.receiver");
  receiver.Router.register("echo", input => ({ copied: input.text }), {
    contract: {
      request: { type:"object", required:["text"],
        properties:{text:{type:"string"}} },
      response: { type:"object", required:["copied"],
        properties:{copied:{type:"string"}} }
    }
  });
  const good = await sender.Router.request("demo.receiver", "echo", {text:"Hi"});
  assert.equal(good.status, 200);
  const invalid = await sender.Router.request("demo.receiver", "echo", {text:42});
  assert.equal(invalid.status, 400);
  assert.equal(invalid.error.code, "CONTRACT_VALIDATION_FAILED");
  assert.ok(kernel.logs("elog").some(log => log.location?.path?.includes(".req")));
  receiver.Router.unregister("echo");
  receiver.Router.register("echo", () => ({copied:17}), {
    contract: { response: {type:"object", required:["copied"],
      properties:{copied:{type:"string"}} } }
  });
  const malformed = await sender.Router.request("demo.receiver", "echo", {});
  assert.equal(malformed.status, 400);
  assert.ok(kernel.logs("elog").some(log => log.location?.path?.includes(".rep")));
});
test("failed durable storage is diagnosed without recursive log writes", async () => {
  const kernel = createPluginKernel({elogStore:{
    load:async()=>[], append:async()=>{throw Error("quota exceeded");}
  }});
  kernel.log("elog",{action:"test.failed", status:500});
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(kernel.logs("elog").some(log => log.error?.code === "ELOG_STORAGE_FAILED"));
});
