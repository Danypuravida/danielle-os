
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const ORIGINS = new Set(["https://danypuravida.github.io","http://localhost:3000","http://127.0.0.1:5500"]);
function h(req:Request){
  const origin=req.headers.get("origin")??"";
  return {
    "Access-Control-Allow-Origin":ORIGINS.has(origin)?origin:"https://danypuravida.github.io",
    "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods":"POST, OPTIONS",
    "Content-Type":"application/json; charset=utf-8",
    "Vary":"Origin"
  };
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:h(req)});
  const auth=req.headers.get("Authorization")??"";
  if(!auth.startsWith("Bearer ")) return new Response(JSON.stringify({connected:false}),{status:401,headers:h(req)});

  const keys=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")??"{}");
  const key=keys.default??Deno.env.get("SUPABASE_ANON_KEY")??"";
  const sb=createClient(Deno.env.get("SUPABASE_URL")??"",key,{
    global:{headers:{Authorization:auth}},
    auth:{persistSession:false}
  });

  const {data,error}=await sb.rpc("get_my_slack_connection_status");
  if(error) return new Response(JSON.stringify({connected:false,error:error.message}),{status:500,headers:h(req)});
  const row=Array.isArray(data)?data[0]:null;
  const {data:{user}}=await sb.auth.getUser(auth.slice(7));
  if(!user)return new Response(JSON.stringify({connected:false}),{status:401,headers:h(req)});
  const admin=createClient(Deno.env.get("SUPABASE_URL")??"",Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"",{auth:{persistSession:false}});
  const {data:mode,error:modeError}=await admin.from("slack_connections").select("last_triage_mode").eq("user_id",user.id).maybeSingle();
  if(modeError)return new Response(JSON.stringify({error:"Falha ao conferir a última triagem."}),{status:500,headers:h(req)});
  return new Response(JSON.stringify(row?{...row,last_triage_mode:mode?.last_triage_mode||null}:{connected:false}),{headers:h(req)});
});
