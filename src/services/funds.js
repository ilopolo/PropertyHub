import {getClient,unwrap} from './supabase.js';
import {fundPayload,fundLines,fundNote,fundFeedData} from '../domain/funds.js';
const rpc=async(name,args)=>unwrap(await getClient().rpc(name,args).retry(false));
export const fundFeed=async()=>fundFeedData(await rpc('fund_feed'));
export const saveFund=(scope,target,revision,key,payload,note)=>rpc('save_fund',{scope,target,expected_revision:revision,request_key:key,payload:fundPayload(payload,target===null),note:fundNote(note)});
export const deactivateFund=(scope,target,revision,key,note)=>rpc('deactivate_fund',{scope,target,expected_revision:revision,request_key:key,note:fundNote(note)});
export const classifyFundMovement=(scope,movement,revision,key,lines,note)=>rpc('classify_fund_movement',{scope,movement,expected_revision:revision,request_key:key,lines:fundLines(lines),note:fundNote(note)});
