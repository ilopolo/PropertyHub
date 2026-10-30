import { getClient, unwrap } from './supabase.js';
export async function listPersons(scope) {
  return unwrap(await getClient().from('persons').select('id,scope_id,person_kind,display_name,contact_email,contact_phone,status,revision,source_kind,source_reference,known_from,field_evidence,recorded_at,verification_status,verified_at,verification_note').eq('scope_id',scope).order('display_name').order('id'));
}
export async function savePerson(scope, person, fields, provenance) {
  return unwrap(await getClient().rpc('save_scoped_person', {scope,target:person?.id || null,expected_revision:person?.revision || 0,...fields,...provenance}));
}
export async function verifyPerson(scope, person, note) {
  return unwrap(await getClient().rpc('verify_scoped_person',{scope,target:person.id,expected_revision:person.revision,note}));
}
