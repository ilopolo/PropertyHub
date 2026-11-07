import './main.js';
import {loadAccount} from '../services/auth.js';
import {financialDraftFeed,saveFinancialResolution,saveFinancialRule,saveFinancialBasisEvidence,reviewFinancialBasis} from '../services/financial-drafts.js';
import {saveFinancialApplicability,activateFinancialRule} from '../services/financial-activation.js';
import {renderFinancialDrafts} from '../ui/financial-drafts.js';
import {message} from '../ui/forms.js';
import {refreshFinancialPreview} from './financial-preview.js';
import {refreshChargeBatches} from './financial-publish.js';
import {refreshManualPayments} from './manual-payments.js';
import {refreshCashAccounts} from './cash-accounts.js';
import {refreshFunds} from './funds.js';
import {refreshExpenses} from './expenses.js';
import {refreshMonthlyManagement} from './monthly-management.js';
import {financeState} from '../ui/finance-help.js';
const root=document.querySelector('#finance-drafts');
async function refresh(){
 root.dataset.ready='false';root.dataset.state='loading';root.textContent='Зареждане на основанията и правилата…';
 for(const id of ['financial-preview','financial-publish','manual-payments','cash-accounts','funds','expenses','monthly-management','monthly-publication']){const section=document.getElementById(id);section.replaceChildren();section.dataset.state='loading';section.textContent='Зареждане…';}
 if(!await loadAccount()){root.replaceChildren();financeState(root,'signed-out','Влез с потвърден акаунт. Подготовката и прегледът изискват отделни финансови права.');for(const id of ['financial-preview','financial-publish','manual-payments','cash-accounts','funds','expenses','monthly-management','monthly-publication'])document.getElementById(id).replaceChildren();root.dataset.ready='true';return;}
 try{const data=await financialDraftFeed();
 data.catalog=data.catalog.filter(c=>c.code!=='monthly_management_equal');data.resolutions=data.resolutions.filter(r=>r.resolution_type!=='monthly_management_equal');data.rules=data.rules.filter(r=>r.method!=='equal_units');
 renderFinancialDrafts(root,data,async(kind,scope,record,payload,note)=>{await({resolution:saveFinancialResolution,rule:saveFinancialRule,evidence:saveFinancialBasisEvidence,review:reviewFinancialBasis,applicability:saveFinancialApplicability,activate:activateFinancialRule}[kind])(scope,record,payload,note);await refresh();message('Промяната и причината са записани в историята.');});}
 catch(error){root.replaceChildren();financeState(root,error.code==='42501'?'no-access':'error',error.code==='42501'?'Нямаш достъп до финансовите основания.':'Основанията не са заредени поради техническа грешка. Натисни „Обнови“.');}
 await Promise.all([refreshFinancialPreview(),refreshChargeBatches(),refreshManualPayments(),refreshCashAccounts(),refreshFunds(),refreshExpenses(),refreshMonthlyManagement()]);root.dataset.ready='true';
}
const failed=error=>{for(const section of [root,document.getElementById('financial-preview'),document.getElementById('financial-publish'),document.getElementById('manual-payments'),document.getElementById('cash-accounts'),document.getElementById('funds'),document.getElementById('expenses'),document.getElementById('monthly-management'),document.getElementById('monthly-publication')]){section.replaceChildren();financeState(section,error.code==='42501'?'no-access':'error',error.code==='42501'?'Нямаш текущ финансов достъп.':'Финансовите данни не са заредени поради техническа грешка. Натисни „Обнови“.');section.dataset.ready='true';}};
document.querySelector('#refresh-finance').addEventListener('click',()=>refresh().catch(failed));
refresh().catch(failed);
