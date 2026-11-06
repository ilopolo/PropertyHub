export const applicabilitySchema=Object.freeze({schema_version:'fnd05-major-v1',qualification:'major_repair',regime:'zues_17_2_5_2023',funding:'owners_only_no_credit_or_aid',denominator:'all_common_parts',procedure:'in_person_assembly',dominant_owner:'none_over_51',property_regime:'zues_general'});
export const applicabilityFields=Object.freeze(['qualification_reference','rationale','voting_reference','votes_for_percent','represented_percent']);
const percent=v=>{if(typeof v!=='string'||!/^(0|[1-9]\d{0,2})(?:\.\d{1,8})?$/.test(v))throw Error('Процентът е точен десетичен текст с до 8 знака.');const[a,b='']=v.split('.');return a+'.'+b.padEnd(8,'0');};
export function applicabilityDraft(p){
 if(!p||Object.keys(p).some(k=>![...Object.keys(applicabilitySchema),...applicabilityFields].includes(k))||Object.entries(applicabilitySchema).some(([k,v])=>p[k]!==v))throw Error('Неквалифициран или неподдържан случай. Няма автоматичен избор на правен режим.');
 const result={...applicabilitySchema};for(const k of applicabilityFields){if(typeof p[k]!=='string'||!p[k].trim()||[...p[k].trim()].length>1000)throw Error('Нужни са конкретни доказателства и мотиви.');result[k]=p[k].trim();}
 for(const k of ['votes_for_percent','represented_percent'])result[k]=percent(result[k]);
 const yes=BigInt(result.votes_for_percent.replace('.','')),represented=BigInt(result.represented_percent.replace('.',''));
 if(yes<5100000000n||yes>represented||represented>10000000000n)throw Error('За този случай: 51% ≤ „за“ ≤ представени ≤ 100%, спрямо ВСИЧКИ идеални части.');return result;
}
