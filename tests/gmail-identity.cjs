const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {stripTypeScriptTypes}=require('node:module');
const source=fs.readFileSync(require('node:path').join(__dirname,'../supabase/functions/google-scan/index.ts'),'utf8');
for(const path of ['google-scan.ts','slack-fetch.ts','james-summary.ts']){
 const code=stripTypeScriptTypes(fs.readFileSync(require('node:path').join(__dirname,'../supabase/functions',path.replace('.ts',''),'index.ts'),'utf8').replace(/^import .*;\n/gm,''));new vm.Script(code);
}
const helper=source.slice(source.indexOf('function gmailMessageForItem('),source.indexOf('Deno.serve('));
const ctx=vm.createContext({console});vm.runInContext(stripTypeScriptTypes(helper),ctx);
const message={id:'fixed-message',threadId:'thread',url:'https://mail.test/fixed-message',from:'Pessoa',subject:'Assunto'};
let rows=[],race=null;
const admin={from(){return {
 async upsert(row){if(!rows.some(r=>r.user_id===row.user_id&&r.fingerprint===row.fingerprint))rows.push({...row,status_locked:false,responsible_locked:false,hidden_at:null});return {}},
 update(patch){let filters=[];const q={eq(k,v){filters.push([k,v]);return this},is(k,v){filters.push([k,v]);return this},then(resolve){if(race)race(patch);for(const r of rows)if(filters.every(([k,v])=>r[k]===v))Object.assign(r,patch);resolve({})}};return q}
}}};
const item={source_ref:message.id,fingerprint:'model-invented-one',status:'needs_me',responsible:'IA',title:'Ação'};
(async()=>{
 await ctx.persistGmailItem(admin,'owner',item,message);
 rows[0].status='treated';rows[0].status_locked=true;rows[0].treated_at='completion-date';rows[0].responsible='Pessoa escolhida';rows[0].responsible_locked=true;
 await ctx.persistGmailItem(admin,'owner',{...item,fingerprint:'different-model-name'},message);
 assert.equal(rows.length,1);assert.equal(rows[0].fingerprint,'gmail:fixed-message');assert.equal(rows[0].status,'treated');assert.equal(rows[0].treated_at,'completion-date');assert.equal(rows[0].responsible,'Pessoa escolhida');
 rows[0].status_locked=false;rows[0].status='needs_me';rows[0].responsible_locked=false;
 race=patch=>{if('status' in patch){rows[0].status='treated';rows[0].status_locked=true;rows[0].treated_at='manual-during-scan'}if('responsible' in patch){rows[0].responsible='manual-during-scan';rows[0].responsible_locked=true}};
 await ctx.persistGmailItem(admin,'owner',item,message);
 assert.equal(rows[0].status,'treated');assert.equal(rows[0].treated_at,'manual-during-scan');assert.equal(rows[0].responsible,'manual-during-scan');
 assert.equal(ctx.gmailMessageForItem({source_ref:'not-a-message'},[message]),undefined);
 assert.equal(ctx.gmailMessageForItem({source_ref:'thread',source_url:message.url},[message]).id,message.id);
 const slack=fs.readFileSync(require('node:path').join(__dirname,'../supabase/functions/slack-fetch/index.ts'),'utf8');assert(slack.includes('toLowerCase()!=="botafogo_sac"'));
 console.log('PASS: stable Gmail identity; no model fingerprint duplicates; completion and responsible locks preserved during concurrent scans; invalid sources rejected; Slack exclusion; Edge Function syntax.');
})().catch(e=>{console.error(e);process.exitCode=1});
