const assert=require('node:assert/strict');
const {makeService,snapshot,dueDate}=require('../native-tasks.js');
const tables={os_tasks:[],os_task_lists:[]},queries=[];let owner='owner-a',sequence=0;
const client=()=>({from(table){let mode='read',payload,filters=[],single=false,range=[0,999];const q={select(){return q},eq(k,v){filters.push([k,v]);return q},order(){return q},range(a,b){range=[a,b];return q},single(){single=true;return q},upsert(p){mode='create';payload=p;return q},update(p){mode='update';payload=p;return q},then(ok,bad){queries.push({table,mode,filters,payload});let data;
 if(mode==='create'){const exists=tables[table].some(r=>r.id===payload.id);if(exists)data=[];else{const row={status:'open',completed_at:null,archived_at:null,description:'',priority:1,...payload};tables[table].push(row);data=[row];}}
 else if(mode==='update'){data=tables[table].filter(r=>filters.every(([k,v])=>r[k]===v));data.forEach(r=>Object.assign(r,payload));}
 else data=tables[table].filter(r=>filters.every(([k,v])=>r[k]===v)).sort((a,b)=>a.id.localeCompare(b.id)).slice(range[0],range[1]+1);
 return Promise.resolve({data:single?data[0]||null:data,error:null}).then(ok,bad);}};return q;}});
async function run(){
 const service=makeService(client,()=>owner);
 let list=await service.call();assert.equal(list.groups.all.length,0);assert.equal(list.lists.length,0,'No template lists or external data are imported');assert.equal(list.sync.provider,'danielle-os');
 const project=(await service.call({action:'create_list',name:'Meu trabalho',id:'list-a'})).list;
 const task=(await service.call({action:'create',id:'task-a',content:'Entrega minha',list_id:project.id,due_date:'2026-11-17',priority:4})).task;
 assert.equal(task.user_id,'owner-a');assert.equal(task.list_id,'list-a');
 await service.call({action:'close',id:'task-a'});list=await service.call();assert.equal(list.groups.all.length,0);assert.equal(list.records[0].status,'completed','Completed tasks are retained in the archive');
 const retry=await service.call({action:'create',id:'task-a',content:'Retry after lost response'});assert.equal(retry.task.status,'completed','A retried create never resets a completion');assert.equal(tables.os_tasks.length,1);
 await service.call({action:'reopen',id:'task-a'});assert.equal((await service.call()).groups.all.length,1);
 await service.call({action:'archive',id:'task-a'});assert.equal((await service.call()).groups.all.length,0);assert.equal(tables.os_tasks.length,1,'Archiving is reversible');
 await service.call({action:'restore',id:'task-a'});assert.equal((await service.call()).groups.all.length,1);
 const meeting1=await service.call({action:'create',source_ref:'meeting:one:action',content:'Ação da reunião'});const meeting2=await service.call({action:'create',source_ref:'meeting:one:action',content:'Ação da reunião'});assert.equal(meeting1.task.id,meeting2.task.id,'Repeated meeting saves create one task');
 owner='owner-b';assert.equal((await service.call()).records.length,0);await assert.rejects(service.call({action:'update',id:'task-a',content:'Not mine'}),/não está disponível/);
 const meetingOther=await service.call({action:'create',source_ref:'meeting:one:action',content:'Outra pessoa'});assert.notEqual(meetingOther.task.id,meeting1.task.id);
 assert(queries.filter(q=>q.mode==='read'||q.mode==='update').every(q=>q.filters.some(([k])=>k==='user_id')),'Every query and update is scoped to its owner');
 owner=null;await assert.rejects(service.call(),/Entre na sua conta/);
 assert.equal(dueDate('amanhã','2026-12-31'),'2027-01-01');assert.equal(dueDate(''),null);assert.throws(()=>dueDate('2026-02-31'),/data válida/);
 const many=Array.from({length:1007},(_,i)=>({id:'many-'+String(i).padStart(4,'0'),user_id:'paged-owner',content:'Tarefa '+i,status:'open',priority:1}));tables.os_tasks.push(...many);owner='paged-owner';assert.equal((await service.call()).groups.all.length,1007,'No hidden limit loses user-created tasks');
 assert(!JSON.stringify(snapshot([],[],'owner')).includes('account'),'No external account is required');
 console.log('PASS: empty native workspace, own lists/tasks, completion and reopening, reversible archives, idempotent creates, meeting deduplication, owner isolation and full pagination.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
