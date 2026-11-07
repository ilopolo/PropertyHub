import {previewNote} from './financial-preview.js';
const uuid=v=>{if(typeof v!=='string'||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v))throw Error('Избери валидно назначение или членство.');return v;};
export class OrgAdminInputError extends Error{}
export function orgAdminInput(value){
 try{return checkedInput(value);}catch(e){throw new OrgAdminInputError(e.message);}
}
function checkedInput(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['org','operation','role','member','revision','ends','reason','key'].includes(k)))throw Error('Неподдържани данни за назначението.');
 const {org,operation,role=null,member=null,revision,ends=null,reason,key}=value;
 uuid(org);uuid(key);if(!Number.isSafeInteger(revision)||revision<0)throw Error('Обнови организационните назначения.');
 if(!['grant','end','handover'].includes(operation)||(operation==='grant'&&(role!==null||!member))||(operation==='end'&&(!role||member!==null||ends!==null))||(operation==='handover'&&(!role||!member)))throw Error('Избери изрично действие, назначение и получател.');
 if(role!==null)uuid(role);if(member!==null)uuid(member);
 if(ends!==null&&(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(ends)||!Number.isFinite(Date.parse(ends))))throw Error('Посочи точен срок с часова зона или избери безсрочно.');
 const note=previewNote(reason);if([...note].length>300)throw Error('Основанието е до 300 знака.');
 return {org,request_key:key,operation,target_role_id:role,target_membership_id:member,expected_revision:revision,ends_at:ends,reason:note};
}
