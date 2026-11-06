import {createHash} from 'node:crypto';
import {financialDraftFixture,resolutionPayload} from './financial-draft-fixture.mjs';
import {evidenceSchema} from '../../src/domain/financial-evidence.js';
export {resolutionPayload};
export const completeEvidence=unit=>({...evidenceSchema,record_kind:'synthetic',unit_ids:[unit],participants_reference:'Synthetic full roster reference; not a legal completeness attestation',
 works_description:'Synthetic planned common-parts repair',works_classification:'Synthetic technical classification for contract tests only',classification_reference:'Synthetic technical report v1',
 evidence_reference:'Synthetic packet v1: protocol, agenda, notices, attendance, proxies, votes, corrections/disputes index',evidence_sha256:createHash('sha256').update('Synthetic financial evidence packet v1').digest('hex'),
 legal_reference:'ZUES48(1),(3); applicable assembly provisions require actual review',legal_version:'Official text through DV49/17.06.2025; synthetic case, not legal validation',majority_reference:'Synthetic motivated quorum/vote applicability record',
 approved_cost:'800.00',reported_available:'1000.00',authorized_use:'300.00',target_collection:'500.00',funds_as_of:'2026-10-01',funds_reference:'Synthetic reported balance source; no ledger verification',use_reference:'Synthetic protocol point authorizes only300',collection_reference:'Synthetic protocol point authorizes500',liability_reference:'Synthetic owner/date/liability reference; no debt created',due_on:'2026-11-15'});
export async function financialEvidenceFixture(){const f=await financialDraftFixture();try{
 await f.as('orgA','select public.revoke_staff_role($1)',[f.docRole]);await f.as('orgA','select public.revoke_staff_role($1)',[f.cashierRole]);
 f.reviewerRole=(await f.as('orgA',"select public.assign_staff_role($1,$2,$3,'manager',array['publish_rules']) id",[f.org.A,f.auth.doc,f.scope.A])).rows[0].id;
 return f;}catch(e){await f.db.close();throw e;}}
