import test from "node:test";
import assert from "node:assert/strict";
import { createPluginKernel } from "../src/core/plugin-kernel.js";
test("ELog retry recovers failed writes without deleting records", async () => {
  let fail = true;
  const stored = [];
  const kernel = createPluginKernel({elogStore: {
    durable: true, load: async() => [],
    append: async entry => {
      if (fail) throw Error("QuotaExceeded");
      stored.push(entry);
    }
  }});
  await kernel.ready;
  kernel.log("elog",{source:"demo",action:"error",status:500});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(kernel.elogStatus().pending,1);
  assert.equal(kernel.elogStatus().error,"QuotaExceeded");
  fail = false;
  assert.equal((await kernel.retryElogPersistence()).recovered,1);
  assert.equal(kernel.elogStatus().pending,0);
  assert.equal(stored[0].action,"error");
  assert.ok(kernel.logs("elog").some(x=>x.error?.code==="ELOG_STORAGE_FAILED"));
});
test("ELog restore failures are reported", async () => {
  const kernel = createPluginKernel({elogStore:{
    load: async()=>{throw Error("database denied");},
    append: async()=>{}
  }});
  await kernel.ready;
  const item=kernel.logs("elog").find(x=>x.error?.code==="ELOG_RESTORE_FAILED");
  assert.equal(item.location.function,"load");
});
