import {csvColumns,csvRowError} from '../i18n/registry-csv-bg.js';
const node=(tag,text='',cls='')=>{const n=document.createElement(tag);n.textContent=text;n.className=cls;return n;};
export function downloadCsv(text,name){const url=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export function csvView(root){
 const state=root.querySelector('[data-csv-state]'),preview=root.querySelector('[data-csv-preview]'),confirm=root.querySelector('#csv-confirm'),stage=root.querySelector('#csv-stage'),exportButton=root.querySelector('#csv-export'),file=root.querySelector('#csv-file'),accepted=root.querySelector('#csv-accepted');
 const view={file,accepted,confirm,stage,exportButton,preview};
 view.message=(text,kind='ready')=>{state.textContent=text;state.dataset.state=kind;root.dataset.state=kind;};
 view.context=c=>{file.disabled=!c?.can_prepare;stage.disabled=true;exportButton.disabled=!c?.can_export;confirm.disabled=true;};
 view.clear=()=>{preview.replaceChildren();accepted.checked=false;accepted.disabled=true;confirm.disabled=true;};
 view.job=(job,canCommit)=>{view.clear();preview.append(node('h2','Преглед на импорта','h4'));if(job.status==='committed'){view.result(job.result);return;}
  preview.append(node('p','Таблицата се превърта хоризонтално, за да останат четими всички колони.','small'));
  const table=node('table','','table table-striped align-middle'),wrap=node('div','','table-responsive'),head=node('thead'),tr=node('tr');table.style.minWidth='80rem';wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label','Преглед на CSV редовете — хоризонтално превъртане');for(const t of ['Запис',...Object.values(csvColumns).slice(0,9),'Резултат']){const th=node('th',t);th.scope='col';th.style.whiteSpace='nowrap';tr.append(th);}head.append(tr);table.append(head);const body=node('tbody');
  for(const row of job.rows){const line=node('tr');line.dataset.csvRow=row.row_number;line.append(node('td',row.row_number));for(const key of Object.keys(csvColumns).slice(0,9)){const cell=node('td',row.values?.[key]??'');cell.style.minWidth=key==='source_reference'?'15rem':'8rem';cell.style.whiteSpace='pre-line';cell.style.wordBreak='normal';line.append(cell);}const cell=node('td');if(row.errors.length){const list=node('ul');for(const error of row.errors)list.append(node('li',csvRowError(error)));cell.append(list);}else cell.textContent=row.outcome==='create'?'Нов обект':'Без промяна';line.append(cell);body.append(line);}table.append(body);wrap.append(table);preview.append(wrap);
  const ready=job.status==='ready'&&Date.parse(job.expires_at)>Date.now();preview.dataset.state=ready?'ready':'invalid';preview.append(node('p',ready?'Всички редове са проверени. Потвърждението записва целия набор или нищо.':'Няма записани обекти от този преглед. Поправи файла или подготви нов преглед.','alert '+(ready?'alert-info':'alert-warning')));accepted.disabled=!ready||!canCommit;
  accepted.onchange=()=>{confirm.disabled=!(ready&&canCommit&&accepted.checked);};
 };
 view.result=r=>{view.clear();preview.dataset.state='committed';preview.append(node('h2','Потвърден резултат','h4'),node('p',`Нови обекти: ${r.created}. Без промяна: ${r.unchanged}. Общо: ${r.total}.`,'alert alert-success'),node('p','Записите изискват отделна проверка на регистъра. Импортът не доказва пълнота, собственост или финансова готовност.'));};
 return view;
}
