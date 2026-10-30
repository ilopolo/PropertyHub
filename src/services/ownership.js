import {getClient,unwrap} from './supabase.js';
import {registryDate} from '../domain/registry.js';
import {fractionUnits} from '../domain/ownership.js';
export async function readOwnership(scope,unit,asOf) {
  registryDate(asOf);return unwrap(await getClient().rpc('read_ownership',{scope,unit,as_of:asOf}));
}
export async function applyOwnership(scope,unit,requestKey,changes,packet) {
  for(const change of changes)if(!change.void){fractionUnits(change.fraction);registryDate(change.valid_from);if(change.valid_to)registryDate(change.valid_to);}
  return unwrap(await getClient().rpc('apply_ownership_changes',{scope,unit,request_key:requestKey,changes,...packet}));
}
export async function reviewOwnership(scope,unit,target,asOf,note) {
  return unwrap(await getClient().rpc('review_ownership',{scope,unit,target,as_of:asOf,note}));
}
