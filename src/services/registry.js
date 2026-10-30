import { getClient, unwrap } from './supabase.js';
import { registryDate, registryToday } from '../domain/registry.js';

export async function listUnits(scope, asOf = registryToday()) {
  registryDate(asOf);
  const periods = unwrap(await getClient().from('unit_scope_periods').select('unit_id,valid_from,valid_to,source_kind,source_reference,known_from,verification_status').eq('scope_id', scope).lte('valid_from', asOf).or(`valid_to.is.null,valid_to.gt.${asOf}`));
  if (!periods.length) return [];
  const units = unwrap(await getClient().from('units').select('id,unit_number,unit_type,floor,area,source_kind,source_reference,known_from,verification_status,recorded_at,verified_at,verification_note').in('id', periods.map(p => p.unit_id)).order('unit_number'));
  return units.map(unit => ({ ...unit, scope_period: periods.find(period => period.unit_id === unit.id) }));
}
export async function createUnit(scope, number, type, floor, area, provenance) {
  return unwrap(await getClient().rpc('create_unit', { scope, unit_number: number, unit_type: type, floor: floor || null, area: area || null, ...provenance }));
}
export async function verifyRegistryRecord(scope, kind, target, note) { return unwrap(await getClient().rpc('verify_registry_record', { scope, kind, target, note })); }
