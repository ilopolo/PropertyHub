import {registryDate} from './registry.js';

// Percentage points, scaled to 8 decimal places. Missing is not a zero share.
const SCALE=100000000n, FULL=100n*SCALE;
export function percentageUnits(value) {
  if(value===null||value===undefined||value==='')return null;
  if(typeof value!=='string'||!/^(0|[1-9][0-9]{0,2})(\.[0-9]{1,8})?$/.test(value))throw new RangeError('invalid_percentage');
  const [whole,part='']=value.split('.');
  const units=BigInt(whole)*SCALE+BigInt(part.padEnd(8,'0'));
  if(units<=0n||units>FULL)throw new RangeError('percentage_out_of_range');
  return units;
}
export function percentageText(units) {
  const sign=units<0n?'-':'';const magnitude=units<0n?-units:units;
  const part=(magnitude%SCALE).toString().padStart(8,'0').replace(/0+$/,'');
  return `${sign}${magnitude/SCALE}${part?'.'+part:''}`;
}
function period(value) {
  registryDate(value.valid_from);
  if(value.valid_to!==null&&value.valid_to!==undefined)registryDate(value.valid_to);
  if(value.valid_to!=null&&value.valid_to<=value.valid_from)throw new RangeError('invalid_period');
  return {from:value.valid_from,to:value.valid_to??null};
}
const active=(p,date)=>p.from<=date&&(p.to===null||date<p.to);
const overlaps=(a,b)=>(a.to===null||b.from<a.to)&&(b.to===null||a.from<b.to);
const key=value=>typeof value==='string'&&value.trim().length>0;
const revision=value=>Number.isSafeInteger(value)&&value>0;
function basisValid(b) {
  return b&&key(b.key)&&revision(b.revision)&&key(b.building_id)&&
    ((b.kind==='building'&&b.entrance_id==null)||(b.kind==='entrance'&&key(b.entrance_id)));
}
const sameIdentity=(a,b)=>a.key===b.key&&a.kind===b.kind&&a.building_id===b.building_id&&(a.entrance_id??null)===(b.entrance_id??null);
function state(reasons) {
  if(reasons.some(r=>['invalid_percentage','percentage_out_of_range','invalid_period','invalid_record','duplicate_record','duplicate_participant','overlapping_periods','exceeded_total','invalid_basis','invalid_participant_set'].includes(r.code)))return 'conflict';
  if(reasons.some(r=>['wrong_basis','unexpected_participant'].includes(r.code)))return 'wrong_basis';
  if(reasons.some(r=>['unknown_percentage','missing_participant'].includes(r.code)))return 'missing';
  if(reasons.some(r=>['unestablished_basis','unestablished_participants','unreviewed_row','stale_revision','outside_participant_period'].includes(r.code)))return 'unreviewed';
  if(reasons.some(r=>r.code==='partial_total'))return 'partial';
  return 'ready';
}

/** Pure assessment of supplied evidence assertions, NOT authorization or a persisted set review.
 * basis: {key,revision,kind,building_id,entrance_id?,verified}
 * participants: {basis,revision,unit_ids,verified,valid_from,valid_to?}
 * rows: [{id,unit_id,basis,participant_revision,percentage,valid_from,valid_to?,
 *         verification_status,record_state?}]; only current facts are assessed.
 * interval: [valid_from,valid_to); all intersecting change points are evaluated.
 * Reasons retain row indexes; valid individual facts alone never prove a full set.
 */
