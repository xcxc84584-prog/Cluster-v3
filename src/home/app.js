/** Cluster root — PRMU is the only authority for locale/palette and URLs. */
import { publicRepository as repo, applyPalette } from "../core/public-repository.js";
import { translate } from "../core/translations.js";
import { createPackageStore } from "../plugin/package-store.js";

const $ = id => document.getElementById(id);
const home = $("home");
const workspace = $("homeWorkspace");
const splash = $("homeBoot");
const status = $("homeStatus");
const language = $("homeLanguage");
let initializing = false;
let mounted = false;
const t = key => translate(repo.getLanguage(),key);

function localize() {
  document.documentElement.lang=repo.getLanguage();
  language.value=repo.getLanguage();
  for (const node of document.querySelectorAll("[data-i18n]"))
    node.textContent=t(node.dataset.i18n);
  language.setAttribute("aria-label",t("homeLanguage"));
  $("homeManager").href=repo.getPluginManagerUrl();
}
function syncPalette() {
  applyPalette(repo.getPalette());
}
function showStatus(message,error=false) {
  status.dataset.error=String(error);
  status.textContent=message;
}
function showWelcome() {
  splash.hidden=true;
  home.hidden=false;
  workspace.hidden=true;
}
function showWorkspace() {
  mounted=true;
  // The Plugin Manager iframe loads offscreen until its workspace is ready.
  // Keeping the splash prevents intermediate Manager chrome from flashing.
  splash.hidden=false;
  home.hidden=true;
  workspace.hidden=true;
  const url=new URL(repo.getPluginManagerUrl());
  const plugin=new URLSearchParams(location.search).get("plugin");
  if(plugin)url.searchParams.set("plugin",plugin);
  else url.searchParams.set("view","home");
  workspace.src=url.href;
}
function loadInitializer() {
  const url=new URL(repo.getPluginManagerUrl());
  url.searchParams.set("initialize","1");
  workspace.hidden=true;
  workspace.src=url.href;
}
repo.subscribe(({type})=>{
  if(type==="language"||type==="sync")localize();
  if(type==="palette"||type==="sync")syncPalette();
});
language.addEventListener("change",event=>{
  repo.setLanguage(event.target.value);
});
$("homeInitialize").addEventListener("click",()=>{
  if(initializing)return;
  initializing=true;
  $("homeInitialize").disabled=true;
  showStatus(t("homeInitializing"));
  loadInitializer();
});
window.addEventListener("message",event=>{
  if(event.origin!==location.origin || event.source!==workspace.contentWindow ||
     event.data?.protocol!=="cluster.home.v1")return;
  if(event.data.type==="initialized"){
    showStatus(t("homeLoading"));
    showWorkspace();
  }else if(event.data.type==="workspace-ready"){
    if(!mounted)return;
    workspace.hidden=false;
    splash.hidden=true;
  }else if(event.data.type==="error"){
    initializing=false;
    $("homeInitialize").disabled=false;
    showStatus(t("homeInitializeFailed")+String(event.data.message||""),true);
  }
});
async function bootstrap(){
  localize();
  syncPalette();
  try{
    const records=await createPackageStore().list();
    if(records.length)showWorkspace();
    else showWelcome();
  }catch(error){
    showWelcome();
    showStatus(t("homeInitializeFailed")+String(error?.message||error),true);
    $("homeInitialize").disabled=true;
  }
}
void bootstrap();
