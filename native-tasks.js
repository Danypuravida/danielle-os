/* Native Danielle OS tasks. No external task account, token or fallback. */
(function(){
 'use strict';
 const TZ='America/Sao_Paulo';
 const day=()=>new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function dueDate(value,today=day()){
  if(value==null||String(value).trim()==='')return null;
  const text=String(value).trim().toLowerCase();if(text==='hoje')return today;
  if(['amanhã','amanha'].includes(text))return new Date(Date.parse(today+'T12:00:00Z')+86400000).toISOString().slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(text)||!Number.isFinite(Date.parse(text+'T12:00:00Z'))||new Date(text+'T12:00:00Z').toISOString().slice(0,10)!==text)throw new Error('Escolha uma data válida para a tarefa.');
  return text;
 }
 function snapshot(records,lists,owner,today=day()){
  const normalized=records.map(r=>({...r,id:String(r.id),project_id:r.list_id||null,due:r.due_date?{date:r.due_date,string:r.due_date}:null,is_completed:r.status==='completed'}));
  const all=normalized.filter(r=>r.status==='open'&&!r.archived_at);
  return {records:normalized,lists,groups:{all,today:all.filter(r=>r.due_date===today),overdue:all.filter(r=>r.due_date&&r.due_date<today),upcoming:all.filter(r=>r.due_date&&r.due_date>today).sort((a,b)=>a.due_date.localeCompare(b.due_date)),priority:all.filter(r=>r.priority>=3).sort((a,b)=>b.priority-a.priority),no_due:all.filter(r=>!r.due_date)},sync:{provider:'danielle-os',user_id:owner,complete:true,checked_at:new Date().toISOString(),timezone:TZ,task_count:all.length}};
 }
 function makeService(client,getOwner){
  async function readAll(table,owner){const map=new Map();for(let from=0;;from+=1000){const {data,error}=await client().from(table).select('*').eq('user_id',owner).order('id').range(from,from+999);if(error)throw error;for(const r of data||[])map.set(r.id,r);if(!data||data.length<1000)return [...map.values()];}}
  function failure(error){if(error?.code==='23505')return new Error('Já existe uma lista com esse nome.');return new Error(error?.message||'Não consegui salvar. Tente novamente.');}
  async function call(body={}){
   const owner=getOwner();if(!owner)throw new Error('Entre na sua conta do Danielle OS.');
   const action=body.action||'list';
   if(action==='list'){
    const [records,lists]=await Promise.all([readAll('os_tasks',owner),readAll('os_task_lists',owner)]);
    if(owner!==getOwner())throw new Error('Sua sessão mudou. Atualize as tarefas.');return snapshot(records,lists,owner);
   }
   const listAction=['create_list','update_list','archive_list','restore_list'].includes(action),table=listAction?'os_task_lists':'os_tasks';
   const creating=action==='create'||action==='create_list';let id=body.id;
   if(creating&&!id&&body.source_ref){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(owner+':'+body.source_ref));const hex=[...new Uint8Array(bytes)].slice(0,16).map(x=>x.toString(16).padStart(2,'0')).join('');id=hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);}
   if(!id&&creating)id=crypto.randomUUID();if(!id)throw new Error('Escolha a tarefa ou lista que quer alterar.');
   let patch={updated_at:new Date().toISOString()};
   if(['create','update'].includes(action)){
    if(body.content!==undefined){patch.content=String(body.content).trim();if(!patch.content||patch.content.length>500)throw new Error('Informe uma tarefa com até 500 caracteres.');}
    if(creating&&!patch.content)throw new Error('Informe a tarefa.');
    if(body.description!==undefined)patch.description=String(body.description);
    if(body.due_date!==undefined||body.due_string!==undefined)patch.due_date=dueDate(body.due_date??body.due_string);
    if(body.priority!==undefined){patch.priority=Number(body.priority);if(![1,2,3,4].includes(patch.priority))throw new Error('Escolha uma prioridade válida.');}
    if(body.list_id!==undefined||body.project_id!==undefined)patch.list_id=body.list_id||body.project_id||null;
   }else if(action==='close')patch={...patch,status:'completed',completed_at:new Date().toISOString()};
   else if(action==='reopen')patch={...patch,status:'open',completed_at:null};
   else if(['archive','archive_list'].includes(action))patch.archived_at=new Date().toISOString();
   else if(['restore','restore_list'].includes(action))patch.archived_at=null;
   else if(['create_list','update_list'].includes(action)){patch.name=String(body.name||'').trim();if(!patch.name||patch.name.length>100)throw new Error('Informe um nome de lista com até 100 caracteres.');}
   else throw new Error('Ação de tarefas não reconhecida.');
   let query=creating?client().from(table).upsert({id,user_id:owner,...patch},{onConflict:'id',ignoreDuplicates:true}).select():client().from(table).update(patch).eq('user_id',owner).eq('id',id).select();
   let {data,error}=await query;if(error)throw failure(error);
   let row=data?.[0];
   if(creating&&!row){const result=await client().from(table).select('*').eq('user_id',owner).eq('id',id).single();if(result.error)throw failure(result.error);row=result.data;}
   if(!row)throw new Error('Esse registro não está disponível na sua conta. Atualize a lista.');
   if(owner!==getOwner())throw new Error('Sua sessão mudou. Atualize as tarefas.');
   return listAction?{ok:true,list:row}:{ok:true,task:row};
  }
  return {call};
 }
 if(typeof module!=='undefined'&&module.exports)module.exports={makeService,snapshot,dueDate};
 if(typeof window==='undefined')return;
 const getOwner=()=>typeof currentUserId==='undefined'?null:currentUserId;
 const service=makeService(()=>sb,getOwner);
 const state={owner:null,data:null,view:'all',list:null,editing:null,listEditing:null,saving:false,request:0};
 const el=id=>document.getElementById(id);
 const api={call:service.call,render,openEditor};window.NativeTasks=api;
 function status(text){const node=el('ntStatus');if(node)node.textContent=text;}
 function currentRows(){
  const data=state.data;if(!data)return [];const query=(el('ntSearch')?.value||'').trim().toLocaleLowerCase('pt-BR'),today=day();
  return data.records.filter(t=>{
   if(state.view==='archived'){if(!t.archived_at)return false;}else{if(t.archived_at)return false;if(state.view==='completed'){if(t.status!=='completed')return false;}else if(t.status!=='open')return false;}
   if(state.view==='today'&&(!t.due_date||t.due_date>today))return false;
   if(state.view==='upcoming'&&(!t.due_date||t.due_date<=today))return false;
   if(state.list==='inbox'&&t.list_id)return false;if(state.list&&state.list!=='inbox'&&t.list_id!==state.list)return false;
   return !query||(t.content+' '+t.description).toLocaleLowerCase('pt-BR').includes(query);
  }).sort((a,b)=>state.view==='completed'?String(b.completed_at).localeCompare(String(a.completed_at)):b.priority-a.priority||String(a.due_date||'9999').localeCompare(String(b.due_date||'9999'))||a.content.localeCompare(b.content));
 }
 function render(data){
  if(!el('ntTasks'))return;
  const owner=getOwner();if(state.owner!==owner){state.owner=owner;state.data=null;state.list=null;state.editing=null;state.listEditing=null;state.request++;if(el('ntEditor').open)el('ntEditor').close();if(el('ntListEditor').open)el('ntListEditor').close();}
  if(data&&data.sync?.user_id===owner&&data.sync?.provider==='danielle-os')state.data=data;
  const lists=state.data?.lists||[],all=state.data?.groups.all||[];
  el('ntLists').innerHTML='<button data-nt-list="inbox" aria-pressed="'+(state.list==='inbox')+'">Caixa de entrada <small>'+all.filter(t=>!t.list_id).length+'</small></button>'+lists.filter(l=>!l.archived_at).map(l=>'<button data-nt-list="'+escape(l.id)+'" aria-pressed="'+(state.list===l.id)+'">'+escape(l.name)+' <small>'+all.filter(t=>t.list_id===l.id).length+'</small></button>').join('');
  el('ntArchivedLists').innerHTML=lists.filter(l=>l.archived_at).map(l=>'<button class="nt-link" data-nt-restore-list="'+escape(l.id)+'">Restaurar '+escape(l.name)+'</button>').join('');
  const selected=lists.find(l=>l.id===state.list);el('ntTitle').textContent=state.view==='completed'?'Concluídas':state.view==='archived'?'Arquivadas':state.list==='inbox'?'Caixa de entrada':selected?.name||({today:'Hoje e atrasadas',upcoming:'Próximas',all:'Todas as tarefas'})[state.view];
  el('ntEditList').hidden=!selected||!!selected.archived_at;
  document.querySelectorAll('[data-nt-view]').forEach(b=>b.setAttribute('aria-pressed',String(state.view===b.dataset.ntView&&!state.list)));
  const rows=currentRows();el('ntCount').textContent=rows.length+' tarefa'+(rows.length===1?'':'s');
  el('ntTasks').innerHTML=rows.length?rows.map(t=>{
   const list=lists.find(l=>l.id===t.list_id);const date=t.due_date?t.due_date.slice(8,10)+'/'+t.due_date.slice(5,7):'Sem prazo';
   return '<article class="nt-task" data-completed="'+(t.status==='completed')+'"><input type="checkbox" data-nt-toggle="'+escape(t.id)+'" aria-label="'+(t.status==='completed'?'Reabrir ':'Concluir ')+escape(t.content)+'" '+(t.status==='completed'?'checked':'')+' '+(t.archived_at?'disabled':'')+'><div><strong>'+escape(t.content)+'</strong><p>'+escape(date)+(list?' · '+escape(list.name):' · Caixa de entrada')+(t.priority>1?' · P'+(5-t.priority):'')+'</p>'+(t.description?'<p class="nt-description">'+escape(t.description)+'</p>':'')+'<div class="nt-task-actions">'+(t.archived_at?'<button data-nt-action="restore" data-id="'+escape(t.id)+'">Restaurar</button>':'<button data-nt-action="edit" data-id="'+escape(t.id)+'">Editar</button><button data-nt-action="archive" data-id="'+escape(t.id)+'">Arquivar</button>')+'</div></div></article>';
  }).join(''):'<div class="nt-empty"><strong>'+(state.view==='completed'?'Suas tarefas concluídas ficam aqui':state.view==='archived'?'Nenhuma tarefa arquivada':'Uma lista que começa com você')+'</strong><p>'+(state.view==='completed'?'Marcou como concluída? Ela continua salva e pode ser reaberta.':state.view==='archived'?'Arquivar tira a tarefa da rotina e permite restaurá-la depois.':'Crie uma tarefa ou uma lista. Só entra aqui o que você registrar no Danielle OS.')+'</p><button class="fp-btn fp-primary" data-nt-action="new">＋ Nova tarefa</button></div>';
 }
 async function refresh(){const owner=getOwner(),request=++state.request;try{const data=await todoistCall({action:'list'});if(owner===getOwner()&&request===state.request){render(data);status('Salvo na sua conta do Danielle OS.');}}catch(error){status(error.message);}}
 async function afterWrite(){await Promise.allSettled([loadTodoistTasks(),loadJamesTodoist()]);await refresh();}
 function openEditor(id=null){
  if(!getOwner()||state.saving)return;const task=id?state.data?.records.find(t=>t.id===id):null;if(id&&!task)return;
  state.editorOwner=getOwner();state.editing=id||crypto.randomUUID();el('ntForm').reset();el('ntEditorTitle').textContent=task?'Editar tarefa':'Nova tarefa';
  el('ntContent').value=task?.content||'';el('ntDescription').value=task?.description||'';el('ntDue').value=task?task.due_date||'':el('fpDay')?.value||day();el('ntPriority').value=task?.priority||1;
  const lists=state.data?.lists||[];el('ntList').innerHTML='<option value="">Caixa de entrada</option>'+lists.filter(l=>!l.archived_at||l.id===task?.list_id).map(l=>'<option value="'+escape(l.id)+'">'+escape(l.name)+'</option>').join('');el('ntList').value=task?.list_id||(state.list&&state.list!=='inbox'?state.list:'');el('ntEditorStatus').textContent='';el('ntEditor').showModal();
 }
 function openList(id=null){if(state.saving||!getOwner())return;state.listOwner=getOwner();state.listEditing=id||crypto.randomUUID();el('ntListName').value=state.data?.lists.find(l=>l.id===id)?.name||'';el('ntListEditorTitle').textContent=id?'Editar lista':'Nova lista';el('ntArchiveList').hidden=!id;el('ntListStatus').textContent='';el('ntListEditor').showModal();}
 async function changeTask(action,id){try{await todoistCall({action,id});await afterWrite();status(action==='close'?'Tarefa concluída e guardada em Concluídas.':action==='reopen'?'Tarefa reaberta.':'Alteração salva.');}catch(error){status(error.message);render();}}
 function mount(){
  if(!el('ntTasks'))return;
  el('ntForm').addEventListener('submit',async event=>{
   event.preventDefault();if(state.editorOwner!==getOwner()){render();return;}if(state.saving||!el('ntForm').reportValidity())return;state.saving=true;el('ntSave').disabled=true;const owner=getOwner();
   try{const exists=state.data?.records.some(t=>t.id===state.editing);await todoistCall({action:exists?'update':'create',id:state.editing,content:el('ntContent').value,description:el('ntDescription').value,due_date:el('ntDue').value,priority:Number(el('ntPriority').value),list_id:el('ntList').value||null});if(getOwner()!==owner)return;el('ntEditor').close();await afterWrite();}
   catch(error){el('ntEditorStatus').textContent=error.message;}finally{state.saving=false;el('ntSave').disabled=false;}
  });
  el('ntListForm').addEventListener('submit',async event=>{event.preventDefault();if(state.listOwner!==getOwner()){render();return;}if(state.saving||!el('ntListForm').reportValidity())return;const exists=state.data?.lists.some(l=>l.id===state.listEditing);state.saving=true;el('ntListSave').disabled=true;try{const result=await todoistCall({action:exists?'update_list':'create_list',id:state.listEditing,name:el('ntListName').value});state.list=result.list.id;state.view='all';el('ntListEditor').close();await afterWrite();}catch(error){el('ntListStatus').textContent=error.message;}finally{state.saving=false;el('ntListSave').disabled=false;}});
  el('ntArchiveList').addEventListener('click',async()=>{if(!confirm('Arquivar esta lista? As tarefas continuam em Todas as tarefas.'))return;try{await todoistCall({action:'archive_list',id:state.listEditing});state.list=null;el('ntListEditor').close();await afterWrite();}catch(error){el('ntListStatus').textContent=error.message;}});
  for(const [dialog,close]of [['ntEditor','ntClose'],['ntListEditor','ntListClose']]){el(close).addEventListener('click',()=>{if(!state.saving)el(dialog).close();});el(dialog).addEventListener('cancel',event=>{if(state.saving)event.preventDefault();});}
  el('ntSearch').addEventListener('input',()=>render());el('ntEditList').addEventListener('click',()=>openList(state.list));el('ntNewList').addEventListener('click',()=>openList());el('ntAdd').addEventListener('click',()=>openEditor());
  el('ntManager').addEventListener('click',event=>{
   const b=event.target.closest('[data-nt-view],[data-nt-list],[data-nt-restore-list],[data-nt-action]');if(!b)return;
   if(b.dataset.ntView){state.view=b.dataset.ntView;state.list=null;render();}
   if(b.dataset.ntList){state.list=b.dataset.ntList;state.view='all';render();}
   if(b.dataset.ntRestoreList)todoistCall({action:'restore_list',id:b.dataset.ntRestoreList}).then(afterWrite).catch(e=>status(e.message));
   if(b.dataset.ntAction==='new')openEditor();else if(b.dataset.ntAction==='edit')openEditor(b.dataset.id);else if(b.dataset.ntAction)changeTask(b.dataset.ntAction,b.dataset.id);
  });
  el('ntTasks').addEventListener('change',event=>{const id=event.target.dataset.ntToggle;if(!id)return;const task=state.data?.records.find(t=>t.id===id);if(!task)return;event.target.disabled=true;changeTask(task.status==='completed'?'reopen':'close',id);});
  render();if(getOwner())loadTodoistTasks().catch(()=>{});
  setInterval(()=>{if(state.owner!==getOwner()){render();if(getOwner())loadTodoistTasks().catch(()=>{});}},1000);
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();
