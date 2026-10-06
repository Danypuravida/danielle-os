
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const ORIGINS = new Set(["https://danypuravida.github.io","http://localhost:3000","http://127.0.0.1:5500"]);
function cors(req: Request) {
  const o=req.headers.get("origin")??"";
  return {
    "Access-Control-Allow-Origin":ORIGINS.has(o)?o:"https://danypuravida.github.io",
    "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods":"POST, OPTIONS",
    "Content-Type":"application/json; charset=utf-8",
    "Vary":"Origin"
  };
}
function send(req:Request,b:unknown,s=200){return new Response(JSON.stringify(b),{status:s,headers:cors(req)})}
async function aesKey(secret:string){
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw",digest,{name:"AES-GCM"},false,["decrypt"]);
}
async function decrypt(ct:string,iv:string,secret:string){
  const key=await aesKey(secret);
  const data=Uint8Array.from(atob(ct),c=>c.charCodeAt(0));
  const ivec=Uint8Array.from(atob(iv),c=>c.charCodeAt(0));
  const out=await crypto.subtle.decrypt({name:"AES-GCM",iv:ivec},key,data);
  return new TextDecoder().decode(out);
}
function localDate(d:Date){
  return new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).format(d);
}
function localTime(d:Date){
  return new Intl.DateTimeFormat("en-GB",{timeZone:"America/Sao_Paulo",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(d);
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors(req)});
  if(req.method!=="POST")return send(req,{error:"Método não permitido."},405);
  let admin:any=null,user:any=null;
  try{
    const auth=req.headers.get("Authorization")??"";
    if(!auth.startsWith("Bearer "))return send(req,{error:"Sessão ausente."},401);

    const keys=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")??"{}");
    const pub=keys.default??Deno.env.get("SUPABASE_ANON_KEY")??"";
    const sb=createClient(Deno.env.get("SUPABASE_URL")??"",pub,{global:{headers:{Authorization:auth}},auth:{persistSession:false}});
    const got=await sb.auth.getUser(auth.slice(7));user=got.data.user;const uerr=got.error;
    if(uerr||!user)return send(req,{error:"Sessão inválida."},401);

    const body=await req.json().catch(()=>({}));
    const date=String(body.date??"").match(/^\d{4}-\d{2}-\d{2}$/)?.[0] ?? localDate(new Date());

    admin=createClient(Deno.env.get("SUPABASE_URL")??"",Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"",{auth:{persistSession:false}});
    const {data:conn,error:cerr}=await admin.from("google_connections").select("*").eq("user_id",user.id).maybeSingle();
    if(cerr||!conn)return send(req,{error:"Google ainda não conectado.",needs_google_connect:true},409);

    const clientId=Deno.env.get("GOOGLE_CLIENT_ID")??"";
    const secret=Deno.env.get("GOOGLE_CLIENT_SECRET")??"";
    const refresh=await decrypt(conn.refresh_token_ciphertext,conn.refresh_token_iv,secret);

    const rr=await fetch("https://oauth2.googleapis.com/token",{
      method:"POST",
      headers:{"Content-Type":"application/x-www-form-urlencoded"},
      body:new URLSearchParams({client_id:clientId,client_secret:secret,refresh_token:refresh,grant_type:"refresh_token"})
    });
    const rt=await rr.json();
    if(!rr.ok)throw new Error(rt.error_description||rt.error||"GOOGLE_REFRESH_FAILED");
    const access=rt.access_token;

    const startIso=new Date(date+"T00:00:00-03:00").toISOString();
    const endDate=new Date(date+"T00:00:00-03:00");
    endDate.setDate(endDate.getDate()+1);
    const endIso=endDate.toISOString();

    const url="https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=100&timeMin="+encodeURIComponent(startIso)+"&timeMax="+encodeURIComponent(endIso);
    const cr=await fetch(url,{headers:{Authorization:"Bearer "+access}});
    const cj=await cr.json();
    if(!cr.ok)throw new Error(cj.error?.message||"CALENDAR_FETCH_FAILED");

    const events=(cj.items??[]).filter((e:any)=>e.status!=="cancelled");
    const personal=/\b(pole|almoço|almoco|ingl[eê]s|academia|treino|m[eé]dico|dentista|cancelar claude)\b/i;

    let synced=0;
    const activeIds:string[]=[];

    for(const e of events){
      const title=String(e.summary??"Sem título");
      if(personal.test(title))continue;

      const start=e.start?.dateTime?new Date(e.start.dateTime):e.start?.date?new Date(e.start.date+"T00:00:00-03:00"):null;
      if(!start)continue;

      activeIds.push(String(e.id));

      const attendees=(e.attendees??[]).map((a:any)=>a.displayName||a.email).filter(Boolean).join(", ");
      const {data:oldMeeting}=await admin.from("meetings").select("status").eq("user_id",user.id).eq("calendar_event_id",e.id).maybeSingle();
      const {error}=await admin.from("meetings").upsert({
        user_id:user.id,
        calendar_event_id:e.id,
        calendar_url:e.htmlLink??null,
        calendar_source:"google_calendar",
        calendar_synced_at:new Date().toISOString(),
        meeting_date:localDate(start),
        start_time:e.start?.dateTime?localTime(start):null,
        title,
        participants:attendees||null,
        status:oldMeeting?.status==="completed"?"completed":"planned"
      },{onConflict:"user_id,calendar_event_id"});
      if(error)throw error;
      const fingerprint="calendar:"+e.id;
      const {data:old}=await admin.from("assistant_items").select("id,status,status_locked").eq("user_id",user.id).eq("fingerprint",fingerprint).maybeSingle();
      const declined=(e.attendees??[]).some((a:any)=>a.self&&a.responseStatus==="declined");
      const row={user_id:user.id,source:"calendar",source_ref:e.id,source_url:e.htmlLink||null,fingerprint,
        title:"Reunião: "+title,summary:String(e.description||"Confira a pauta e os materiais para este compromisso.").replace(/<[^>]*>/g," ").slice(0,3000),
        why_it_needs_me:"Compromisso na sua agenda. Confira participação, preparação e horários.",due_at:start.toISOString(),
        urgency:localDate(start)===localDate(new Date())?"high":"normal",
        status:old?.status_locked?old.status:(oldMeeting?.status==="completed"||declined?"treated":"needs_me"),last_seen_at:new Date().toISOString()};
      const saved=old?.id?await admin.from("assistant_items").update(row).eq("id",old.id):await admin.from("assistant_items").insert(row);
      if(saved.error)throw saved.error;
      synced++;
    }

    const {data:existing,error:eerr}=await admin.from("meetings")
      .select("id,calendar_event_id,status")
      .eq("user_id",user.id)
      .eq("calendar_source","google_calendar")
      .eq("meeting_date",date);
    if(eerr)throw eerr;

    const activeSet=new Set(activeIds);
    const stale=(existing??[]).filter((m:any)=>
      m.status==="planned" &&
      m.calendar_event_id &&
      !activeSet.has(String(m.calendar_event_id))
    );

    let removed=0;
    if(stale.length){
      const ids=stale.map((m:any)=>m.id);
      const {error:cancelErr}=await admin.from("meetings")
        .update({status:"cancelled",calendar_synced_at:new Date().toISOString()})
        .in("id",ids);
      if(cancelErr)throw cancelErr;
      removed=ids.length;
    }

    return send(req,{ok:true,date,events_seen:events.length,synced,removed});
  }catch(e){
    const message=e instanceof Error?e.message:"Erro inesperado.";if(admin&&user)await admin.from("google_connections").update({last_error:message}).eq("user_id",user.id);return send(req,{error:message,needs_google_connect:/invalid_grant|expired|revoked/i.test(message)},500);
  }
});
