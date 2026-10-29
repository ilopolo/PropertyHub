import { loadAccount } from './auth.js';
import { getClient, unwrap } from './supabase.js';

export async function loadAdministration() {
  const account = await loadAccount();
  if (!account) return null;
  const now = Date.now();
  const current = r => Date.parse(r.valid_from) <= now && (!r.valid_to || now < Date.parse(r.valid_to));
  const roles = account.roles.filter(current);
  const platform = account.profile.status === 'active' && roles.some(r => r.role_code === 'platform_admin' && r.permissions.includes('manage_platform'));
  const memberships = unwrap(await getClient().from('organization_memberships').select('id,organization_id,status,valid_from,valid_to').eq('profile_id', account.profile.id));
  const orgIds = memberships.filter(m => m.status === 'active' && current(m) && roles.some(r => r.role_code === 'org_admin' && r.membership_id === m.id && r.permissions.includes('manage_members'))).map(m => m.organization_id);
  return { ...account, platform, adminOrganizations: account.profile.status === 'active' ? account.organizations.filter(o => o.status === 'active' && orgIds.includes(o.id)) : [] };
}
