import { getClient, unwrap } from './supabase.js';

const requestColumns = 'id,requester_profile_id,request_kind,status,request_payload,organization_id,revision,created_at,review_note,reviewed_at';
export async function listRequests() { return unwrap(await getClient().from('access_requests').select(requestColumns).order('created_at', { ascending: false })); }
export async function requestOrganization(profileId, name, kind) {
  return unwrap(await getClient().from('access_requests').insert({ request_kind: 'organization_onboarding', requester_profile_id: profileId, request_payload: { name, organization_kind: kind } }).select(requestColumns).single());
}
export async function activateOrganization(request, note) { return unwrap(await getClient().rpc('activate_organization', { request_id: request.id, expected_revision: request.revision, review_note: note })); }
export async function reviseRequest(request, name, kind) { return unwrap(await getClient().rpc('revise_organization_request', { request_id: request.id, expected_revision: request.revision, name, organization_kind: kind })); }
export async function closeRequest(request, decision, note) { return unwrap(await getClient().rpc('close_organization_request', { request_id: request.id, expected_revision: request.revision, decision, note })); }
export async function requestScopeSetup(org, target, label) { return unwrap(await getClient().rpc('request_scope_setup', { org, target_auth_user_id: target, label })); }
export async function listScopeSetups() { return unwrap(await getClient().from('scope_setup_requests').select('id,organization_id,target_profile_id,label,status,expires_at,scope_id,revision').order('created_at', { ascending: false })); }
export async function revokeScopeSetup(request) { return unwrap(await getClient().rpc('revoke_scope_setup', { request_id: request.id, expected_revision: request.revision })); }
export async function completeScopeSetup(requestId, address, entrance, provenance) { return unwrap(await getClient().rpc('complete_scope_setup', { request_id: requestId, address, entrance_code: entrance || null, ...provenance })); }
export async function organizationStaff(org) { return unwrap(await getClient().rpc('organization_staff', { org })); }
export async function assignStaff(org, authId, scope, role) {
  const documents = role === 'document_manager';
  const tickets = role === 'ticket_manager';
  return unwrap(await getClient().rpc('assign_staff_role', { org, target_auth_user_id: authId, scope, role:documents||tickets?'manager':role, permissions: tickets?['manage_tickets']:documents?['read_registry','manage_documents']:role === 'manager' ? ['read_registry', 'manage_registry'] : ['read_registry'] }));
}
export async function revokeStaff(roleId) { return unwrap(await getClient().rpc('revoke_staff_role', { role_id: roleId })); }
