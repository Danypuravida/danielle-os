const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]);
for(const script of scripts) new vm.Script(script);
const helper=html.slice(html.indexOf('function buildSlackTriageQuestion('),html.indexOf('async function saveSlackTriage('));
const batch=html.slice(html.indexOf('const SLACK_TRIAGE_MAX_CHARS='),html.indexOf('const jamesTriageOriginal='));
const save=html.slice(html.indexOf('async function saveSlackTriage('),html.indexOf('async function scanSlackLive('));
const override=html.slice(html.indexOf('const jamesTriageOriginal='),html.indexOf('const jamesGoogleStatusOriginal='));
const ctx=vm.createContext({console,setTextSafe(){},currentUserId:'owner',parseLooseJson:JSON.parse,renderJamesHealth(){},jamesHealth:{}});
vm.runInContext(helper+batch+save+override,ctx);
const msg=(id,text,channel='channel')=>({channel_id:channel,ts:String(id),sender_name:'Nathália Mesquita',text,thread_replies:null,from_me:false,nathalia:true,source_url:'https://slack.test/'+id});
const messages=Array.from({length:153},(_,i)=>msg(i,'ação pendente '.repeat(i%5*30),'channel'+i%3));
messages.push(msg(999,'texto com \\" aspas\n😀'.repeat(1800)));
messages.push({...msg(1000,'mensagem raiz'),thread_replies:JSON.stringify(Array.from({length:30},(_,i)=>({ts:i,text:'resposta longa '.repeat(90)})))});
const batches=ctx.buildSlackTriageBatches(messages);
assert(batches.length>1);
for(const b of batches)assert(ctx.buildSlackTriageQuestion(b).length<=7800);
for(const m of messages){
 const copies=batches.flat().filter(x=>x.channel_id===m.channel_id&&x.ts===m.ts);
 assert(copies.length,'missing message '+m.ts);
 if(!copies[0].context_fragment){assert(copies.some(x=>JSON.stringify(x)===JSON.stringify(m)));continue;}
 for(const field of ['text','thread_replies']){
  const pieces=[...new Map(copies.filter(x=>x.fragment_field===field).map(x=>[x.fragment_offset,x])).values()].sort((a,b)=>a.fragment_offset-b.fragment_offset);
  assert.equal(pieces.map(x=>x[field]).join(''),String(m[field]||''));
 }
}
assert.equal(ctx.buildSlackTriageBatches([]).length,0);
let saved=[],edgeCalls=[];
const old={id:'kept',status:'treated',status_locked:true,responsible:'Pessoa escolhida',responsible_locked:true,treated_at:'2026-10-01T00:00:00Z'};
ctx.sb={from(){return {select(){return this},eq(){return this},async maybeSingle(){return {data:old}},update(row){saved.push(row);return {eq(){return this},then(resolve){resolve({})}}},async upsert(row){saved.push(row);return {}}}}};
ctx.callManagementAdvisor=async(_,q)=>{assert(q.length<=8000);return JSON.stringify({items:[{source_ref:'channel:1',status:'needs_me',responsible:'Outra pessoa'}]})};
ctx.callEdge=async(name,body)=>{edgeCalls.push(body?.action||'read');return {messages:[msg(1,'precisa agir')],partial:false}};
(async()=>{
 await ctx.scanSlackLive();
 assert.deepEqual(edgeCalls,['read','confirm_triage']);
 assert(!('status' in saved[0]));assert(!('responsible' in saved[0]));assert(!('treated_at' in saved[0]));
 assert.equal(old.status,'treated');assert.equal(old.responsible,'Pessoa escolhida');
 edgeCalls=[];ctx.callManagementAdvisor=async()=>{throw new Error('análise falhou')};
 await assert.rejects(ctx.scanSlackLive(),/análise falhou/);
 assert.deepEqual(edgeCalls,['read']);
 console.log('PASS: JavaScript syntax; bounded batches; all 155 messages and long fragments retained; manual locks and completion date; checkpoint only after successful analysis.');
})().catch(e=>{console.error(e);process.exitCode=1});
