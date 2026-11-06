import {registryDate,registryToday} from './registry.js';

export const UNIT_CSV_VERSION='units-v1';
export const UNIT_CSV_COLUMNS=Object.freeze(['source_system','external_key','unit_number','unit_type','floor','area','source_kind','source_reference','known_from']);
export const UNIT_CSV_LIMITS=Object.freeze({bytes:262144,rows:200});
export const UNIT_TYPES=Object.freeze(['apartment','shop','office','garage','other']);
export const unitCsvTemplate=()=>UNIT_CSV_COLUMNS.join(',')+'\r\n';
export function decodeUnitCsv(bytes){if(bytes.byteLength>UNIT_CSV_LIMITS.bytes)throw new RangeError('csv_size');try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new RangeError('csv_encoding');}}

// RFC-style quoted fields; no delimiter guessing, trimming, blank-row removal or number coercion.
export function parseUnitCsv(text){
 if(typeof text!=='string'||new TextEncoder().encode(text).length>UNIT_CSV_LIMITS.bytes)throw new RangeError('csv_size');
 if(text.startsWith('\uFEFF'))text=text.slice(1);
 if(text.includes('\0'))throw new RangeError('csv_control');
 const records=[];let row=[],field='',quoted=false,closed=false,recordStarted=false;
 const endField=()=>{row.push(field);field='';closed=false;};
 const endRow=()=>{endField();records.push(row);row=[];recordStarted=false;if(records.length>UNIT_CSV_LIMITS.rows+1)throw new RangeError('csv_rows');};
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;continue;}
  if(c==='"'){if(field!==''||closed)throw new RangeError('csv_quote');quoted=true;recordStarted=true;}
  else if(c===','){endField();recordStarted=true;}
  else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;endRow();}
  else{if(closed)throw new RangeError('csv_quote');field+=c;recordStarted=true;}
 }
 if(quoted)throw new RangeError('csv_quote');
 if(recordStarted||row.length||field!==''||closed)endRow();
 const header=records.shift();if(!header||JSON.stringify(header)!==JSON.stringify(UNIT_CSV_COLUMNS))throw new RangeError('csv_header');
 if(!records.length)throw new RangeError('csv_empty');
 return records.map((values,i)=>{if(values.length!==UNIT_CSV_COLUMNS.length)throw new RangeError('csv_columns:'+String(i+2));return Object.fromEntries(UNIT_CSV_COLUMNS.map((k,n)=>[k,values[n]]));});
}

export function unitCsvRowErrors(row,today=registryToday()){
 const errors=[];const add=(column,code)=>errors.push({column,code});
 if(!row||Object.keys(row).length!==UNIT_CSV_COLUMNS.length||UNIT_CSV_COLUMNS.some(k=>typeof row[k]!=='string'))return[{column:'row',code:'columns'}];
 for(const[k,max]of [['source_system',80],['external_key',120],['unit_number',40],['source_reference',200]])if(!row[k]||row[k]!==row[k].trim()||[...row[k]].length>max||row[k].includes('\0'))add(k,'required_text');
 if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(row.source_system))add('source_system','source_system');
 if(/[\u0000-\u001F\u007F]/.test(row.external_key))add('external_key','key_characters');
 if(!UNIT_TYPES.includes(row.unit_type))add('unit_type','unit_type');
 if([...row.floor].length>40||row.floor!==row.floor.trim()||row.floor.includes('\0'))add('floor','floor');
 if(row.area!==''&&(!/^\d{1,8}(?:\.\d{1,4})?$/.test(row.area)||!/[1-9]/.test(row.area)))add('area','area');
 if(!['declaration','document'].includes(row.source_kind))add('source_kind','source_kind');
 try{registryDate(row.known_from);if(row.known_from>today)throw Error();}catch{add('known_from','known_from');}
 return errors;
}

// Prefix spreadsheet formulas BEFORE CSV quoting. Quoting by itself does not neutralize formulas.
export function csvCell(value){let s=value==null?'':String(value);if(/^[\s\u0000-\u001F]*[=+\-@]/u.test(s)||/^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
export function encodeCsv(columns,rows){return '\uFEFF'+[columns.map(csvCell).join(','),...rows.map(r=>columns.map(k=>csvCell(r[k])).join(','))].join('\r\n')+'\r\n';}
