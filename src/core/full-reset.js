/** Host-owned cleanup: limit deletion to registered Cluster namespaces.
 * Runs in a standalone top-level document, after plugin frames are unloaded. */
import { publicRepository as repo } from './public-repository.js';

const belongsToCluster = (name, prefixes) =>
  typeof name === 'string' && prefixes.some(prefix => name.startsWith(prefix));

function removeScopedStorage(store, prefixes) {
  if (!store) return 0;
  let removed=0;
  const keys=[];
  for(let i=0;i<store.length;i++)keys.push(store.key(i));
  for(const key of keys){
    if(belongsToCluster(key,prefixes)){
      store.removeItem(key);
      removed++;
    }
  }
  return removed;
}
function deleteDatabase(name, factory, timeoutMs=6000){
  return new Promise((resolve,reject)=>{
    let request,completed=false;
    const timeout=setTimeout(()=>{
      if(!completed){completed=true;reject(Error('Database blocked: '+name));}
    },timeoutMs);
    const settle=(error)=>{
      if(completed)return;
      completed=true;clearTimeout(timeout);
      if(error)reject(error);else resolve();
    };
    try{
      request=factory.deleteDatabase(name);
      request.onsuccess=()=>settle();
      request.onerror=()=>settle(request.error || Error('Database error: '+name));
      request.onblocked=()=>settle(Error('Close other Cluster tabs: '+name));
    }catch(error){settle(error);}
  });
}
export async function resetClusterData({
  storage=globalThis.localStorage,
  session=globalThis.sessionStorage,
  db=globalThis.indexedDB,
  cacheStorage=globalThis.caches,
  serviceWorkers=globalThis.navigator?.serviceWorker,
  policy=repo.getFullResetPolicy(),
  locationUrl=globalThis.location?.href
}={}){
  // Never delete unrelated GitHub Pages repositories sharing the same origin.
  const names=new Set(policy.databaseNames);
  if(db?.databases){
    const known=await db.databases();
    for(const entry of known){
      if(belongsToCluster(entry.name,policy.databasePrefixes))
        names.add(entry.name);
    }
  }
  const root = new URL(repo.getFullResetUrl());
  const origin = locationUrl ? new URL(locationUrl).origin : root.origin;
  if(origin!==root.origin)throw Error('Reset origin mismatch');
  const swPath=new URL(policy.serviceWorkerPath,new URL('./',root)).pathname;
  if(serviceWorkers?.getRegistrations){
    for(const registration of await serviceWorkers.getRegistrations()){
      if(new URL(registration.scope).pathname.startsWith(
          new URL('./',root).pathname) &&
          registration.active?.scriptURL &&
          new URL(registration.active.scriptURL).pathname===swPath){
        if(!(await registration.unregister()))
          throw Error('Unable to unregister Cluster service worker');
      }
    }
  }
  for(const name of names){
    if(!db)throw Error('IndexedDB unavailable: '+name);
    await deleteDatabase(name,db);
  }
  if(cacheStorage?.keys){
    for(const key of await cacheStorage.keys()){
      if(belongsToCluster(key,policy.cachePrefixes)){
        if(!(await cacheStorage.delete(key)))
          throw Error('Cache deletion failed: '+key);
      }
    }
  }
  removeScopedStorage(storage,policy.localStoragePrefixes);
  removeScopedStorage(session,policy.sessionStoragePrefixes);
  return {databases:names.size,home:new URL('./',root).href};
}
