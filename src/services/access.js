import { getClient, unwrap } from './supabase.js';

const requestColumns = 'id,requester_profile_id,request_kind,status,request_payload,organization_id,revision,created_at';
export async function listRequests() { return unwrap(await getClient().from('access_requests').select(requestColumns).order('created_at', { ascending: false })); }
export async function requestOrganization(profileId, name, kind) {
  return unwrap(await getClient().from('access_requests').insert({ request_kind: 'organization_onboarding', requester_profile_id: profileId, request_payload: { name, organization_kind: kind } }).select(requestColumns).single());
}
export async function activateOrganization(requestId) { return unwrap(await getClient().rpc('activate_organization', { request_id: requestId })); }
export async function createContext(org, address, label, entranceCode) {
  return unwrap(await getClient().rpc('create_management_context', { org, address, label, entrance_code: entranceCode || null }));
}
export async function assignStaff(org, authId, scope, role) {
  return unwrap(await getClient().rpc('assign_staff_role', { org, target_auth_user_id: authId, scope, role, permissions: role === 'manager' ? ['read_registry', 'manage_registry'] : ['read_registry'] }));
}
export async function revokeStaff(roleId) { return unwrap(await getClient().rpc('revoke_staff_role', { role_id: roleId })); }
