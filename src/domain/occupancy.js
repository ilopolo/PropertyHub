export function declaredCount(value) {
 if(value===null||value==='')return null;
 if(typeof value!=='string'||!/^(0|[1-9][0-9]{0,7})(\.0{1,4})?$/.test(value))throw new Error('Whole declared count required');
 return BigInt(value.split('.')[0]);
}
export function countLabel(value){return value===null?'неизвестен':String(value).replace(/\.0+$/,'');}
export function occupancyState(data){
 if(!data.applicable_count)return 'missing';
 if(data.subject_conflict_count)return 'subject_conflict';
 if(data.count_value===null)return 'unknown';
 if(declaredCount(data.count_value)===0n)return data.set_reviewed?'confirmed_zero':data.unreviewed_count?'declared_zero':'needs_zero_review';
 return data.set_reviewed?'verified_count':data.unreviewed_count?'declared_count':'needs_set_review';
}
