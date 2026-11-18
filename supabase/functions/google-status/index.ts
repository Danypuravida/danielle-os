
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
function cors(req:Request){const o=req.headers.get("origin")??"";const a=["https://danypuravida.github.io","http://localhost:3000","http://127.0.0.1:5500"].includes(o)?o:"https://danypuravida.github.io";return {"Access-Control-Allow-Origin":a,"Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json","Vary":"Origin"}}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors(req)});
 const auth=req.headers.get("Authorization")??""; if(!auth.startsWith("Bearer "))return new Response(JSON.stringify({connected:false}),{status:401,headers:cors(req)});
 const pub=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")??"{}").default??Deno.env.get("SUPABASE_ANON_KEY")??"";
 const sb=createClient(Deno.env.get("SUPABASE_URL")??"",pub,{global:{headers:{Authorization:auth}},auth:{persistSession:false}});
 const {data:{user}}=await sb.auth.getUser(auth.slice(7)); if(!user)return new Response(JSON.stringify({connected:false}),{status:401,headers:cors(req)});
 const admin=createClient(Deno.env.get("SUPABASE_URL")??"",Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"",{auth:{persistSession:false}});
 const {data}=await admin.from("google_connections").select("google_email,connected_at,last_scan_at,last_error,last_triage_mode").eq("user_id",user.id).maybeSingle();
 return new Response(JSON.stringify({connected:!!data,...(data||{})}),{headers:cors(req)});
});
