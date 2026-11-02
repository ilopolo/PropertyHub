import {getClient,unwrap} from './supabase.js';
import {previewSelection,previewNote} from '../domain/financial-preview.js';
export const financialPreviewFeed=async()=>unwrap(await getClient().rpc('financial_preview_feed'));
export const loadFinancialPreviewInputs=async(scope,payload)=>unwrap(await getClient().rpc('load_financial_preview_inputs',{scope,payload:previewSelection(payload)}));
export const createFinancialPreview=async(scope,payload,expectedToken,requestKey,note)=>unwrap(await getClient().rpc('create_financial_preview',{scope,payload:previewSelection(payload),expected_token:expectedToken,request_key:requestKey,note:previewNote(note)}));
