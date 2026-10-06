
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const ORIGINS=new Set(["https://danypuravida.github.io","http://localhost:3000","http://127.0.0.1:5500"]);
function cors(req:Request){const o=req.headers.get("origin")??"";return {
  "Access-Control-Allow-Origin":ORIGINS.has(o)?o:"https://danypuravida.github.io",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS",
  "Content-Type":"application/json; charset=utf-8","Vary":"Origin"}}
function send(req:Request,b:any,s=200){return new Response(JSON.stringify(b),{status:s,headers:cors(req)})}
async function aesKey(secret:string){const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(secret));return crypto.subtle.importKey("raw",d,{name:"AES-GCM"},false,["decrypt"])}
async function decrypt(ct:string,iv:string,secret:string){const key=await aesKey(secret);const data=Uint8Array.from(atob(ct),c=>c.charCodeAt(0));const ivec=Uint8Array.from(atob(iv),c=>c.charCodeAt(0));const out=await crypto.subtle.decrypt({name:"AES-GCM",iv:ivec},key,data);return new TextDecoder().decode(out)}
async function api(token:string,method:string,params:Record<string,string>={}){
  const qs=new URLSearchParams(params);
  const r=await fetch("https://slack.com/api/"+method+(qs.size?"?"+qs.toString():""),{headers:{Authorization:"Bearer "+token}});
  if(r.status===429) throw new Error(method+":rate_limited");
  const j=await r.json();
  if(!j.ok) throw new Error(method+":"+String(j.error||"api_error"));
  return j;
}
async function listConversations(token:string,types:string){
  const all:any[]=[]; let cursor="";
  for(let page=0;page<12;page++){
    const r=await api(token,"conversations.list",{types,exclude_archived:"true",limit:"200",...(cursor?{cursor}:{})});
    all.push(...(r.channels??[]));
    cursor=r.response_metadata?.next_cursor??"";
    if(!cursor)break;
  }
  return all;
}
async function mapLimit<T,R>(arr:T[],limit:number,fn:(x:T)=>Promise<R>){
  const out:R[]=[]; let i=0;
  async function worker(){while(true){const idx=i++;if(idx>=arr.length)return;out[idx]=await fn(arr[idx])}}
  await Promise.all(Array.from({length:Math.min(limit,arr.length)},()=>worker()));
  return out;
}
Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors(req)});
  if(req.method!=="POST")return send(req,{error:"Método não permitido."},405);
  let admin:any=null,user:any=null,stage="auth";
  try{
    const auth=req.headers.get("Authorization")??"";
    if(!auth.startsWith("Bearer "))return send(req,{error:"Sessão ausente."},401);
    const keys=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")??"{}");
    const pub=keys.default??Deno.env.get("SUPABASE_ANON_KEY")??"";
    const sb=createClient(Deno.env.get("SUPABASE_URL")??"",pub,{global:{headers:{Authorization:auth}},auth:{persistSession:false}});
    const got=await sb.auth.getUser(auth.slice(7)); user=got.data.user;
    if(got.error||!user)return send(req,{error:"Sessão inválida."},401);

    admin=createClient(Deno.env.get("SUPABASE_URL")??"",Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"",{auth:{persistSession:false}});
    stage="connection";
    const {data:conn,error:cerr}=await admin.from("slack_connections").select("*").eq("user_id",user.id).maybeSingle();
    if(cerr)throw cerr;
    if(!conn)return send(req,{error:"Slack ainda não conectado.",needs_slack_connect:true},409);

    const body=await req.json().catch(()=>({}));
    if(body.action==="confirm_triage"){
      const {error}=await admin.from("slack_connections").update({last_scan_at:new Date().toISOString(),last_error:body.partial?"Leitura parcial do Slack. Confira os avisos e tente atualizar novamente.":null}).eq("user_id",user.id);
      if(error)throw error;return send(req,{ok:true});
    }
    stage="decrypt";
    const secret=Deno.env.get("SLACK_CLIENT_SECRET")??"";
    const token=await decrypt(conn.access_token_ciphertext,conn.access_token_iv,secret);

    stage="auth_test";
    await api(token,"auth.test");

    stage="list_conversations";
    const [channels,ims]=await Promise.all([
      listConversations(token,"public_channel,private_channel"),
      listConversations(token,"im")
    ]);
    const targets=[
      ...channels.filter((c:any)=>c.is_member&&/futebol|botafogo/i.test(String(c.name??""))),
      ...ims
    ];

    const oldest=String((Date.now()-7*24*60*60*1000)/1000);
    const warnings:string[]=[];
    stage="histories";
    const histories=await mapLimit(targets,8,async(c:any)=>{
      try{
        const messages:any[]=[];let cursor="";
        for(let page=0;page<3;page++){
          const r=await api(token,"conversations.history",{channel:c.id,oldest,limit:"50",inclusive:"true",...(cursor?{cursor}:{})});
          messages.push(...(r.messages??[]));cursor=r.response_metadata?.next_cursor||"";
          if(!cursor){if(r.has_more)warnings.push((c.name||c.id)+": histórico parcial");break}
          if(page===2)warnings.push((c.name||c.id)+": histórico parcial");
        }
        return {c,messages};
      }catch(e){return {c,messages:[],error:e instanceof Error?e.message:String(e)}}
    });

    const raw:any[]=[]; const userIds=new Set<string>();
    for(const h of histories){
      const c:any=h.c;
      if(h.error)warnings.push((c.name||c.id)+": "+h.error);
      if(c.is_im&&c.user)userIds.add(c.user);
      for(const m of h.messages??[]){
        if(m.type!=="message"||["channel_join","channel_leave"].includes(m.subtype))continue;
        if(!String(m.text||"").trim())continue;
        if(m.bot_id&&!c.is_im&&!String(m.text||"").includes("<@"+conn.slack_user_id+">"))continue;
        if(m.user)userIds.add(m.user);
        raw.push({c,m});
      }
    }

    stage="users_info";
    const nameMap=new Map<string,string>();
    const ids=[...userIds].slice(0,120);
    await mapLimit(ids,10,async(id)=>{
      try{
        const r=await api(token,"users.info",{user:id});
        const u=r.user; nameMap.set(id,u?.profile?.display_name||u?.real_name||u?.name||id);
      }catch{nameMap.set(id,id)}
      return true;
    });

    stage="threads";
    const threaded=raw.filter(x=>Number(x.m.reply_count||0)>0).slice(-20);
    const threadContext=new Map<string,string>();
    await mapLimit(threaded,5,async(x:any)=>{
      try{
        const r=await api(token,"conversations.replies",{channel:x.c.id,ts:x.m.ts,limit:"30"});
        const replies=(r.messages??[]).slice(1).map((m:any)=>({
          sender:nameMap.get(m.user)||m.user||"",
          text:String(m.text||"").slice(0,1200),
          ts:m.ts
        }));
        threadContext.set(x.c.id+":"+x.m.ts,JSON.stringify(replies));
      }catch{}
      return true;
    });

    const messages=raw.map(({c,m}:any)=>{
      const sender=nameMap.get(m.user)||m.user||"";
      const dmPerson=nameMap.get(c.user)||c.user||"";
      return {
        channel_id:c.id,
        channel_name:c.is_im?("DM • "+dmPerson):("#"+String(c.name||"")),
        is_dm:!!c.is_im,
        ts:m.ts,
        sender_name:sender,
        text:String(m.text||"").slice(0,3000),
        thread_replies:threadContext.get(c.id+":"+m.ts)||null,
        from_me:m.user===conn.slack_user_id,
        nathalia:/nath[aá]lia mesquita/i.test(String(sender)),
        source_url:conn.team_id?("https://app.slack.com/client/"+conn.team_id+"/"+c.id+"/thread-"+c.id+"-"+String(m.ts).replace(".","")):null
      };
    }).sort((a:any,b:any)=>Number(a.ts)-Number(b.ts));

    stage="save_status";
    await admin.from("slack_connections").update({
      last_error:warnings.length?"Leitura parcial: "+warnings.slice(0,4).join(" • "):"Mensagens lidas; triagem ainda não confirmada."
    }).eq("user_id",user.id);

    return send(req,{
      ok:true,workspace:conn.team_name,
      football_channels:targets.filter((x:any)=>!x.is_im).map((x:any)=>x.name),
      dm_count:targets.filter((x:any)=>x.is_im).length,
      messages_seen:messages.length,
      warnings,partial:warnings.length>0,lookback_days:7,
      messages
    });
  }catch(e){
    const msg=(e instanceof Error?e.message:"Erro inesperado.");
    try{if(admin&&user)await admin.from("slack_connections").update({last_error:stage+":"+msg}).eq("user_id",user.id)}catch{}
    return send(req,{error:msg,stage},500);
  }
});
