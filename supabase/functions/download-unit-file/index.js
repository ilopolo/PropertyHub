import {createClient} from 'npm:@supabase/supabase-js@2.118.0';
import {S3Client,GetObjectCommand} from 'npm:@aws-sdk/client-s3@3.1161.0';
import {FetchHttpHandler} from 'npm:@smithy/fetch-http-handler@5.8.0';
import {createDownloadHandler} from './handler.js';

// Fixed deployment target. Missing/misdirected configuration never falls back to REST.
const PROJECT='qfybswnezdzzahmozikr';
export function runtimeHandler(env=name=>Deno.env.get(name)) {
 return async request => {
  // Config and callers are request-scoped; a failed config still returns no-store errors.
  let client, s3;
  const configured=()=>{
   const url=env('SUPABASE_URL'),key=env('UNIT_FILES_PUBLIC_KEY');
   const endpoint=env('UNIT_FILES_S3_ENDPOINT'),region=env('UNIT_FILES_S3_REGION');
   const accessKeyId=env('UNIT_FILES_S3_ACCESS_KEY_ID'),secretAccessKey=env('UNIT_FILES_S3_SECRET_ACCESS_KEY');
   if (url!==`https://${PROJECT}.supabase.co` || !key?.startsWith('sb_publishable_')
    || endpoint!==`https://${PROJECT}.storage.supabase.co/storage/v1/s3`
    || !/^[a-z]{2}-[a-z]+-\d$/.test(region||'') || !accessKeyId || !secretAccessKey) throw Error('Configuration unavailable');
   return {url,key,endpoint,region,accessKeyId,secretAccessKey};
  };
  const handle=createDownloadHandler({
   async authenticate(token,signal) {
    const c=configured();
    client=createClient(c.url,c.key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
     global:{headers:{Authorization:`Bearer ${token}`},fetch:(url,options)=>fetch(url,{...options,signal,cache:'no-store'})}});
    const {data,error}=await client.auth.getUser(token);
    if (error) return null;
    return data.user;
   },
   async authorize(_token,id,signal) {
    const {data,error}=await client.rpc('authorize_unit_file_download',{document_id:id}).abortSignal(signal);
    if (error) throw Error('Authorization unavailable');
    return data?.length===1 ? data[0] : null;
   },
   async fetchObject(document,signal) {
    const c=configured();
    // Only this command is reachable, after authorization, for the exact DB-bound key.
    s3=new S3Client({endpoint:c.endpoint,region:c.region,forcePathStyle:true,maxAttempts:1,followRegionRedirects:false,
     requestHandler:new FetchHttpHandler({requestInit:()=>({cache:'no-store',redirect:'error'})}),
     credentials:{accessKeyId:c.accessKeyId,secretAccessKey:c.secretAccessKey}});
    const object=await s3.send(new GetObjectCommand({Bucket:'unit-private-files',Key:document.storage_path}),{abortSignal:signal});
    return {body:object.Body,contentType:object.ContentType,contentLength:object.ContentLength};
   }
  });
  try { return await handle(request); } finally { s3?.destroy(); }
 };
}
if (import.meta.main) Deno.serve(runtimeHandler());
