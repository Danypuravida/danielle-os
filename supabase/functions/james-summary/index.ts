
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const ORIGINS=["https://danypuravida.github.io","http://localhost:3000","http://127.0.0.1:5500"];
function cors(req:Request){const o=req.headers.get("origin")??"";return {"Access-Control-Allow-Origin":ORIGINS.includes(o)?o:ORIGINS[0],"Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json; charset=utf-8","Vary":"Origin"}}
function json(req:Request,b:any,s=200){return new Response(JSON.stringify(b),{status:s,headers:cors(req)})}
function outputText(r:any){if(typeof r?.output_text==="string")return r.output_text;const a=[];for(const i of r?.output??[])for(const c of i?.content??[])if(c?.type==="output_text")a.push(c.text);return a.join("\n")}
function parseJsonLoose(s:string){const a=s.indexOf("{"),b=s.lastIndexOf("}");if(a<0||b<a)throw new Error("AI_JSON_INVALID");return JSON.parse(s.slice(a,b+1))}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors(req)});
 const auth=req.headers.get("Authorization")??"";if(!auth.startsWith("Bearer "))return json(req,{error:"Sessão ausente."},401);
 try{
  const pub=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")??"{}").default??Deno.env.get("SUPABASE_ANON_KEY")??"";
  const sb=createClient(Deno.env.get("SUPABASE_URL")??"",pub,{global:{headers:{Authorization:auth}},auth:{persistSession:false}});
  const {data:{user}}=await sb.auth.getUser(auth.slice(7));if(!user)return json(req,{error:"Sessão inválida."},401);
  const admin=createClient(Deno.env.get("SUPABASE_URL")??"",Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"",{auth:{persistSession:false}});
  const {data:items}=await admin.from("assistant_items").select("source,title,summary,why_it_needs_me,due_at,urgency,status,responsible").eq("user_id",user.id).is("hidden_at",null).in("status",["needs_me","delegated","draft_waiting"]).order("due_at",{ascending:true,nullsFirst:false}).limit(40);
  const today=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const {data:meet}=await admin.from("meetings").select("title,start_time,participants").eq("user_id",user.id).eq("meeting_date",today).neq("status","cancelled").order("start_time",{ascending:true}).limit(20);
  const key=Deno.env.get("OPENAI_API_KEY");if(!key)throw new Error("OPENAI_API_KEY ausente.");
  const or=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify({
    model:Deno.env.get("OPENAI_MODEL")||"gpt-5.6-terra",store:false,max_output_tokens:500,
    instructions:"Você é James. Gere somente JSON válido com 3 linhas curtas e executáveis para Danielle. Sem floreio, sem explicar processo.",
    input:[{role:"user",content:[{type:"input_text",text:JSON.stringify({items,meetings:meet,format:{morning_line_1:"Como está o dia",morning_line_2:"Coisa mais importante",morning_line_3:"O que está prestes a atrasar"}})}]}]
  })});
  const oj=await or.json();if(!or.ok)throw new Error(oj?.error?.message||"Falha na IA");
  const tri=parseJsonLoose(outputText(oj));
  const all=items??[],needs=all.filter((x:any)=>x.status==="needs_me").length,drafts=all.filter((x:any)=>x.status==="draft_waiting").length;
  const {count:treated}=await admin.from("assistant_items").select("id",{count:"exact",head:true}).eq("user_id",user.id).is("hidden_at",null).eq("status","treated");
  const delegatedAttention=all.some((x:any)=>x.status==="delegated"&&((x.due_at&&new Date(x.due_at)<=new Date())||["high","urgent"].includes(x.urgency)));
  const cat=(needs||drafts||delegatedAttention)?"awake":"sleeping";
  await admin.from("assistant_scans").insert({user_id:user.id,scan_period:"manual",needs_me_count:needs,draft_count:drafts,treated_count:treated??0,cat_state:cat,morning_line_1:tri.morning_line_1||"Dia atualizado.",morning_line_2:tri.morning_line_2||"Mais importante: revisar pendências.",morning_line_3:tri.morning_line_3||"Prestes a atrasar: nada identificado."});
  return json(req,{ok:true});
 }catch(e){return json(req,{error:e instanceof Error?e.message:"Erro inesperado."},500)}
});
