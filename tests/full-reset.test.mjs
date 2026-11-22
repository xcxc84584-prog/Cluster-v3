import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resetClusterData} from '../src/core/full-reset.js';
import {publicRepository,FULL_RESET_POLICY} from '../src/core/public-repository.js';
import {SUPPORTED_LANGUAGES,TRANSLATIONS} from '../src/core/translations.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
function makeStore(initial){
  const data=new Map(Object.entries(initial));
  return {data,get length(){return data.size;},key(i){return [...data.keys()][i]||null;},
    removeItem(key){data.delete(key);}};
}
function makeIDB(extra=[]){
  const deleted=[];
  return {deleted,async databases(){return [
    {name:'cluster-v3-plugin-workspace'}, {name:'unrelated-site-db'},
    ...extra.map(name=>({name}))]},
    deleteDatabase(name){
      deleted.push(name);
      const request={};
      queueMicrotask(()=>request.onsuccess?.());
      return request;
    }};
}
test('PRMU reset policy describes Cluster-owned storage only',()=>{
 assert.ok(FULL_RESET_POLICY.databaseNames.length>=3);
 assert.equal(publicRepository.getFullResetUrl(),
   new URL(FULL_RESET_POLICY.route,publicRepository.getPluginSiteUrl()).href);
 assert.ok(FULL_RESET_POLICY.authorizationKey.startsWith('cluster-'));
});
test('reset deletes Cluster data but leaves unrelated same-origin storage',async()=>{
 const storage=makeStore({'cluster.editor.workspace.v2':'text',
   'cluster-v3.public-properties.v1':'settings','other-site-user':'preserve'});
 const session=makeStore({'cluster-v3.cache':'x','other-site-tab':'keep'});
 const db=makeIDB(['cluster-custom-storage']);
 const cacheKeys=['cluster-render-cache','external-cache'];
 const deletedCache=[];
 const caches={async keys(){return cacheKeys;},async delete(k){deletedCache.push(k);return true;}};
 const unregistered=[];
 const url=publicRepository.getFullResetUrl();
 const scope=new URL('./',url).href;
 const serviceWorkers={async getRegistrations(){return [
   {scope,active:{scriptURL:new URL(FULL_RESET_POLICY.serviceWorkerPath,scope).href},
    async unregister(){unregistered.push(scope);return true;}},
   {scope:'https://unrelated.example/',active:{scriptURL:'https://unrelated.example/sw.js'},
    async unregister(){throw Error('Unrelated worker must remain');}}
 ];}};
 const res=await resetClusterData({
   storage,session,db,cacheStorage:caches,serviceWorkers,locationUrl:url
 });
 assert.deepEqual([...storage.data.keys()],['other-site-user']);
 assert.deepEqual([...session.data.keys()],['other-site-tab']);
 assert.deepEqual(deletedCache,['cluster-render-cache']);
 assert.ok(db.deleted.includes('cluster-v3-elog-v1'));
 assert.ok(db.deleted.includes('cluster-v3-plugin-packages-v1'));
 assert.ok(db.deleted.includes('cluster-v3-plugin-workspace'));
 assert.ok(db.deleted.includes('cluster-custom-storage'));
 assert.ok(!db.deleted.includes('unrelated-site-db'));
 assert.equal(unregistered.length,1);
 assert.equal(res.home,publicRepository.getPluginSiteUrl());
});
test('blocked IndexedDB leaves reset in error state',async()=>{
 const db=makeIDB();
 db.deleteDatabase=()=>{const request={};queueMicrotask(()=>request.onblocked?.());return request;};
 await assert.rejects(resetClusterData({
   db,storage:makeStore({'cluster-v3.state':'keep'}),
   session:makeStore({}),cacheStorage:null,serviceWorkers:null,
   locationUrl:publicRepository.getFullResetUrl()
 }),/Close other Cluster tabs/);
});
test('reset is guarded by explicit two-step confirmation and one-time token',()=>{
 const html=read('plugin/index.html');
 const app=read('src/plugin/app.js');
 const reset=read('src/home/reset.js');
 assert.match(html,/id="fullResetAcknowledge"/);
 assert.match(html,/id="fullResetConfirm"[^>]*disabled/);
 assert.match(app,/sessionStorage\.setItem\(repo\.getFullResetPolicy\(\)\.authorizationKey/);
 assert.match(reset,/sessionStorage\.removeItem\(policy\.authorizationKey\)/);
 assert.match(reset,/if\(authorized\)void execute\(\)/);
 assert.doesNotMatch(read('reset.html'),/cluster-v3-plugin-packages-v1/);
});
test('six PRMU languages translate reset controls and failures',()=>{
 for(const [locale] of SUPPORTED_LANGUAGES){
  for(const key of ['resetTitle','resetDescription','resetConfirm',
    'resetWarning','resetBoundary','resetInProgress','resetFailed',
    'resetUnauthorized','resetRetry'])
   assert.equal(typeof TRANSLATIONS[locale][key],'string',locale+' '+key);
 }
});
