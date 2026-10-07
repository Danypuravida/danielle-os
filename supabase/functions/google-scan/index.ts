
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const ORIGINS=["https://danypuravida.github.io","http://localhost:3000","http://127.0.0.1:5500"];
function cors(req:Request){const o=req.headers.get("origin")??"";return {"Access-Control-Allow-Origin":ORIGINS.includes(o)?o:ORIGINS[0],"Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json; charset=utf-8","Vary":"Origin"}}
function json(req:Request,b:any,s=200){return new Response(JSON.stringify(b),{status:s,headers:cors(req)})}
async function aesKey(secret:string){const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(secret));return crypto.subtle.importKey("raw",digest,{name:"AES-GCM"},false,["decrypt"])}
async function decrypt(ct:string,iv:string,secret:string){const key=await aesKey(secret);const data=Uint8Array.from(atob(ct),c=>c.charCodeAt(0));const ive=Uint8Array.from(atob(iv),c=>c.charCodeAt(0));const out=await crypto.subtle.decrypt({name:"AES-GCM",iv:ive},key,data);return new TextDecoder().decode(out)}
function header(m:any,n:string){return (m.payload?.headers??[]).find((h:any)=>String(h.name).toLowerCase()===n.toLowerCase())?.value??""}
function extractText(p:any):string{
  if(!p)return "";
  if(p.mimeType==="text/plain"&&p.body?.data){let s=p.body.data.replace(/-/g,"+").replace(/_/g,"/");while(s.length%4)s+="=";try{return decodeURIComponent(escape(atob(s)))}catch{return atob(s)}}
  for(const x of p.parts??[]){const t=extractText(x);if(t)return t}
  return "";
}
function outputText(r:any){if(typeof r?.output_text==="string")return r.output_text;const a=[];for(const i of r?.output??[])for(const c of i?.content??[])if(c?.type==="output_text")a.push(c.text);return a.join("\n")}
function parseJsonLoose(s:string){const a=s.indexOf("{"),b=s.lastIndexOf("}");if(a<0||b<a)throw new Error("AI_JSON_INVALID");return JSON.parse(s.slice(a,b+1))}
function isoLocalDate(d:Date){return new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).format(d)}
function timeLocal(d:Date){return new Intl.DateTimeFormat("en-GB",{timeZone:"America/Sao_Paulo",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(d)}
function gmailMessageForItem(item:any,messages:any[]){
 const ref=String(item.source_ref||"");
 return messages.find(m=>m.id===ref)
  ||messages.find(m=>m.threadId===ref&&m.url===item.source_url)
  ||messages.find(m=>m.threadId===ref);
}
async function persistGmailItem(admin:any,userId:string,item:any,message:any){
 const status=["needs_me","delegated","draft_waiting","treated"].includes(item.status)?item.status:"needs_me";
 const row={user_id:userId,source:"gmail",source_ref:message.id,source_url:message.url,source_context:"Google scan",sender_name:item.sender_name||message.from||null,title:item.title||message.subject||"Sem título",summary:item.summary||null,why_it_needs_me:item.why_it_needs_me||null,due_at:item.due_at||null,urgency:["low","normal","high","urgent"].includes(item.urgency)?item.urgency:"normal",status,suggested_reply:item.suggested_reply||null,responsible:item.responsible||null,fingerprint:"gmail:"+message.id,last_seen_at:new Date().toISOString(),treated_at:status==="treated"?new Date().toISOString():null};
 // The unique fingerprint comes from Gmail, never from model-generated text.
 const inserted=await admin.from("assistant_items").upsert(row,{onConflict:"user_id,fingerprint",ignoreDuplicates:true});
 if(inserted.error)throw inserted.error;
 const {status:unusedStatus,treated_at:unusedTreated,responsible:unusedResponsible,...metadata}=row;
 const updated=await admin.from("assistant_items").update(metadata).eq("user_id",userId).eq("fingerprint",row.fingerprint).is("hidden_at",null);
 if(updated.error)throw updated.error;
 // Conditions run atomically in Postgres, including when completion races with a scan.
 const classified=await admin.from("assistant_items").update({status,treated_at:row.treated_at}).eq("user_id",userId).eq("fingerprint",row.fingerprint).eq("status_locked",false).is("hidden_at",null);
 if(classified.error)throw classified.error;
 const assigned=await admin.from("assistant_items").update({responsible:row.responsible}).eq("user_id",userId).eq("fingerprint",row.fingerprint).eq("responsible_locked",false).is("hidden_at",null);
 if(assigned.error)throw assigned.error;
}
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors(req)});
 if(req.method!=="POST")return json(req,{error:"Método não permitido."},405);
 let admin:any=null,user:any=null;
 try{
  const auth=req.headers.get("Authorization")??""; if(!auth.startsWith("Bearer "))return json(req,{error:"Sessão ausente."},401);
  const pub=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")??"{}").default??Deno.env.get("SUPABASE_ANON_KEY")??"";
  const sb=createClient(Deno.env.get("SUPABASE_URL")??"",pub,{global:{headers:{Authorization:auth}},auth:{persistSession:false}});
  const token=auth.slice(7); const got=await sb.auth.getUser(token);user=got.data.user;const uerr=got.error; if(uerr||!user)return json(req,{error:"Sessão inválida."},401);
  admin=createClient(Deno.env.get("SUPABASE_URL")??"",Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"",{auth:{persistSession:false}});
  const {data:conn,error:cerr}=await admin.from("google_connections").select("*").eq("user_id",user.id).maybeSingle();
  if(cerr||!conn)return json(req,{error:"Google ainda não conectado.",needs_google_connect:true},409);
  const secret=Deno.env.get("GOOGLE_CLIENT_SECRET")??"", clientId=Deno.env.get("GOOGLE_CLIENT_ID")??"";
  const refresh=await decrypt(conn.refresh_token_ciphertext,conn.refresh_token_iv,secret);
  const rr=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:clientId,client_secret:secret,refresh_token:refresh,grant_type:"refresh_token"})});
  const rt=await rr.json(); if(!rr.ok)throw new Error(rt.error_description||rt.error||"GOOGLE_REFRESH_FAILED");
  const access=rt.access_token;

  // Gmail: últimos 3 dias, exclui promo/spam/lixeira.
  const q=encodeURIComponent("newer_than:3d -category:promotions -in:spam -in:trash");
  const lr=await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=40&q="+q,{headers:{Authorization:"Bearer "+access}});
  const list=await lr.json();if(!lr.ok)throw new Error(list.error?.message||"Falha ao ler Gmail"); const ids=(list.messages??[]).slice(0,40);
  const messages:any[]=[];
  for(const x of ids){
    const mr=await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/"+x.id+"?format=full",{headers:{Authorization:"Bearer "+access}});
    if(!mr.ok)continue; const m=await mr.json();
    messages.push({id:m.id,threadId:m.threadId,from:header(m,"From"),to:header(m,"To"),subject:header(m,"Subject"),date:header(m,"Date"),snippet:m.snippet??"",body:extractText(m.payload).slice(0,5000),labels:m.labelIds??[],url:"https://mail.google.com/mail/u/0/#all/"+m.id});
  }

  // Calendar: agora -> 48h.
  const now=new Date(isoLocalDate(new Date())+"T00:00:00-03:00"), end=new Date(Date.now()+48*3600*1000);
  const cr=await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=40&timeMin="+encodeURIComponent(now.toISOString())+"&timeMax="+encodeURIComponent(end.toISOString()),{headers:{Authorization:"Bearer "+access}});
  const cj=await cr.json();if(!cr.ok)throw new Error(cj.error?.message||"Falha ao ler agenda");const events=(cj.items??[]).filter((e:any)=>e.status!=="cancelled");

  // Sincroniza reuniões de trabalho. Evita itens pessoais óbvios.
  const personal=/\b(pole|almoço|almoco|ingl[eê]s|academia|treino|m[eé]dico|dentista|cancelar claude)\b/i;
  for(const e of events){
    const title=String(e.summary??"Sem título"); if(personal.test(title))continue;
    const start=e.start?.dateTime?new Date(e.start.dateTime):null; if(!start)continue;
    const attendees=(e.attendees??[]).map((a:any)=>a.displayName||a.email).filter(Boolean).join(", ");
    await admin.from("meetings").upsert({
      user_id:user.id,calendar_event_id:e.id,calendar_url:e.htmlLink??null,calendar_source:"google_calendar",calendar_synced_at:new Date().toISOString(),
      meeting_date:isoLocalDate(start),start_time:timeLocal(start),title,participants:attendees||null,status:"planned"
    },{onConflict:"user_id,calendar_event_id",ignoreDuplicates:false});
  }

  const openaiKey=Deno.env.get("OPENAI_API_KEY"); if(!openaiKey)throw new Error("OPENAI_API_KEY ausente.");
  const prompt={
    now:new Date().toISOString(),
    timezone:"America/Sao_Paulo",
    instructions:"Analise mensagens de Gmail. Os eventos servem apenas de contexto para as 3 linhas do dia e são exibidos na aba Reuniões. Nunca transforme a existência de um compromisso em um item de pendência. Identifique todas as pendências concretas. Uma resposta enviada não prova que a ação prometida foi executada. Só inclua o que exige resposta, decisão, preparação ou ação da Danielle. Convites aceitos/recusados, newsletters, FYI, notificações automáticas e informativos sem ação devem ser ignorados. Retorne um único item por mensagem do Gmail, reunindo suas ações. source_ref precisa ser o id exato da mensagem; não use o assunto como identificador. Para cada EMAIL pendente, sempre gere suggested_reply curto, natural e pronto para copiar, sem inventar fatos. Status: needs_me quando Danielle precisa decidir/executar; draft_waiting quando o principal próximo passo é responder; delegated quando depende claramente de outra pessoa; treated só se os dados mostrarem que já foi resolvido. due_at: use prazo explícito; sem prazo, sugira um prazo conservador. Gere também 3 linhas: como está o dia; coisa mais importante; o que está prestes a atrasar. Retorne SOMENTE JSON válido.",
    schema:{items:[{source:"gmail",source_ref:"",source_url:"",sender_name:"",title:"",summary:"",why_it_needs_me:"",due_at:null,urgency:"low|normal|high|urgent",status:"needs_me|delegated|draft_waiting|treated",suggested_reply:"",responsible:"",fingerprint:""}],morning_line_1:"",morning_line_2:"",morning_line_3:""},
    messages,events:events.map((e:any)=>({id:e.id,title:e.summary,start:e.start,end:e.end,status:e.status,response:(e.attendees??[]).find((a:any)=>a.self)?.responseStatus,organizer:e.organizer?.email,description:String(e.description??"").slice(0,2500)}))
  };
  const or=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:"Bearer "+openaiKey,"Content-Type":"application/json"},body:JSON.stringify({model:Deno.env.get("OPENAI_MODEL")||"gpt-5.6-terra",store:false,max_output_tokens:3500,instructions:"Você é James, assistente executivo pessoal. Produza triagem curta, precisa e acionável. Responda apenas JSON.",input:[{role:"user",content:[{type:"input_text",text:JSON.stringify(prompt)}]}]})});
  const oj=await or.json(); if(!or.ok)throw new Error(oj?.error?.message||"Falha na IA");
  const tri=parseJsonLoose(outputText(oj)); const items=Array.isArray(tri.items)?tri.items:[];
  for(const it of items){
    const message=gmailMessageForItem(it,messages);
    if(!message)continue;
    await persistGmailItem(admin,user.id,it,message);
  }

  const {data:all}=await admin.from("assistant_items").select("status,urgency,due_at").eq("user_id",user.id).is("hidden_at",null);
  const needs=(all??[]).filter((x:any)=>x.status==="needs_me").length, drafts=(all??[]).filter((x:any)=>x.status==="draft_waiting").length, treated=(all??[]).filter((x:any)=>x.status==="treated").length;
  const delegatedAttention=(all??[]).some((x:any)=>x.status==="delegated" && ((x.due_at&&new Date(x.due_at)<=new Date())||["high","urgent"].includes(x.urgency)));
  const cat=(needs||drafts||delegatedAttention)?"awake":"sleeping";
  const {data:scan}=await admin.from("assistant_scans").insert({user_id:user.id,scan_period:"manual",needs_me_count:needs,draft_count:drafts,treated_count:treated,cat_state:cat,morning_line_1:tri.morning_line_1||"Dia atualizado.",morning_line_2:tri.morning_line_2||"Mais importante: revisar pendências.",morning_line_3:tri.morning_line_3||"Prestes a atrasar: nada identificado."}).select("id").single();
  await admin.from("google_connections").update({last_scan_at:new Date().toISOString(),last_error:null}).eq("user_id",user.id);
  return json(req,{ok:true,scan_id:scan?.id,counts:{needs,drafts,treated},meetings_synced:events.length});
 }catch(e){
  const message=e instanceof Error?e.message:"Erro inesperado.";if(admin&&user)await admin.from("google_connections").update({last_error:message}).eq("user_id",user.id);return json(req,{error:message,needs_google_connect:/invalid_grant|expired|revoked/i.test(message)},500);
 }
});
