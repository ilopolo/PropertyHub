import {getClient,unwrap,sessionRevision,sameSession} from './supabase.js';
import {orgAdminInput} from '../domain/org-admin.js';
const current=version=>{if(!sameSession(version))throw Object.assign(Error('Session changed'),{code:'SESSION_CHANGED'});};
export async function orgAdminDirectory(org){
 const version=sessionRevision(),data=unwrap(await getClient().rpc('org_admin_directory',{org}).retry(false));current(version);
 if(!data||data.organization_id!==org||!Number.isSafeInteger(data.revision)||!Array.isArray(data.members)||!Array.isArray(data.grants)||!Array.isArray(data.history))throw Error('Invalid organization response');
 return data;
}
export async function changeOrgAdmin(input){const version=sessionRevision(),args=orgAdminInput(input),data=unwrap(await getClient().rpc('org_admin_operation',args).retry(false));current(version);if(!data||data.operation!==args.operation||!Number.isSafeInteger(data.revision))throw Error('Unconfirmed organization operation');return data;}
