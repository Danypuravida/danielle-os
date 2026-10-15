
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigins = new Set(["https://danypuravida.github.io","http://localhost:3000","http://127.0.0.1:5500"]);
function cors(req: Request){
  const origin=req.headers.get("origin")??"";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin)?origin:"https://danypuravida.github.io",
    "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods":"POST, OPTIONS",
    "Content-Type":"application/json; charset=utf-8",
    "Cache-Control":"no-store",
    "Vary":"Origin"
  };
}
function json(req: Request, body: unknown, status=200){return new Response(JSON.stringify(body),{status,headers:cors(req)});}
async function todoist(path:string, init:RequestInit={}){
  const token=Deno.env.get("TODOIST_API_TOKEN");
  if(!token) throw new Error("TODOIST_API_TOKEN_NOT_CONFIGURED");
  const res=await fetch("https://api.todoist.com/api/v1"+path,{
    ...init,
    cache:"no-store",
    headers:{
      "Authorization":`Bearer ${token}`,
      "Content-Type":"application/json",
      ...(init.headers||{})
    }
  });
  const text=await res.text();
  let data:any=null;
  try{data=text?JSON.parse(text):null}catch{data=text}
  if(!res.ok) throw new Error(`TODOIST_${res.status}: ${typeof data==="string"?data:JSON.stringify(data)}`);
  return data;
}
function todayISO(timezone="America/Sao_Paulo",now=new Date()){
 return new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit"}).format(now);
}
function dueDate(t:any){return t?.due?.date?String(t.due.date).slice(0,10):null;}
async function readTodoistTasks(fetchTodoist=todoist,now=new Date()){
 const account=await fetchTodoist("/user");
 if(!account?.id)throw new Error("Não foi possível confirmar a conta conectada ao Todoist.");
 let timezone=account.tz_info?.timezone||"America/Sao_Paulo";
 try{todayISO(timezone,now)}catch{timezone="America/Sao_Paulo"}
 const all=new Map<string,any>(),seenCursors=new Set<string>();
 let cursor:string|null=null,pages=0;
 do{
  const qs=new URLSearchParams({limit:"200"});if(cursor)qs.set("cursor",cursor);
  const page=await fetchTodoist("/tasks?"+qs.toString());
  const items=Array.isArray(page)?page:Array.isArray(page?.results)?page.results:Array.isArray(page?.items)?page.items:null;
  if(!items)throw new Error("Resposta do Todoist incompleta. A lista não foi confirmada.");
  for(const task of items){
   if(task?.id==null)throw new Error("O Todoist retornou uma tarefa sem identificação.");
   if(task.is_completed||task.checked||task.is_deleted)continue;
   all.set(String(task.id),task);
  }
  cursor=Array.isArray(page)?null:page.next_cursor??null;pages++;
  if(cursor&&(seenCursors.has(cursor)||pages>=50))throw new Error("Leitura parcial do Todoist. Não foi possível conferir todas as tarefas.");
  if(cursor)seenCursors.add(cursor);
 }while(cursor);
 const today=todayISO(timezone,now);
 const normalized=[...all.values()].map((t:any)=>({
  id:String(t.id),content:t.content??"",description:t.description??"",
  priority:Number(t.priority??1),project_id:t.project_id??null,
  labels:t.labels??[],due:t.due??null,due_date:dueDate(t),url:t.url??null
 }));
 const groups={
  today:normalized.filter(t=>t.due_date===today),
  overdue:normalized.filter(t=>t.due_date&&t.due_date<today),
  upcoming:normalized.filter(t=>t.due_date&&t.due_date>today).sort((a,b)=>a.due_date.localeCompare(b.due_date)),
  priority:normalized.filter(t=>t.priority>=3).sort((a,b)=>b.priority-a.priority),
  no_due:normalized.filter(t=>!t.due_date).sort((a,b)=>b.priority-a.priority||a.content.localeCompare(b.content)),
  all:normalized
 };
 return {groups,sync:{complete:true,checked_at:new Date().toISOString(),timezone,task_count:normalized.length,pages,
  account:{id:String(account.id),email:account.email||null,name:account.full_name||null}}};
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors(req)});
  if(req.method!=="POST") return json(req,{error:"Método não permitido."},405);
  try{
    const auth=req.headers.get("Authorization")??"";
    if(!auth.startsWith("Bearer ")) return json(req,{error:"Sessão ausente."},401);
    const publishables=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")??"{}");
    const key=publishables.default??Deno.env.get("SUPABASE_ANON_KEY")??"";
    const sb=createClient(Deno.env.get("SUPABASE_URL")??"",key,{global:{headers:{Authorization:auth}},auth:{persistSession:false}});
    const token=auth.replace("Bearer ","");
    const {data:{user},error}=await sb.auth.getUser(token);
    if(error||!user) return json(req,{error:"Sessão inválida."},401);

    const body=await req.json().catch(()=>({}));
    const action=String(body.action??"list");

    if(action==="list")return json(req,await readTodoistTasks());
    if(action==="create"){
      const content=String(body.content??"").trim();
      if(!content) return json(req,{error:"Informe a tarefa."},400);
      const payload:any={content};
      if(body.description) payload.description=String(body.description);
      if(body.due_string) payload.due_string=String(body.due_string);
      if(body.due_date) payload.due_date=String(body.due_date);
      if(body.priority) payload.priority=Number(body.priority);
      const data=await todoist("/tasks",{method:"POST",body:JSON.stringify(payload)});
      return json(req,{task:data});
    }
    if(action==="update"){
      const id=encodeURIComponent(String(body.id??""));
      if(!id) return json(req,{error:"ID ausente."},400);
      const payload:any={};
      for(const k of ["content","description","due_string","due_date","priority"]) if(body[k]!==undefined && body[k]!==null && body[k]!=="") payload[k]=k==="priority"?Number(body[k]):body[k];
      const data=await todoist("/tasks/"+id,{method:"POST",body:JSON.stringify(payload)});
      return json(req,{task:data});
    }
    if(action==="close"){
      const id=encodeURIComponent(String(body.id??""));
      if(!id) return json(req,{error:"ID ausente."},400);
      await todoist("/tasks/"+id+"/close",{method:"POST"});
      return json(req,{ok:true});
    }
    return json(req,{error:"Ação inválida."},400);
  }catch(e){
    const msg=e instanceof Error?e.message:"Erro inesperado.";
    if(msg==="TODOIST_API_TOKEN_NOT_CONFIGURED") return json(req,{error:"Todoist ainda não conectado. Configure TODOIST_API_TOKEN nos Secrets do Supabase."},503);
    return json(req,{error:msg},500);
  }
});
