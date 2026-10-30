import {getClient,unwrap} from './supabase.js';
import {registryDate} from '../domain/registry.js';
import {declaredCount} from '../domain/occupancy.js';
export async function readOccupancy(scope,unit,asOf){registryDate(asOf);return unwrap(await getClient().rpc('read_occupancy',{scope,unit,as_of:asOf}));}
export async function applyOccupancy(scope,unit,requestKey,changes,packet){
 for(const change of changes)if(!change.void){declaredCount(change.units);registryDate(change.valid_from);if(change.valid_to)registryDate(change.valid_to);}
 return unwrap(await getClient().rpc('apply_occupancy_changes',{scope,unit,request_key:requestKey,changes,...packet}));
}
export async function reviewOccupancy(scope,unit,target,asOf,note){return unwrap(await getClient().rpc('review_occupancy',{scope,unit,target,as_of:asOf,note}));}
