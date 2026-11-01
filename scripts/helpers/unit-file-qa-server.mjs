// LOCAL QA TRANSPORT ONLY. Real HTTP bytes + PostgreSQL RLS, NOT Supabase Storage/Auth.
// Never imported by application code or used as evidence for the provider's runtime.
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {createDownloadHandler} from '../../supabase/functions/download-unit-file/handler.js';
export async function startUnitFileQaServer(f,qaPassword,options={}){
 const bucket=options.bucket||'unit-private-files',functionName=options.functionName||'download-unit-file',authorizeRpc=options.authorizeRpc||'authorize_unit_file_download';
 const handlerFactory=options.handlerFactory||createDownloadHandler,mimes=options.mimes||['application/pdf'];
 const objects=new Map(),sessions=new Map(),transfers={uploads:0,downloads:0,deletes:0},failures=[];let queue=Promise.resolve();
 const user=label=>({id:f.auth[label],email:`${label.toLowerCase()}@propertyhub.invalid`,email_confirmed_at:new Date().toISOString(),is_anonymous:false,aud:'authenticated',role:'authenticated',app_metadata:{provider:'email'},user_metadata:{display_name:'Synthetic '+label}});
 const server=createServer((req,res)=>{queue=queue.then(async()=>{
  const url=new URL(req.url,'http://127.0.0.1'),chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks);
  res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:5173');res.setHeader('Access-Control-Allow-Headers','*');res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,DELETE,OPTIONS');res.setHeader('Cache-Control','no-store');
  const json=(data,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));};
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
  const label=sessions.get((req.headers.authorization||'').replace('Bearer ',''))||'anon';
  try{
   if(url.pathname==='/auth/v1/token'&&req.method==='POST'){
    const input=JSON.parse(body),who=Object.keys(f.auth).find(l=>user(l).email===input.email);
    if(!who||input.password!==qaPassword)return json({message:'Invalid credentials'},400);
    const exp=Math.floor(Date.now()/1000)+3600,token=[{alg:'HS256',typ:'JWT'},{sub:f.auth[who],role:'authenticated',aud:'authenticated',exp},'qa-only'].map(v=>Buffer.from(typeof v==='string'?v:JSON.stringify(v)).toString('base64url')).join('.');sessions.set(token,who);
    return json({access_token:token,refresh_token:randomUUID(),token_type:'bearer',expires_in:3600,expires_at:exp,user:user(who)});
   }
   if(url.pathname==='/auth/v1/user')return label==='anon'?json({message:'Unauthorized'},401):json(user(label));
   if(url.pathname==='/auth/v1/logout'){sessions.delete((req.headers.authorization||'').replace('Bearer ',''));return json({});}
   if(url.pathname.startsWith('/rest/v1/rpc/')&&req.method==='POST'){
    const name=url.pathname.split('/').at(-1),args=JSON.parse(body.length?body:'{}');if(!/^[a-z_]+$/.test(name))return json({},404);
    const candidates=(await f.db.query(`select p.proargnames,p.pronargs,p.proargtypes::oid[] types,p.proretset,t.typname
     from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_type t on t.oid=p.prorettype where n.nspname='public' and p.proname=$1`,[name])).rows;
    const candidate=candidates.find(p=>Object.keys(args).every(k=>p.proargnames.slice(0,p.pronargs).includes(k)));if(!candidate)return json({message:'Unknown fixture RPC'},404);
    const names=Object.keys(args),values=names.map(k=>{const v=args[k];return k==='permissions'&&Array.isArray(v)?v:v&&typeof v==='object'?JSON.stringify(v):v;});
    const result=await f.as(label,`select * from public.${name}(${names.map((k,i)=>`"${k}"=>$${i+1}`).join(',')})`,values);
    return json(candidate.proretset?result.rows:candidate.typname==='void'?null:Object.hasOwn(result.rows[0]||{},name)?result.rows[0][name]:result.rows[0]);
   }
   if(url.pathname.startsWith('/rest/v1/')&&req.method==='GET'){
    const table=url.pathname.split('/').at(-1);if(!['profiles','user_roles','organizations','organization_memberships','scope_setup_requests','access_requests','units','unit_scope_periods','persons','management_units','entrances','buildings'].includes(table))return json({message:'Unknown fixture table'},404);
    const values=[],where=[];for(const [key,value]of url.searchParams){if(!/^[a-z_]+$/.test(key)||['select','order','limit'].includes(key))continue;if(value.startsWith('eq.')){values.push(value.slice(3));where.push(`"${key}"=$${values.length}`);}else if(value==='is.null')where.push(`"${key}" is null`);}
    const columns=url.searchParams.get('select')||'*';if(!/^(\*|[a-z_]+(?:,[a-z_]+)*)$/.test(columns))return json({message:'Unsupported fixture projection'},400);
    const result=await f.as(label,`select ${columns} from public.${table}${where.length?' where '+where.join(' and '):''}`,values);
    // PostgREST serializes PostgreSQL DATE as YYYY-MM-DD; PGlite returns JS Date.
    for(const field of result.fields||[])if(field.dataTypeID===1082)for(const row of result.rows)if(row[field.name] instanceof Date)row[field.name]=row[field.name].toISOString().slice(0,10);
    return json(req.headers.accept?.includes('application/vnd.pgrst.object')?result.rows[0]:result.rows);
   }
   if(url.pathname===`/functions/v1/${functionName}`&&req.method==='POST'){
    const handler=handlerFactory({authenticate:async()=>label==='anon'?null:user(label),
     authorize:async(_token,id)=>(await f.as(label,`select * from public.${authorizeRpc}($1)`,[id])).rows[0]||null,
     fetchObject:async d=>{const content=objects.get(d.storage_path);if(!content)throw Error('Synthetic object absent');transfers.downloads++;return{body:(async function*(){yield content;})(),contentType:d.mime_type,contentLength:content.length};}});
    const response=await handler(new Request('http://local/functions/v1/download-unit-file',{method:'POST',headers:req.headers,body}));
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
   }
   const match=url.pathname.match(new RegExp(`^/storage/v1/object/(authenticated/)?${bucket}(?:/(.+))?$`));
   if(match){
    const path=decodeURIComponent(match[2]||'');
    if(req.method==='POST'&&path&&!match[1]){
     const request=new Request('http://local/upload',{method:'POST',headers:{'content-type':req.headers['content-type']},body}),form=await request.formData(),file=form.get('file')||[...form.values()].find(v=>typeof v!=='string');
     if(!file||!mimes.includes(file.type)||file.size<1||file.size>5242880)return json({message:'Bucket type/size refusal'},400);
     if(req.headers['x-upsert']==='true')return json({message:'Upsert forbidden'},403);
     const content=Buffer.from(await file.arrayBuffer());await f.as(label,'insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',[bucket,path,{size:content.length,mimetype:file.type}],'storage.object.upload');objects.set(path,content);transfers.uploads++;return json({Key:bucket+'/'+path,Id:randomUUID()});
    }
    if(req.method==='GET'&&path){
     const rows=(await f.as(label,'select id from storage.objects where bucket_id=$1 and name=$2',[bucket,path],'storage.object.get_authenticated')).rows;if(!rows.length||!objects.has(path))return json({message:'Object unavailable'},403);
     transfers.downloads++;res.writeHead(200,{'content-type':'application/pdf'});res.end(objects.get(path));return;
    }
    if(req.method==='DELETE'&&!path){
     const deleted=[];for(const name of JSON.parse(body).prefixes||[]){const rows=(await f.as(label,'delete from storage.objects where bucket_id=$1 and name=$2 returning name',[bucket,name],'storage.object.delete_many')).rows;if(rows.length){objects.delete(name);deleted.push({name});transfers.deletes++;}}return json(deleted);
    }
   }
   return json({message:'Unsupported local QA route'},404);
  }catch(error){failures.push({path:url.pathname,code:error.code,message:error.message});return json({code:error.code||'QA_TRANSPORT',message:error.message},error.code==='42501'?403:400);}
 }).catch(()=>{if(!res.headersSent)res.writeHead(500);res.end();});});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(54331,'127.0.0.1',resolve);});
 return {transfers,objects,failures,close:()=>new Promise(resolve=>server.close(resolve))};
}
