import test from "node:test";
import assert from "node:assert/strict";
import { createPluginKernel } from "../src/core/plugin-kernel.js";
import { createBrowserPluginManager } from "../src/plugin/browser-runtime.js";
import { createHostPMU } from "../src/plugin/host-pmu.js";

class Element {
  constructor(tag = "div") {
    this.tag = tag;
    this.children = [];
    this.dataset = {};
    this.hidden = false;
    this.events = new Map();
    this.contentWindow = tag === "iframe" ? {
      messages: [], postMessage(msg) { this.messages.push(msg); }
    } : null;
  }
  append(...nodes) { this.children.push(...nodes); }
  remove() { this.removed = true; }
  addEventListener(name, callback) { this.events.set(name, callback); }
}
function harness() {
  const events = new Map();
  const oldWindow = globalThis.window;
  const oldDocument = globalThis.document;
  globalThis.window = {
    addEventListener: (name, cb) => events.set(name, cb),
    removeEventListener: name => events.delete(name)
  };
  globalThis.document = { createElement: tag => new Element(tag) };
  const list = [];
  const store = {
    async list() { return list.map(value => structuredClone(value)); },
    async install(manifest) {
      list.splice(list.findIndex(x => x.id === manifest.id), 0);
      list.push({ id: manifest.id, manifest, enabled: true });
    },
    async remove(id) {
      const at = list.findIndex(x => x.id === id);
      if (at >= 0) list.splice(at, 1);
    },
    async setEnabled(id, enabled) {
      const entry = list.find(x => x.id === id);
      if (entry) entry.enabled = enabled;
    }
  };
  const kernel = createPluginKernel();
  const pagesRoot = new Element();
  const settingsFrame = new Element("iframe");
  const browser = createBrowserPluginManager({
    kernel, pagesRoot, settingsFrame,
    packageStore: store, registerServiceWorker: async () => {},
    getContext: () => ({language:"zh-TW",palette:{background:"#000000"}}),
    onChange: () => {}, onFailure: error => { throw error; }
  });
  return {
    kernel, browser, list, pagesRoot, settingsFrame,
    message: (source, message) =>
      events.get("message")({source, data:{protocol:"cluster.plugin.v1",...message}}),
    restore() {
      browser.dispose();
      globalThis.window = oldWindow;
      globalThis.document = oldDocument;
    }
  };
}
const pkg = id => ({
  "manifest.json": JSON.stringify({
    schemaVersion:"1.0.0",id,name:id,version:"1.0.0",
    entry:"index.html",settings:"settings.html",ui:{mode:"both",home:true}
  }),
  "index.html": "<!doctype html><title>Test</title>",
  "settings.html": "<!doctype html><title>Settings</title>"
});
test("runtime: install, reload, unload, restore and Host-only PMU", async () => {
  const h = harness();
  try {
    await h.browser.ready;
    const pmu = createHostPMU({kernel:h.kernel,runtime:h.browser});
    await h.browser.installFiles(pkg("demo.a"));
    assert.equal(h.browser.isLoaded("demo.a"), true);
    assert.equal(h.list.length, 1);
    assert.match(h.pagesRoot.children.at(-1).children[0].src,
      /__cluster_plugins\/demo.a\/index.html$/);
    await pmu.reload("demo.a");
    assert.equal(h.browser.isLoaded("demo.a"), true);
    await pmu.unload("demo.a");
    assert.equal(h.browser.isLoaded("demo.a"), false);
    await pmu.load("demo.a");
    assert.equal(h.browser.isLoaded("demo.a"), true);
    await pmu.uninstall("demo.a");
    assert.equal(h.list.length, 0);
    assert.equal(h.browser.isLoaded("demo.a"), false);
    assert.ok(h.kernel.plugins.includes("cluster.pmu"));
  } finally { h.restore(); }
});
test("runtime: two frames exchange validated Router req/rep", async () => {
  const h = harness();
  try {
    await h.browser.ready;
    await h.browser.installFiles(pkg("demo.a"));
    await h.browser.installFiles(pkg("demo.b"));
    const a = h.pagesRoot.children[0].children[0].contentWindow;
    const b = h.pagesRoot.children[1].children[0].contentWindow;
    await h.message(b, {type:"request",requestId:"register",
      method:"Router.register",args:["demo.echo","runtime-callback",{
        contract:{
          request:{type:"object",required:["text"],
            properties:{text:{type:"string"}}},
          response:{type:"object",required:["echoed"],
            properties:{echoed:{type:"string"}}}
        }
      }]});
    assert.equal(b.messages.at(-1).status,201);
    const active = h.message(a, {type:"request",requestId:"route",
      method:"Router.request",args:["demo.b","demo.echo",{text:"Hello"}]});
    await new Promise(resolve => setImmediate(resolve));
    const invoke = b.messages.find(msg =>
      msg.type === "invoke" && msg.action === "demo.echo");
    assert.ok(invoke, "Router must invoke target iframe");
    await h.message(b, {type:"invoke-result",requestId:invoke.requestId,
      ok:true,data:{echoed:"Hello"}});
    await active;
    const reply = a.messages.find(msg => msg.requestId === "route");
    assert.equal(reply.status,200);
    assert.equal(reply.data.echoed,"Hello");
    await h.message(a, {type:"request",requestId:"bad",
      method:"Router.request",args:["demo.b","demo.echo",{text:42}]});
    assert.equal(a.messages.find(msg => msg.requestId === "bad").status,400);
    assert.ok(h.kernel.logs("elog").some(log =>
      log.error?.code === "CONTRACT_VALIDATION_FAILED"));
  } finally { h.restore(); }
});
test("runtime: invalid bridge messages cannot request Host core lifecycle", async () => {
  const h = harness();
  try {
    await h.browser.ready;
    await h.browser.installFiles(pkg("demo.a"));
    const source = h.pagesRoot.children[0].children[0].contentWindow;
    await h.message(source, {type:"request",requestId:"denied",
      method:"PMU.uninstall",args:["cluster.pmu"]});
    assert.equal(source.messages.find(x => x.requestId === "denied").status,403);
    assert.ok(h.kernel.plugins.includes("cluster.pmu"));
    const alien = {postMessage() { throw Error("unexpected response"); }};
    await h.message(alien, {type:"request",requestId:"spoof",
      method:"PRMU.get",args:["parameters","system.version"]});
    assert.equal(h.kernel.plugins.length,2);
  } finally { h.restore(); }
});

test("runtime: plugin iframe is intentionally unsandboxed", async () => {
  const h = harness();
  try {
    await h.browser.ready;
    await h.browser.installFiles(pkg("demo.unsandboxed"));
    const iframe = h.pagesRoot.children.at(-1).children[0];
    assert.equal(iframe.sandbox, undefined);
  } finally { h.restore(); }
});
