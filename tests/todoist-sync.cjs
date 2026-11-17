const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {stripTypeScriptTypes}=require('node:module');
const edgePath=process.env.TODOIST_EDGE_TEST_SOURCE||path.join(__dirname,'../supabase/functions/todoist-proxy/index.ts');
const htmlPath=process.env.TODOIST_HTML_TEST_SOURCE||path.join(__dirname,'../index.html');
const source=fs.readFileSync(edgePath,'utf8').replace(/^import .*;\n/gm,'');

const html=fs.readFileSync(htmlPath,'utf8');for(const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))new vm.Script(m[1]);
(async()=>{
 let handler;
 const edge=vm.createContext({Deno:{serve(fn){handler=fn}},Response,Request,fetch(){throw new Error('External task calls are forbidden')}});
 vm.runInContext(stripTypeScriptTypes(source),edge);
 const disabled=await handler(new Request('https://example.test/legacy-tasks',{method:'POST'}));
 assert.equal(disabled.status,410);assert.equal((await disabled.json()).code,'EXTERNAL_TASKS_DISABLED');
 assert(!source.includes('api.todoist.com'));assert(!source.includes('TODOIST_API_TOKEN'));
 const account={email:'danielle@example.test'};
 const nodes=new Map(['todoistStatus','todoToday','todoOverdue','todoUpcoming','todoPriority','todoNoDue','todoTop3'].map(id=>[id,{textContent:'',innerHTML:''}]));
 const single={groups:{today:[],overdue:[],upcoming:[],priority:[],no_due:[{id:'a',content:'Tarefa sem prazo',priority:1}],all:[{id:'a',content:'Tarefa sem prazo',priority:1}]},sync:{provider:'danielle-os',complete:true,checked_at:'2026-10-15T22:00:00Z',task_count:1,account:{email:account.email}}};
 let responses=single,requests=0,release;
 const ctx=vm.createContext({console,document:{getElementById(id){return nodes.get(id)}},esc:String,window:{NativeTasks:{render(){},async call(payload){requests++;if(release===null)await new Promise(resolve=>{release=resolve});return payload.action==='list'?responses:{ok:true}}}}});
 const core=html.slice(html.indexOf('let todoistListFlight='),html.indexOf('function todoTaskHtml('));
 const view=html.slice(html.indexOf('function todoTaskHtml('),html.indexOf('async function createTodoistTask('));vm.runInContext(core+view,ctx);
 release=null;const first=ctx.todoistCall({action:'list'}),second=ctx.todoistCall({action:'list'});await new Promise(setImmediate);assert.equal(requests,1);release();await Promise.all([first,second]);
 await ctx.loadTodoistTasks();assert(nodes.get('todoNoDue').innerHTML.includes('Tarefa sem prazo'));assert(nodes.get('todoistStatus').textContent.includes('Danielle OS'));assert(!nodes.get('todoistStatus').textContent.includes(account.email));assert(nodes.get('todoistStatus').textContent.includes('1 tarefa(s)'));
 await ctx.todoistCall({action:'close',id:'a'});responses={...single,groups:{today:[],overdue:[],upcoming:[],priority:[],no_due:[],all:[]},sync:{...single.sync,task_count:0}};await ctx.loadTodoistTasks();assert(!nodes.get('todoNoDue').innerHTML.includes('Tarefa sem prazo'));
 responses={groups:single.groups,sync:{complete:false}};await ctx.loadTodoistTasks();assert(nodes.get('todoistStatus').textContent.includes('não foi confirmada'));
 const todoistSection=html.slice(html.indexOf('<section class="page" data-page="todoist">'),html.indexOf('<section class="page" data-page="reunioes">'));assert(todoistSection.includes('id="todoNoDue"'));
 console.log('PASS: external integration retired; native adapter only; shared reads; completion refresh; partial reads rejected; frontend syntax and retained task containers.');
})().catch(e=>{console.error(e);process.exitCode=1});
