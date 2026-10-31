import {myOwnedUnits,ownerAccessRecords,confirmOwnerLink,revokeOwnerLink} from '../services/owner-access.js';
import {listPersons} from '../services/persons.js';
import {ownedUnitsList,ownerVerificationForm,ownerLinkRecord} from '../ui/owner-access.js';
import {ownerAccessBg as bg} from '../i18n/owner-access-bg.js';
import {bindForm,message,option} from '../ui/forms.js';
import {authError} from '../i18n/auth-bg.js';
let generation=0,ownedGeneration=0;
export async function refreshOwnedUnits(){
 const root=document.querySelector('#owner-home');if(!root)return;
 const version=++ownedGeneration;root.dataset.ready='false';const list=root.querySelector('ul');list.replaceChildren();
 try{const units=await myOwnedUnits();if(version!==ownedGeneration)return;ownedUnitsList(list,units);root.dataset.count=String(units.length);root.dataset.ready='true';}
 catch(error){if(version===ownedGeneration){message(authError(error),true);root.dataset.ready='error';}}
}
export function initializeOwnedUnits(){
 const signed=document.querySelector('#signed-in'),root=document.createElement('section');root.id='owner-home';root.className='card card-body mt-4';
 const title=document.createElement('h2');title.className='h4';title.textContent=bg.title;const limits=document.createElement('p');limits.textContent=bg.limits;const button=document.createElement('button');button.id='refresh-owned-units';button.className='btn btn-outline-secondary align-self-start mb-3';button.textContent='Обнови собствените имоти';button.addEventListener('click',refreshOwnedUnits);const list=document.createElement('ul');list.id='owned-units';list.className='list-group';root.append(title,limits,button,list);signed.append(root);
 window.addEventListener('focus',()=>{if(!signed.hidden)refreshOwnedUnits();});
}
export function hideOwnerVerification(){generation++;const root=document.querySelector('#owner-verification');if(root){root.hidden=true;root.replaceChildren();}}
export async function showOwnerVerification(scope,account){
 const version=++generation;let root=document.querySelector('#owner-verification');
 if(!root){root=document.createElement('section');root.id='owner-verification';root.className='card card-body mt-4';document.querySelector('#registry').append(root);}
 root.hidden=true;root.replaceChildren();
 const now=Date.now(),allowed=account.roles.some(r=>r.scope_id===scope&&r.role_code==='manager'&&r.permissions.includes('verify_owner_access')&&Date.parse(r.valid_from)<=now&&(!r.valid_to||now<Date.parse(r.valid_to)));
 if(!allowed)return;
 const [persons,links]=await Promise.all([listPersons(scope),ownerAccessRecords(scope)]);if(version!==generation)return;
 root.hidden=false;root.innerHTML=ownerVerificationForm();const select=root.querySelector('#owner-person');const eligible=persons.filter(p=>p.status==='active'&&p.verification_status==='verified');
 option(select,'','Избери конкретно проверено лице');for(const p of eligible)option(select,p.id,`${p.display_name} · ${p.id.slice(0,8)}`);
 let requestKey=crypto.randomUUID();
 bindForm('#confirm-owner-link',async data=>{const person=eligible.find(p=>p.id===String(data.get('person')));if(!person)throw Error('Избери проверено лице.');await confirmOwnerLink(scope,String(data.get('target')).trim(),person,String(data.get('evidence')).trim(),String(data.get('note')).trim(),requestKey);requestKey=crypto.randomUUID();if(version===generation){await showOwnerVerification(scope,account);message('Проверената връзка е записана. Не са предоставени служебни права.');}});
 const list=root.querySelector('#owner-links');for(const link of links)list.append(ownerLinkRecord(link,async(evidence,note)=>{try{await revokeOwnerLink(scope,link.id,evidence,note);if(version===generation){await showOwnerVerification(scope,account);message('Достъпът от тази връзка е оттеглен за следващата заявка.');}}catch(error){message(authError(error),true);}}));if(!links.length)list.textContent='Няма записани проверки за този обхват.';
 root.dataset.ready='true';
}
