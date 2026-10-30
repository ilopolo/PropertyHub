// Exact decimal text throughout; never normalize a partial set or use floating-point sums.
export function fractionUnits(value) {
  if(typeof value!=='string'||!/^[01](\.[0-9]{1,10})?$/.test(value))throw new Error('Invalid fraction');
  const [whole,part='']=value.split('.');const result=BigInt(whole)*10000000000n+BigInt(part.padEnd(10,'0'));
  if(result<=0n||result>10000000000n)throw new Error('Invalid fraction');return result;
}
export function decimalLabel(value) {return String(value).replace(/(\.[0-9]*?)0+$/,'$1').replace(/\.$/,'');}
export function ownershipState(data) {
  if(decimalLabel(data.total_fraction)==='0')return 'missing';
  if(decimalLabel(data.total_fraction)!=='1')return 'partial';
  if(data.unreviewed_count)return 'unreviewed';
  return data.set_reviewed?'reviewed':'needs_set_review';
}
