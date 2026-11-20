/** Chrome DevTools smoke test without third-party browser libraries. */
import { createServer } from "node:http";
import { readFile, mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, extname } from "node:path";
import { spawn } from "node:child_process";
import { createServer as createTCPServer } from "node:net";

const root = resolve(import.meta.dirname, "..");
const mime = {".html":"text/html",".js":"text/javascript",".css":"text/css",
  ".json":"application/json",".md":"text/markdown",".svg":"image/svg+xml"};
const http = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (!url.pathname.startsWith("/Cluster-v3/")) {
    res.writeHead(404);res.end();return;
  }
  const p = decodeURIComponent(url.pathname.slice("/Cluster-v3/".length));
  const path = resolve(root, (!p || p.endsWith("/")) ? p + "index.html" : p);
  if (!path.startsWith(root + "/")) {
    res.writeHead(403);res.end();return;
  }
  try {
    const data = await readFile(path);
    res.writeHead(200,{"Content-Type":mime[extname(path)] ||
      "application/octet-stream","Cache-Control":"no-store"});
    res.end(data);
  } catch {res.writeHead(404);res.end("Not found");}
});
const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));
const assert = (value, message) => {
  if(!value) throw Error("Browser smoke failed: "+message);
};
async function chromePath() {
  for (const p of [process.env.CHROME_BIN,"/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable","/usr/bin/chromium"]) {
    if (!p) continue;
    try {await access(p);return p;}catch{/*try next*/}
  }
  throw Error("Chrome binary not found on runner");
}
const profile = await mkdtemp(join(tmpdir(),"cluster-v3-chrome-"));
let browser, socket, debugPort;
let stderrText = "";
async function freePort() {
  const server = createTCPServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
const pending = new Map();
const browserErrors = [];
const iframeSessions = new Set();
try {
  await new Promise(resolve=>http.listen(0,"127.0.0.1",resolve));
  const hostURL="http://127.0.0.1:"+http.address().port+"/Cluster-v3/plugin/";
  debugPort = await freePort();
  browser=spawn(await chromePath(),[
    "--headless=new","--no-sandbox","--disable-gpu","--disable-dev-shm-usage",
    "--disable-background-networking","--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port="+debugPort,"--user-data-dir="+profile,"about:blank"
  ],{stdio:["ignore","ignore","pipe"]});
  browser.on("error", error => {
    stderrText += "\nChrome spawn error: " + String(error);
  });
  browser.stderr.on("data",chunk=>{
    stderrText = (stderrText + String(chunk)).slice(-8000);
    const found=String(chunk).match(/DevTools listening on ws:\/\/[^:]+:(\d+)\//);
    if(found) debugPort=Number(found[1]);
  });
  let targets = null;
  for (let i=0; i<300; i++) {
    if (browser.exitCode !== null) break;
    try {
      const response = await fetch("http://127.0.0.1:"+
        debugPort+"/json/list");
      if (response.ok) { targets = await response.json(); break; }
    } catch {/* Chrome not yet listening */}
    await sleep(100);
  }
  assert(targets, "Chrome remote debugger unavailable; exit="+
    browser.exitCode+" stderr: "+stderrText);
  const page=targets.find(target=>target.type==="page");
  assert(page?.webSocketDebuggerUrl,"Chrome page target missing");
  socket=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{
    socket.onopen=resolve;
    socket.onerror=()=>reject(Error("Chrome websocket failed"));
  });
  let serial=0;
  socket.onmessage=event=>{
    const message=JSON.parse(event.data);
    if (message.method === "Target.attachedToTarget") {
      browserErrors.push({method:"Target.attachedToTarget",
        target:message.params?.targetInfo});
      const session = message.params?.sessionId;
      if (session) {
        if (message.params?.targetInfo?.type === "iframe") {
          iframeSessions.add(session);
        }
        void send("Runtime.enable",{},session).catch(()=>{});
        void send("Log.enable",{},session).catch(()=>{});
        void send("Network.enable",{},session).catch(()=>{});
      }
    }
    if (message.method === "Network.responseReceived" &&
        message.params?.response?.url?.includes("__cluster_plugins")) {
      browserErrors.push({method:"Network.responseReceived",
        response:message.params.response});
    }
    if (message.method === "Runtime.exceptionThrown" ||
        message.method === "Log.entryAdded" ||
        message.method === "Runtime.consoleAPICalled") {
      browserErrors.push(message);
    }
    const waiting=pending.get(message.id);
    if(!waiting)return;
    pending.delete(message.id);
    if(message.error)waiting.reject(Error(JSON.stringify(message.error)));
    else waiting.resolve(message.result);
  };
  function send(method,params={},sessionId=null) {
    const id=++serial;
    return new Promise((resolve,reject)=>{
      pending.set(id,{resolve,reject});
      socket.send(JSON.stringify({id,method,params,
        ...(sessionId ? {sessionId} : {})}));
    });
  }
  async function evaluate(expression) {
    const r=await send("Runtime.evaluate",{expression,
      returnByValue:true,awaitPromise:true});
    if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  }
  async function until(expression,label) {
    for(let i=0;i<120;i++){
      try{if(await evaluate(expression))return;}catch{/*navigation*/}
      await sleep(150);
    }
    try {
      const diagnosis = await evaluate(
        "(async()=>({url:location.href,readyState:document.readyState,status:document.querySelector('#loaderStatus')?.textContent," +
        "pluginCount:document.querySelector('#pluginCount')?.textContent," +
        "api:document.querySelector('#apiTableBody')?.textContent?.slice(0,300)," +
        "frame:document.querySelector('.plugin-main-frame')?.dataset.virtualPath," +
        "connected:document.querySelector('.plugin-main-frame')?.isConnected," +
        "hasWindow:Boolean(document.querySelector('.plugin-main-frame')?.contentWindow)," +
        "sandbox:document.querySelector('.plugin-main-frame')?.getAttribute('sandbox')," +
        "pageHidden:document.querySelector('[data-view=page]')?.hidden," +
        "pageDisplay:document.querySelector('[data-view=page]')?.style.display," +
        "hostInactive:document.querySelector('.plugin-main-host')?.dataset.inactive," +
        "hostDisplay:document.querySelector('.plugin-main-host')?.style.display," +
        "frameEvents:(window.__clusterFrameEvents||[]).slice(-12)," +
        "controlled:Boolean(navigator.serviceWorker.controller)," +
        "asset:(await fetch('/Cluster-v3/__cluster_plugins/example.hello/index.html'))" +
        ".status,script:(await fetch('/Cluster-v3/__cluster_plugins/example.hello/scripts/app.js')).status,logs:document.querySelector('#logList')?.textContent?.slice(-1300)}))()");
      console.error("Browser diagnostic:", JSON.stringify(diagnosis));
      console.error("Chrome console/errors:", JSON.stringify(browserErrors).slice(-15000));
      console.error("FrameTree:", JSON.stringify(
        await send("Page.getFrameTree")).slice(-12000));
    } catch (error) { console.error("Diagnostic failed:", error.message); }
    throw Error("Timeout waiting for "+label);
  }
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Target.setAutoAttach", {
    autoAttach:true,waitForDebuggerOnStart:false,flatten:true
  });
  await send("Page.navigate",{url:hostURL});
  await until("document.documentElement.dataset.clusterReady === '1'",
    "Host initialization and Service Worker activation");
  // Measure only after opening the community tab; hidden tabs have zero geometry.
  await evaluate("document.querySelector('[data-tab=community]').click()");
  // Real browser geometry catches flex-wrap and vertical text regressions.
  const marketplaceLayout = await evaluate(`(() => {
    const card = document.querySelector('.community-card');
    const buttons = [...(card?.querySelectorAll('.community-card-actions button') || [])];
    const rows = buttons.map(button => {
      const rect = button.getBoundingClientRect();
      const style = getComputedStyle(button);
      return { width: rect.width, height: rect.height,
        writingMode: style.writingMode, whiteSpace: style.whiteSpace };
    });
    return { count: document.querySelectorAll('.community-card').length,
      rows };
  })()`);
  assert(marketplaceLayout.count === 1, "Default example card must appear once");
  assert(marketplaceLayout.rows.length === 2, "Download and quick install required");
  assert(marketplaceLayout.rows.every(row =>
    row.width > 65 && row.height < 55 &&
    row.writingMode === "horizontal-tb" && row.whiteSpace === "nowrap"),
    "Marketplace buttons must stay horizontally readable: " +
      JSON.stringify(marketplaceLayout));
  assert(await evaluate("document.querySelectorAll('.plugin-entry-wrapper').length") >= 1,
    "Explorer must include PMU row");
  assert(await evaluate("document.querySelector('#pluginStandalone') === null"),
    "Page-level standalone button must be removed");
  const explorerActions = await evaluate(`(() => {
    const rows = [...document.querySelectorAll('.plugin-entry-wrapper')];
    return { coreActions: rows[0]?.querySelectorAll('.plugin-action').length ?? -1,
      plugins: rows.slice(1).map(row =>
        [...row.querySelectorAll('.plugin-action')].map(button =>
          ({ symbol: button.textContent, label: button.getAttribute('aria-label') })))
    };
  })()`);
  assert(explorerActions.coreActions === 0,
    "Protected PMU must not have plugin controls");

  await evaluate("document.querySelector('[data-tab=router]').click();"+
    "document.querySelector('#refreshRouter').click()");
  assert(await evaluate("document.querySelector('#refreshRouter').classList.contains('is-refreshing')"),
    "Router refresh icon must update visually");
  await evaluate("document.querySelector('[data-tab=community]').click()");

  await evaluate("window.__clusterFrameEvents=[];window.addEventListener('message',"+ 
    "e=>window.__clusterFrameEvents.push({origin:e.origin,data:e.data}));");
  await until("document.querySelector('.community-install-button') !== null",
    "marketplace card displayed");
  await evaluate("document.querySelector('.community-install-button').click()");
  await until("document.querySelector('#pluginCount')?.textContent === '02'",
    "example plugin installation");
  await until("Boolean(document.querySelector('.plugin-main-frame')?.srcdoc)",
    "installed iframe");
  const overlayCheck = await evaluate(`(() => {
    const hint = document.querySelector('#pluginPageEmpty');
    const page = document.querySelector('[data-view=page]');
    const bounds = page.getBoundingClientRect();
    const point = document.elementFromPoint(
      bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
    return {
      hidden: hint.hidden,
      display: getComputedStyle(hint).display,
      blocksCenter: point === hint || hint.contains(point)
    };
  })()`);
  assert(overlayCheck.hidden && overlayCheck.display === "none" &&
    !overlayCheck.blocksCenter,
    "Hidden Host placeholder must not intercept plugin clicks: " +
      JSON.stringify(overlayCheck));

  await until("window.__clusterFrameEvents?.some(e=>"+
    "e.data?.method === 'Router.register')",
    "iframe registered Router action");
  const requester = await evaluate(
    "window.__clusterFrameEvents.find(e=>e.data?.method==='Router.register')?.origin");
  assert(requester === "null",
    "Plugin iframe must have opaque origin after CSP sandbox: "+requester);
  await until("Boolean(document.querySelector('[data-community-plugin=\"example.hello\"]')?.srcdoc)",
    "plugin-provided community card");
  const communitySandbox = await evaluate(
    "document.querySelector('[data-community-plugin=\"example.hello\"]')?.getAttribute('sandbox')");
  assert(communitySandbox === "allow-scripts allow-forms",
    "Community card must be opaque and container bounded");
  const uniqueCards = await evaluate(
    "[...document.querySelectorAll('.community-card')].filter(" +
    "x=>x.dataset.communityId==='example.hello').length");
  assert(uniqueCards === 1, "Marketplace must not duplicate installed example");
  await evaluate("document.querySelector('#communitySearch').value='nonexistent';" +
    "document.querySelector('#communitySearch').dispatchEvent(new Event('input'))");
  assert(await evaluate("document.querySelector('#communityEmpty').hidden") === false,
    "Marketplace search must render empty state");
  await evaluate("document.querySelector('#communitySearch').value='';" +
    "document.querySelector('#communitySearch').dispatchEvent(new Event('input'))");
  let echoSession = null;
  for (const session of iframeSessions) {
    try {
      const found = await send("Runtime.evaluate", {
        expression:"Boolean(document.querySelector('#echo'))",
        returnByValue:true
      }, session);
      if (found?.result?.value) { echoSession = session; break; }
    } catch { /* iframe navigated / was replaced */ }
  }
  assert(echoSession, "Cannot locate example plugin runtime frame in Chrome");
  await send("Runtime.evaluate", {
    expression:"document.querySelector('#echo').click()",
    returnByValue:true
  }, echoSession);
  let echoOk = false;
  for (let i=0; i<100; i++) {
    const value = await send("Runtime.evaluate", {
      expression:"document.querySelector('#output')?.textContent",
      returnByValue:true
    }, echoSession);
    if (value?.result?.value?.includes("Hello from Cluster")) {
      echoOk=true;break;
    }
    await sleep(80);
  }
  assert(echoOk, "Plugin Router req/rep in real Chrome must return Echo");
  await evaluate("document.querySelector('[data-tab=apis]').click()");
  await until("document.querySelector('#apiTableBody')?.textContent.includes('demo.echo')",
    "plugin runtime contract registration");
  await evaluate("document.querySelector('.api-link').click()");
  assert(await evaluate("document.querySelector('#apiDetail').open"),
    "API JSON must open in a modal dialog");
  await evaluate("document.querySelector('#apiModalClose').click()");
  assert(!(await evaluate("document.querySelector('#apiDetail').open")),
    "API modal must close using its button");
  const url=new URL("../",hostURL);
  url.searchParams.set("plugin","example.hello");
  await send("Page.navigate",{url:url.href});
  await until("document.body?.classList.contains('standalone-mode')",
    "standalone entry and IndexedDB restore");
  await until("Boolean(document.querySelector('.plugin-main-frame')?.srcdoc)",
    "standalone plugin iframe");
  const isolated=await evaluate(
    "document.querySelector('.plugin-main-frame')?.getAttribute('sandbox')");
  assert(isolated === "allow-scripts allow-forms",
    "srcdoc iframe must exclude same-origin privilege");
  console.log("Chrome E2E PASS: install, API contract, standalone restore, CSP");
} finally {
  socket?.close();
  browser?.kill("SIGKILL");
  http.close();
  for (let retry = 0; retry < 5; retry++) {
    try { await rm(profile, {recursive:true,force:true}); break; }
    catch (error) {
      if (retry === 4) console.error("Chrome profile cleanup:",error.message);
      await sleep(150);
    }
  }
}
