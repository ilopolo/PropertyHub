import {getClient,unwrap} from './supabase.js';
export async function myOwnedUnits(){return unwrap(await getClient().rpc('my_owned_units'));}
export async function ownerAccessRecords(scope){return unwrap(await getClient().rpc('owner_access_records',{scope}));}
export async function setOwnerVerifier(roleId,enabled,note){return unwrap(await getClient().rpc('set_owner_verifier',{role_id:roleId,enabled,note}));}
export async function confirmOwnerLink(scope,target,person,evidence,note,requestKey){return unwrap(await getClient().rpc('confirm_owner_link',{scope,target_auth_user_id:target,person:person.id,expected_person_revision:person.revision,evidence,note,request_key:requestKey}));}
export async function revokeOwnerLink(scope,id,evidence,note){return unwrap(await getClient().rpc('revoke_owner_link',{scope,link_id:id,evidence,note}));}
