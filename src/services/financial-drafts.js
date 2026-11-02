import {getClient,unwrap} from './supabase.js';
import {resolutionDraft,financialRuleDraft,changeReason} from '../domain/financial-drafts.js';
export const financialDraftFeed=async()=>unwrap(await getClient().rpc('financial_draft_feed'));
export async function saveFinancialResolution(scope,record,payload,note){return unwrap(await getClient().rpc('save_financial_resolution',{scope,target:record?.id??null,expected_revision:record?.revision??0,payload:resolutionDraft(payload),note:changeReason(note)}));}
export async function saveFinancialRule(scope,record,payload,note){return unwrap(await getClient().rpc('save_financial_rule',{scope,target:record?.id??null,expected_revision:record?.revision??0,payload:financialRuleDraft(payload),note:changeReason(note)}));}
