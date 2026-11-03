import {getClient,unwrap} from './supabase.js';
import {chargeClaim,chargePartyReview} from '../domain/financial-publish.js';
import {previewNote} from '../domain/financial-preview.js';
// Financial operations have explicit receipts. Never retry a conflict or silently refresh the approved inputs.
const rpc=async(name,args)=>unwrap(await getClient().rpc(name,args).retry(false));
export const chargeBatchFeed=()=>rpc('charge_batch_feed');
export const loadChargeBatchInputs=(scope,payload)=>rpc('load_charge_batch_inputs',{scope,payload:chargeClaim(payload)});
export const saveChargeBatch=(scope,target,revision,key,payload,note)=>rpc('save_charge_batch',{scope,target,expected_revision:revision,request_key:key,payload:chargeClaim(payload),note:previewNote(note)});
export const reviewChargeBatch=(scope,target,revision,key,parties,note)=>rpc('review_charge_batch',{scope,target,expected_revision:revision,request_key:key,acknowledged_parties:chargePartyReview(parties),note:previewNote(note)});
export const publishChargeBatch=(scope,target,revision,key,note)=>rpc('publish_charge_batch',{scope,target,expected_revision:revision,request_key:key,note:previewNote(note)});
