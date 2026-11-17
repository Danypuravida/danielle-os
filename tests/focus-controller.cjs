const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {dayOf}=require('../focus-workspace.js');
class Node{
 constructor(id){this.id=id;this.value='';this.textContent='';this.innerHTML='';this.dataset={};this.hidden=false;this.disabled=false;this.listeners={};this.style={setProperty(){}};}
 addEventListener(name,fn){this.listeners[name]=fn;}setAttribute(){}reportValidity(){return true;}focus(){}scrollIntoView(){}
}
const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,new Node(id));return nodes.get(id);};
const today=dayOf(Date.now()),tables={focus_settings:[],focus_sessions:[],focus_task_plans:[]},reads=[],writes=[],storage=new Map();
let uid='owner',offline=false,sequence=0;
const tasks=[{id:'a',content:'PRIVATE TASK A',due_date:today,priority:1},{id:'b',content:'PRIVATE TASK B',priority:1}];
const sb={async rpc(){return {data:{session:null,server_now:new Date().toISOString(),conflict:false},error:null};},from(table){let mode='read',payload,single=false,filters=[];const q={select(){return q},eq(k,v){filters.push([k,v]);return q},gte(){return q},lte(){return q},lt(){return q},or(){return q},order(){return q},range(){return q},maybeSingle(){single=true;return q},single(){single=true;return q},upsert(p){mode='write';payload=p;return q},then(ok,bad){let data;if(mode==='write'){
 if(offline)return Promise.resolve({data:null,error:{message:'offline'}}).then(ok,bad);
 writes.push({table,payload:{...payload}});const keys=table==='focus_task_plans'?['user_id','day','task_id']:['user_id'];let row=tables[table].find(r=>keys.every(k=>r[k]===payload[k]));if(!row){row={};tables[table].push(row);}Object.assign(row,payload);data={...row};
 }else{reads.push({table,filters});data=tables[table].filter(r=>filters.every(([k,v])=>r[k]===v));if(single)data=data[0]||null;}
 return Promise.resolve({data,error:null}).then(ok,bad);}};return q;}};
const win={listeners:{},addEventListener(name,fn){this.listeners[name]=fn;}};
const ctx={window:win,document:{title:'Danielle OS',visibilityState:'visible',activeElement:null,getElementById:node,querySelector:s=>s==='.page.active'?{dataset:{page:'todoist'}}:node(s),querySelectorAll:()=>[],addEventListener(){}},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},sb,Intl,Date,console,crypto:{randomUUID:()=> 'id-'+(++sequence)},setInterval(){},clearInterval(){},
 get currentUserId(){return uid;},todoistReadRevision:0,
 async todoistCall(p={}){if(p.action==='close'){ctx.todoistReadRevision++;return {ok:true};}return {groups:{all:tasks},sync:{provider:'danielle-os',complete:true}};},
 todoistSyncText:()=> 'PRIVATE OWNER ACCOUNT',async loadTodoistTasks(){return ctx.todoistCall({action:'list'});},async closeTodoistTask(id){return ctx.todoistCall({action:'close',id});}};
async function run(){
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'../focus-workspace.js'),'utf8'),ctx);
 await ctx.loadTodoistTasks();await win.FocusWorkspace.load();
 node('fpTaskPicker').value='b';node('fpAddPlan').listeners.click();await new Promise(setImmediate);
 assert.equal(tables.focus_task_plans.length,1,'An initial empty queue cannot leave the plan synchronizer stuck');
 const edit={target:{dataset:{fpEstimate:'b'},value:'45',reportValidity:()=>true}};
 node('fpTasks').listeners.change(edit);await new Promise(setImmediate);
 assert.equal(tables.focus_task_plans[0].estimated_minutes,45);
 assert(!Object.hasOwn(writes.at(-1).payload,'completed_at'),'Editing estimates must not clear a completion from another device');
 offline=true;edit.target.value='60';node('fpTasks').listeners.change(edit);await new Promise(setImmediate);
 assert.equal(tables.focus_task_plans[0].estimated_minutes,45);assert(storage.get('danielle-focus-v2:owner').includes('estimated_minutes":60'),'Offline plan edits remain queued on the correct owner');
 offline=false;await win.FocusWorkspace.load();assert.equal(tables.focus_task_plans[0].estimated_minutes,60);
 await ctx.todoistCall({action:'close',id:'b'});await new Promise(setImmediate);
 assert(tables.focus_task_plans[0].completed_at,'Only confirmed Todoist completion is recorded');
 assert(reads.every(r=>r.filters.some(([k])=>k==='user_id')),'Every cloud read is explicitly scoped to its owner');
 uid='other';await win.FocusWorkspace.load();
 assert(!node('fpTasks').innerHTML.includes('PRIVATE TASK'));
 assert(!node('fpSync').textContent.includes('PRIVATE OWNER'),'Account switching clears the previous account label as well as tasks');
 console.log('PASS: cloud plan writes, sparse updates, offline retry, confirmed completion, owner-scoped queries and account isolation.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