export function assessUnitShares({basis,participants,rows,interval}) {
  const reasons=[],rowResults=[],facts=[];
  const add=(code,detail={})=>reasons.push({code,...detail});
  let window,participantPeriod;
  try{window=period(interval);}catch{add('invalid_period',{target:'interval'});}
  const validBasis=basisValid(basis);
  if(!validBasis)add('invalid_basis');
  else if(basis.verified!==true)add('unestablished_basis');
  const validParticipants=participants&&revision(participants.revision)&&Array.isArray(participants.unit_ids)&&participants.unit_ids.length>0&&participants.unit_ids.every(key)&&basisValid(participants.basis);
  if(!validParticipants)add('invalid_participant_set');
  const expected=new Set(validParticipants?participants.unit_ids:[]);
  if(validParticipants){
    if(expected.size!==participants.unit_ids.length)add('duplicate_participant');
    if(validBasis&&!sameIdentity(basis,participants.basis))add('wrong_basis',{target:'participants'});
    else if(validBasis&&basis.revision!==participants.basis.revision)add('stale_revision',{target:'participants'});
    if(participants.verified!==true)add('unestablished_participants');
    try{participantPeriod=period(participants);}catch{add('invalid_period',{target:'participants'});}
  }
  if(!Array.isArray(rows))add('invalid_record',{target:'rows'});
  const ids=new Set();
  for(const [index,row]of (Array.isArray(rows)?rows:[]).entries()){
    if(row&&['superseded','voided'].includes(row.record_state)){rowResults.push({index,ignored:true});continue;}
    const issues=[];let dates,quantity=null;
    if(!row||!key(row.id)||!key(row.unit_id)||!basisValid(row.basis)||!revision(row.participant_revision)||!['verified','needs_review'].includes(row.verification_status)||!['current',undefined].includes(row.record_state))issues.push('invalid_record');
    if(row){
      if(ids.has(row.id))issues.push('duplicate_record');ids.add(row.id);
      try{dates=period(row);}catch{issues.push('invalid_period');}
      try{quantity=percentageUnits(row.percentage);if(quantity===null)issues.push('unknown_percentage');}catch(error){issues.push(error.message);}
      if(validBasis&&basisValid(row.basis)){
        if(!sameIdentity(basis,row.basis))issues.push('wrong_basis');
        else if(basis.revision!==row.basis.revision)issues.push('stale_revision');
      }
      if(validParticipants){
        if(!expected.has(row.unit_id))issues.push('unexpected_participant');
        if(row.participant_revision!==participants.revision)issues.push('stale_revision');
      }
      if(row.verification_status!=='verified')issues.push('unreviewed_row');
    }
    for(const code of new Set(issues))add(code,{row:index});
    rowResults.push({index,valid:issues.length===0||(issues.length===1&&issues[0]==='unreviewed_row'),reviewed:issues.length===0,reasons:[...new Set(issues)]});
    if(dates&&row&&key(row.unit_id)&&basisValid(row.basis)&&validBasis&&sameIdentity(basis,row.basis))facts.push({index,row,dates,quantity});
  }
  // Detect conflicting current versions even outside the requested assessment interval.
  for(let i=0;i<facts.length;i++)for(let j=i+1;j<facts.length;j++)if(facts[i].row.unit_id===facts[j].row.unit_id&&overlaps(facts[i].dates,facts[j].dates))add('overlapping_periods',{rows:[facts[i].index,facts[j].index]});
  const segments=[];
  if(window){
    const points=new Set([window.from]);
    for(const p of [...facts.map(f=>f.dates),...(participantPeriod?[participantPeriod]:[])])for(const date of [p.from,p.to])if(date!==null&&date>window.from&&(window.to===null||date<window.to))points.add(date);
    const starts=[...points].sort();
    for(const [i,from]of starts.entries()){
      const applicable=facts.filter(f=>active(f.dates,from)),segmentReasons=[];
      const note=(code,detail={})=>segmentReasons.push({code,...detail});
      const missing=[...expected].filter(id=>!applicable.some(f=>f.row.unit_id===id));
      for(const unit_id of missing)note('missing_participant',{unit_id});
      if(participantPeriod&&!active(participantPeriod,from))note('outside_participant_period');
      // A known subtotal is diagnostic only when a row is missing/unknown/conflicting.
      const sum=applicable.reduce((total,f)=>total+(f.quantity??0n),0n);
      if(sum>FULL)note('exceeded_total');else if(sum<FULL)note('partial_total');
      const combined=[...reasons,...segmentReasons];
      segments.push({valid_from:from,valid_to:starts[i+1]??window.to,known_total:percentageText(sum),difference:percentageText(sum-FULL),state:state(combined),reasons:segmentReasons});
    }
  }
  const all=[...reasons,...segments.flatMap(s=>s.reasons.map(r=>({...r,valid_from:s.valid_from})))];
  return {state:state(all),reasons:all,rows:rowResults,segments};
}
