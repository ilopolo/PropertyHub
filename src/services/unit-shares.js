import {getClient,unwrap} from './supabase.js';
import {unitSharePacket,shareReason} from '../domain/unit-share-records.js';
import {registryDate} from '../domain/registry.js';
export const unitShareFeed=async scope=>unwrap(await getClient().rpc('unit_share_feed',{scope}));
export async function saveUnitShareSet(scope,record,payload,note,requestKey){return unwrap(await getClient().rpc('save_unit_share_set',{scope,target:record?.id??null,expected_revision:record?.revision??0,request_key:requestKey,payload:unitSharePacket(payload),note:shareReason(note)}));}
export async function verifyUnitShareSet(scope,version,payload){return unwrap(await getClient().rpc('verify_unit_share_set',{scope,version_id:version.id,expected_revision:version.revision,as_of:registryDate(payload.as_of),basis_reference:shareReason(payload.basis_reference),participants_reference:shareReason(payload.participants_reference),row_ids:payload.row_ids,note:shareReason(payload.note)}));}
export const unitShareVersionAt=async(scope,versionId,date)=>unwrap(await getClient().rpc('unit_share_version_at',{scope,version_id:versionId,at_date:registryDate(date)}));
