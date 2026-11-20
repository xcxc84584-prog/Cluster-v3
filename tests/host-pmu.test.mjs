import test from "node:test";
import assert from "node:assert/strict";
import { createHostPMU } from "../src/plugin/host-pmu.js";
test("Host PMU routes complete lifecycle through runtime without leaking hooks", async () => {
  const calls = [];
  const runtime = {
    installZip: async data => { calls.push(["install",data]); return {id:"a"}; },
    installFolder: async data => { calls.push(["folder",data]); return {id:"a"}; },
    remove:async id=>calls.push(["remove",id]),
    load:async id=>{calls.push(["load",id]);return {id};},
    unload:async id=>calls.push(["unload",id]),
    reload:async id=>{calls.push(["reload",id]);return {id};},
    configure:async(id,c)=>calls.push(["configure",id,c]),
    get:id=>({id}), list:()=>[{id:"a"}], isLoaded:()=>true
  };
  const kernel = {inspect:id=>({id}),pluginLogs:()=>({log:[],elog:[]})};
  const pmu=createHostPMU({kernel,runtime});
  assert.equal((await pmu.install("zip")).data.id,"a");
  assert.equal((await pmu.install("folder",{format:"folder"})).data.id,"a");
  assert.equal((await pmu.reload("a")).data,"a");
  assert.equal((await pmu.configure("a",{enabled:false})).ok,true);
  assert.equal((await pmu.uninstall("a")).data,true);
  assert.equal(pmu.inspect("a").data.loaded,true);
  assert.equal(calls.length,5);
});
