import {getClient,unwrap} from './supabase.js';
import {resolutionDraft,financialRuleDraft,changeReason} from '../domain/financial-drafts.js';
import {financialEvidenceDraft} from '../domain/financial-evidence.js';
export const financialDraftFeed=async()=>unwrap(await getClient().rpc('financial_draft_feed'));
export async function saveFinancialResolution(scope,record,payload,note){return unwrap(await getClient().rpc('save_financial_resolution',{scope,target:record?.id??null,expected_revision:record?.revision??0,payload:resolutionDraft(payload),note:changeReason(note)}));}
export async function saveFinancialRule(scope,record,payload,note){return unwrap(await getClient().rpc('save_financial_rule',{scope,target:record?.id??null,expected_revision:record?.revision??0,payload:financialRuleDraft(payload),note:changeReason(note)}));}
export async function saveFinancialBasisEvidence(scope,record,payload,note){if(!record)throw Error('Избери основание.');return unwrap(await getClient().rpc('save_financial_basis_evidence',{scope,target:record.id,expected_revision:record.revision,payload:financialEvidenceDraft(payload,record),note:changeReason(note)}));}
export async function reviewFinancialBasis(scope,record,payload,note){if(!record||!['reviewed','changes_requested'].includes(payload?.outcome)||Object.keys(payload).some(k=>k!=='outcome'))throw Error('Избери конкретен резултат от прегледа.');return unwrap(await getClient().rpc('review_financial_basis',{scope,target:record.id,expected_revision:record.revision,outcome:payload.outcome,note:changeReason(note)}));}
