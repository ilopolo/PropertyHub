// Deno subprocess. Receives only an ordinary JWT/key via stdin; never logs input.
// Real S3 probe requires explicit target/execute. No create/write/delete/sign commands.
import {S3Client,GetObjectCommand} from 'npm:@aws-sdk/client-s3@3.1161.0';
import {FetchHttpHandler} from 'npm:@smithy/fetch-http-handler@5.8.0';
const PROJECT='qfybswnezdzzahmozikr';
if(Deno.args.join(' ')!==`--execute --project ${PROJECT}`)throw Error('Explicit target required');
let input='',size=0;for await(const chunk of Deno.stdin.readable){size+=chunk.length;if(size>32768)throw Error('Input too large');input+=new TextDecoder().decode(chunk);}
let parsed;try{parsed=JSON.parse(input);}catch{throw Error('Invalid probe input');}
const {token,legacyAnonKey,path,region}=parsed;
if(typeof token!=='string'||typeof legacyAnonKey!=='string'||!new RegExp('^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\\.pdf$','i').test(path)||region!=='eu-west-1')throw Error('Invalid probe input');
const client=new S3Client({endpoint:`https://${PROJECT}.storage.supabase.co/storage/v1/s3`,region,forcePathStyle:true,maxAttempts:1,followRegionRedirects:false,
 requestHandler:new FetchHttpHandler({requestInit:()=>({cache:'no-store',redirect:'error'})}),credentials:{accessKeyId:PROJECT,secretAccessKey:legacyAnonKey,sessionToken:token}});
let failed=false;
try{
 const result=await client.send(new GetObjectCommand({Bucket:'unit-private-files',Key:path}),{abortSignal:AbortSignal.timeout(20000)});
 await result.Body?.cancel?.();console.log(JSON.stringify({denied:false,status:result.$metadata.httpStatusCode}));failed=true;
}catch(error){
 const status=error.$metadata?.httpStatusCode,code=error.name;
 const denied=[403,404].includes(status)&&['AccessDenied','NoSuchKey','NotFound'].includes(code);
 console.log(JSON.stringify({denied,status:status||null,code:['AccessDenied','NoSuchKey','NotFound','SignatureDoesNotMatch','InvalidAccessKeyId','InvalidToken'].includes(code)?code:'TransportOrConfigurationFailure'}));
 if(!denied)failed=true;
}finally{client.destroy();}
if(failed)Deno.exit(1);
