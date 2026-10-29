import { getClient, unwrap } from './supabase.js';

export async function listUnits(scope) {
  const periods = unwrap(await getClient().from('unit_scope_periods').select('unit_id').eq('scope_id', scope));
  if (!periods.length) return [];
  return unwrap(await getClient().from('units').select('id,unit_number,unit_type,floor,area').in('id', periods.map(p => p.unit_id)).order('unit_number'));
}
export async function createUnit(scope, number, type, floor, area) {
  return unwrap(await getClient().rpc('create_unit', { scope, unit_number: number, unit_type: type, floor: floor || null, area: area || null }));
}
