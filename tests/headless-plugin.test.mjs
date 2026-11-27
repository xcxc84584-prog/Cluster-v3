import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validatePluginPackage} from '../src/plugin/package-format.js';
const encoder=new TextEncoder();
const manifest={schemaVersion:'1.0.0',id:'service.example',name:'Service Example',version:'1.0.0',entry:'index.html',apiVersion:'1.0.0',ui:{mode:'headless',home:false}};
const pack=m=>({'manifest.json':encoder.encode(JSON.stringify(m)),'index.html':encoder.encode('<html><body></body></html>')});
test('headless packages run without a user-facing page',()=>{
 assert.equal(validatePluginPackage(pack(manifest)).manifest.ui.mode,'headless');
 assert.throws(()=>validatePluginPackage(pack({...manifest,ui:{mode:'headless',home:true}})),/Headless plugin cannot be home/);
});
test('runtime keeps service frames hidden and broadcasts registered service changes',()=>{
 const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
 const runtime=read('src/plugin/browser-runtime.js'),app=read('src/plugin/app.js');
 assert.match(runtime,/services: kernel\.contract\.list\(\)/);
 assert.match(runtime,/state\.host\.hidden = headless/);
 assert.match(runtime,/kernel\.unload\(pluginId\);\s*syncContext\(\)/);
 assert.match(app,/if \(entry\.manifest\.ui\?\.mode !== "headless"\) actions\.append\(open\)/);
});
