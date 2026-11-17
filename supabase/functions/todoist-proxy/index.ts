// Retired external integration. Old clients must refresh instead of importing
// account-wide external tasks or creating anything in the external service.
const headers={
 'Access-Control-Allow-Origin':'https://danypuravida.github.io',
 'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
 'Access-Control-Allow-Methods':'POST, OPTIONS',
 'Content-Type':'application/json; charset=utf-8',
 'Cache-Control':'no-store'
};
Deno.serve((req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 return new Response(JSON.stringify({code:'EXTERNAL_TASKS_DISABLED',provider:'danielle-os',error:'A integração externa foi desativada. Reabra o Danielle OS para usar a área Tarefas, independente de outro aplicativo.'}),{status:410,headers});
});
