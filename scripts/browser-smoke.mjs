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
  const path = resolve(root, p.endsWith("/") ? p + "index.html" : p);
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
try {
  await new Promise(resolve=>http.listen(0,"127.0.0.1",resolve));
  const hostURL="http://127.0.0.1:"+http.address().port+"/Cluster-v3/plugin/";
  debugPort = await freePort();
  browser=spawn(await chromePath(),[
    "--headless=new","--no-sandbox","--disable-gpu","--disable-dev-shm-usage",
    "--no-first-run","--no-default-browser-check",
    "--remote-debugging-port="+debugPort,"--user-data-dir="+profile,"about:blank"
  ],{stdio:["ignore","ignore","pipe"]});
  browser.stderr.on("data",chunk=>{
    stderrText = (stderrText + String(chunk)).slice(-8000);
    const found=String(chunk).match(/DevTools listening on ws:\/\/[^:]+:(\d+)\//);
    if(found) debugPort=Number(found[1]);
  });
  let targets = null;
  for (let i=0; i<120; i++) {
    if (browser.exitCode !== null) break;
    try {
      const response = await fetch("http://127.0.0.1:"+
        debugPort+"/json/list");
      if (response.ok) { targets = await response.json(); break; }
    } catch {/* Chrome not yet listening */}
    await sleep(100);
  }
  assert(targets, "Chrome remote debugger unavailable; stderr: "+stderrText);
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
  function send(method,params={}) {
    const id=++serial;
    return new Promise((resolve,reject)=>{
      pending.set(id,{resolve,reject});
      socket.send(JSON.stringify({id,method,params}));
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
        "(async()=>({status:document.querySelector('#loaderStatus')?.textContent," +
        "pluginCount:document.querySelector('#pluginCount')?.textContent," +
        "api:document.querySelector('#apiTableBody')?.textContent?.slice(0,300)," +
        "frame:document.querySelector('.plugin-main-frame')?.src," +
        "controlled:Boolean(navigator.serviceWorker.controller)," +
        "asset:(await fetch('/Cluster-v3/__cluster_plugins/example.hello/index.html'))" +
        ".status,logs:document.querySelector('#logList')?.textContent?.slice(-1300)}))()");
      console.error("Browser diagnostic:", JSON.stringify(diagnosis));
      console.error("Chrome console/errors:", JSON.stringify(browserErrors).slice(-15000));
    } catch (error) { console.error("Diagnostic failed:", error.message); }
    throw Error("Timeout waiting for "+label);
  }
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Page.navigate",{url:hostURL});
  await until("Boolean(document.querySelector('#installExample'))","Host UI");
  await evaluate("document.querySelector('#installExample').click()");
  await until("document.querySelector('#pluginCount')?.textContent === '02'",
    "example plugin installation");
  await until("Boolean(document.querySelector('.plugin-main-frame')?.src)",
    "installed iframe");
  await evaluate("document.querySelector('[data-tab=apis]').click()");
  await until("document.querySelector('#apiTableBody')?.textContent.includes('demo.echo')",
    "plugin runtime contract registration");
  const url=new URL("../",hostURL);
  url.searchParams.set("plugin","example.hello");
  await send("Page.navigate",{url:url.href});
  await until("document.body?.classList.contains('standalone-mode')",
    "standalone entry and IndexedDB restore");
  await until("Boolean(document.querySelector('.plugin-main-frame')?.src)",
    "standalone plugin iframe");
  const sandbox=await evaluate(
    "(async()=>{const r=await fetch('/Cluster-v3/__cluster_plugins/example.hello/index.html');"+
    "return r.headers.get('Content-Security-Policy')?.includes('sandbox');})()");
  assert(sandbox,"virtual plugin must be CSP sandboxed");
  console.log("Chrome E2E PASS: install, API contract, standalone restore, CSP");
} finally {
  socket?.close();
  browser?.kill("SIGKILL");
  http.close();
  await rm(profile,{recursive:true,force:true});
}
