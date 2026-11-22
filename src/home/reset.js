import {publicRepository as repo,applyPalette} from '../core/public-repository.js';
import {translate} from '../core/translations.js';
import {resetClusterData} from '../core/full-reset.js';

const progress=document.getElementById('resetProgress');
const retry=document.getElementById('resetRetry');
const t=key=>translate(repo.getLanguage(),key);
document.documentElement.lang=repo.getLanguage();
applyPalette(repo.getPalette());
retry.textContent=t('resetRetry');
async function execute(){
  retry.hidden=true;
  progress.textContent=t('resetInProgress');
  try{
    const result=await resetClusterData();
    progress.textContent=t('resetFinished');
    // Successful reset returns to a fresh uninitialized Cluster root.
    location.replace(result.home);
  }catch(error){
    progress.textContent=t('resetFailed')+' '+String(error?.message||error);
    retry.hidden=false;
  }
}
retry.addEventListener('click',()=>void execute());
void execute();
