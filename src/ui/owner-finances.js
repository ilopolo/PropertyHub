import{ownerFinanceBg as bg}from'../i18n/owner-finances-bg.js';
const el=(tag,text='',cls='')=>{const n=document.createElement(tag);n.textContent=text;n.className=cls;return n;};
const money=v=>v===null?'Не е текущо задължение':v.replace('.',',')+' EUR';
const sofia=new Intl.DateTimeFormat('bg-BG',{timeZone:'Europe/Sofia',day:'2-digit',month:'2-digit',year:'numeric'});
const date=v=>v?(v.includes('T')?sofia.format(new Date(v)):v.split('-').reverse().join('.')):'Няма данни';
export function renderOwnerFinances(root,data){
 root.replaceChildren();root.dataset.state=data.items.length?'ready':'empty';
 if(!data.items.length){root.append(el('p',bg.empty,'alert alert-info'));return;}
 const totals=el('p',`Текущо лично начислено: ${money(data.totals.assessed_amount)} · Покрито: ${money(data.totals.covered_amount)} · Неплатен остатък: ${money(data.totals.remaining_amount)}`,'alert alert-info');totals.dataset.ownerTotals='true';root.append(totals);
 for(const x of data.items){const card=el('article','','card card-body mb-3');card.dataset.ownerFinanceItem=x.id;card.dataset.status=x.status;
  card.append(el('h3',`${x.unit_label||'Исторически обект'} · ${bg.states[x.status]}`,'h5'),el('p',`Твоята сума: ${money(x.assessed_amount)} · Разрешено покритие: ${money(x.covered_amount)}`),el('p',`Неплатен остатък: ${money(x.remaining_amount)}`,'fw-bold'),el('p',`Дата на личната отговорност: ${date(x.liability_date)} · Падеж: ${date(x.due_date)}`));
  const detail=el('details');detail.append(el('summary','Покрития и история'),el('p',`Общ размер по обекта: ${money(x.unit_amount)}. Това не е твоя допълнителна лична сума.`,'small'),el('p',`Период от ${date(x.period_start)} до ${date(x.period_end)} (без крайната дата). Публикувано: ${date(x.published_at)}.`,'small'));
  if(x.related_item_id&&data.items.some(y=>y.id===x.related_item_id)){const link=el('a','Свързан твой запис','d-block mb-2');link.href='#owner-finance-'+x.related_item_id;detail.append(link);}card.id='owner-finance-'+x.id;
  if(!x.coverage.length)detail.append(el('p','Няма записани лични покрития.'));
  for(const a of x.coverage)detail.append(el('p',`${bg.bases[a.basis_code]}: ${money(a.amount)} · Дата на отчетеното получаване: ${date(a.payment_date)}${a.compensation_date?' · Компенсация: '+date(a.compensation_date):''} · Записано: ${date(a.recorded_at)}.`));
  card.append(detail);root.append(card);
 }
 root.append(el('p','Историческите заменени и отменящи записи не се добавят към текущия неплатен остатък.','small'));
}
