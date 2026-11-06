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
  const csvRole={csv_prepare:['manager',['read_registry','prepare_registry_import']],csv_commit:['manager',['read_registry','manage_registry','commit_registry_import']],csv_import:['manager',['read_registry','manage_registry','prepare_registry_import','commit_registry_import']],csv_import_export:['manager',['read_registry','manage_registry','prepare_registry_import','commit_registry_import','export_registry']],csv_export_manager:['manager',['read_registry','export_registry']],csv_export_controller:['controller',['read_registry','export_registry']]}[role];
  if(csvRole)return unwrap(await getClient().rpc('assign_staff_role',{org,target_auth_user_id:authId,scope,role:csvRole[0],permissions:csvRole[1]}).retry(false));
  const expenseRole={expense_manager:['manager',['record_expenses']],expense_cashier:['cashier',['record_expenses']],expense_reader_manager:['manager',['read_expenses']],expense_reader_cashier:['cashier',['read_expenses']],expense_reader_controller:['controller',['read_expenses']],expense_corrector_manager:['manager',['record_expenses','correct_finance']],expense_corrector_cashier:['cashier',['record_expenses','correct_finance']]}[role];
  if(expenseRole)return unwrap(await getClient().rpc('assign_staff_role',{org,target_auth_user_id:authId,scope,role:expenseRole[0],permissions:expenseRole[1]}).retry(false));
  const fundRole={fund_manager:['manager','manage_funds'],fund_cashier:['cashier','manage_funds'],fund_reader_manager:['manager','read_funds'],fund_reader_cashier:['cashier','read_funds'],fund_reader_controller:['controller','read_funds']}[role];
  if(fundRole)return unwrap(await getClient().rpc('assign_staff_role',{org,target_auth_user_id:authId,scope,role:fundRole[0],permissions:[fundRole[1]]}).retry(false));
  const accountRole = {cash_account_manager:'manager',cash_account_cashier:'cashier'}[role];
  if(accountRole)return unwrap(await getClient().rpc('assign_staff_role',{org,target_auth_user_id:authId,scope,role:accountRole,permissions:['manage_cash_accounts']}).retry(false));
  const documents = role === 'document_manager';
  const tickets = role === 'ticket_manager';
  return unwrap(await getClient().rpc('assign_staff_role', { org, target_auth_user_id: authId, scope, role:documents||tickets?'manager':role, permissions: tickets?['manage_tickets']:documents?['read_registry','manage_documents']:role === 'manager' ? ['read_registry', 'manage_registry'] : ['read_registry'] }));
}
export async function revokeStaff(roleId) { return unwrap(await getClient().rpc('revoke_staff_role', { role_id: roleId })); }
