import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DEFAULT_COMMUNITY_CONFIG, PLUGIN_SITE_URL} from '../src/core/public-repository.js';
import {SUPPORTED_LANGUAGES,TRANSLATIONS} from '../src/core/translations.js';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('root is a real no-version landing page instead of redirect',()=>{
 const html=read('index.html');
 assert.match(html,/<title>Cluster<\/title>/);
 assert.match(html,/assets\/cluster-diamond\.svg/);
 assert.match(html,/id="homeInitialize"/);
 assert.match(html,/id="homeManager"/);
 assert.match(html,/id="homeLanguage"/);
 assert.match(html,/id="homeWorkspace"/);
 assert.doesNotMatch(html,/location\.replace\(/);
 assert.doesNotMatch(html,/>Cluster v3</);
});
test('home checks persisted packages, not browser memory',()=>{
 const js=read('src/home/app.js');
 assert.match(js,/createPackageStore\(\)\.list\(\)/);
 assert.match(js,/if\(records\.length\)showWorkspace\(\)/);
 assert.match(js,/loadInitializer\(\)/);
 assert.match(js,/\.get\(['\x22]plugin['\x22]\)/);
 assert.match(js,/event\.origin!==location\.origin/);
});
test('init loads only PRMU-indexed Folder packages into persistent runtime',()=>{
 const host=read('src/plugin/app.js');
 assert.match(host,/fetchCommunityIndex\(config\)/);
 assert.match(host,/fetchCommunityPlugin\(entry, config\)/);
 assert.match(host,/browserManager\.installFiles\(files\)/);
 assert.match(host,/if \(query\.get\('initialize'\) === '1'\)/);
 assert.match(host,/protocol:'cluster\.home\.v1',type:'initialized'/);
 assert.match(host,/repo\.getCommunityConfig\(\)\.homePluginId/);
 assert.equal(DEFAULT_COMMUNITY_CONFIG.homePluginId,'cluster.text-editor');
 assert.deepEqual(DEFAULT_COMMUNITY_CONFIG.homeNavigationPluginIds,
   ['cluster.explorer','cluster.text-editor']);
 assert.equal(PLUGIN_SITE_URL,'https://xcxc84584-prog.github.io/Cluster-v3/');
});
test('root style keeps blue bevel without header or footer',()=>{
 const css=read('src/home/style.css');
 const html=read('index.html');
 assert.match(css,/clip-path:polygon/);
 assert.match(css,/--ui-accent/);
 assert.match(css,/\.home-language/);
 assert.match(css,/\.home-primary/);
 assert.doesNotMatch(html,/<header\b|<footer\b/);
});
test('home text exists in each authoritative PRMU locale',()=>{
 for (const [lang] of SUPPORTED_LANGUAGES) for(const key of
   ['homeLanguage','homeNoPlugins','homeInitialize','homeInitializeDesc',
    'homeManage','homeManageDesc','homeInitializing',
    'homeInitializeFailed','homeLoading'])
   assert.equal(typeof TRANSLATIONS[lang][key],'string',lang+':'+key);
});


test('uninitialized home is compact, centered and without outer frame or empty notice',()=>{
  const html=read('index.html');
  const css=read('src/home/style.css');
  assert.doesNotMatch(html,/class="home-outline"/);
  assert.doesNotMatch(html,/data-i18n="homeNoPlugins"/);
  assert.doesNotMatch(css,/\.home-outline/);
  assert.match(css,/width:min\(100%,560px\)/);
  assert.match(css,/min-height:74px/);
  assert.match(css,/margin:26px auto 0/);
});
test('all homepage routes are published by PRMU',()=>{
  const js=read('src/home/app.js');
  const html=read('index.html');
  assert.match(js,/repo\.getPluginManagerUrl\(\)/);
  assert.doesNotMatch(js,/new URL\(["']\.\/plugin\//);
  assert.doesNotMatch(html,/href="\.\/plugin\//);
});

test('reload never reveals Plugin Manager before workspace is ready',()=>{
  const root=read('src/home/app.js');
  const manager=read('plugin/index.html');
  const host=read('src/plugin/app.js');
  assert.match(manager,/cluster-workspace-boot/);
  assert.match(manager,/visibility:hidden/);
  assert.match(manager,/body\.standalone-mode \{visibility:visible\}/);
  assert.match(root,/workspace\.hidden=true;\s*const url=new URL\(repo\.getPluginManagerUrl\(\)\)/);
  assert.match(root,/event\.data\.type==="workspace-ready"/);
  assert.match(root,/workspace\.hidden=false;\s*splash\.hidden=true;/);
  assert.match(host,/frame\.addEventListener\('load', announce, \{once:true\}\)/);
  assert.match(host,/type:'workspace-ready'/);
});
