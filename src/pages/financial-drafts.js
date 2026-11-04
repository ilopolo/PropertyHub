import './main.js';
import {loadAccount} from '../services/auth.js';
import {financialDraftFeed,saveFinancialResolution,saveFinancialRule,saveFinancialBasisEvidence,reviewFinancialBasis} from '../services/financial-drafts.js';
import {saveFinancialApplicability,activateFinancialRule} from '../services/financial-activation.js';
import {renderFinancialDrafts} from '../ui/financial-drafts.js';
import {message} from '../ui/forms.js';
import {refreshFinancialPreview} from './financial-preview.js';
import {refreshChargeBatches} from './financial-publish.js';
import {refreshManualPayments} from './manual-payments.js';
import {financeState} from '../ui/finance-help.js';
const root=document.querySelector('#finance-drafts');
async function refresh(){
 root.dataset.ready='false';root.dataset.state='loading';root.textContent='Зареждане на основанията и правилата…';
 for(const id of ['financial-preview','financial-publish','manual-payments']){const section=document.getElementById(id);section.replaceChildren();section.dataset.state='loading';section.textContent='Зареждане…';}
 if(!await loadAccount()){root.replaceChildren();financeState(root,'signed-out','Влез с потвърден акаунт. Подготовката и прегледът изискват отделни финансови права.');for(const id of ['financial-preview','financial-publish','manual-payments'])document.getElementById(id).replaceChildren();root.dataset.ready='true';return;}
 try{const data=await financialDraftFeed();
 renderFinancialDrafts(root,data,async(kind,scope,record,payload,note)=>{await({resolution:saveFinancialResolution,rule:saveFinancialRule,evidence:saveFinancialBasisEvidence,review:reviewFinancialBasis,applicability:saveFinancialApplicability,activate:activateFinancialRule}[kind])(scope,record,payload,note);await refresh();message('Промяната и причината са записани в историята.');});}
 catch(error){root.replaceChildren();financeState(root,error.code==='42501'?'no-access':'error',error.code==='42501'?'Нямаш достъп до финансовите основания.':'Основанията не са заредени поради техническа грешка. Натисни „Обнови“.');}
 await Promise.all([refreshFinancialPreview(),refreshChargeBatches(),refreshManualPayments()]);root.dataset.ready='true';
}
const failed=error=>{for(const section of [root,document.getElementById('financial-preview'),document.getElementById('financial-publish'),document.getElementById('manual-payments')]){section.replaceChildren();financeState(section,error.code==='42501'?'no-access':'error',error.code==='42501'?'Нямаш текущ финансов достъп.':'Финансовите данни не са заредени поради техническа грешка. Натисни „Обнови“.');section.dataset.ready='true';}};
document.querySelector('#refresh-finance').addEventListener('click',()=>refresh().catch(failed));
refresh().catch(failed);
