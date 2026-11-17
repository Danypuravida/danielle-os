/* Focus workspace: Danielle OS remains the task source; private plans and timer live in Supabase. */
(function(){
 'use strict';
 const TZ='America/Sao_Paulo',AREAS={work:'Trabalho',study:'Estudo',personal:'Pessoal',other:'Sem área'},DEFAULTS={focus_minutes:25,break_minutes:5,daily_goal:8};
 const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'});
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function localParts(time){const p=Object.fromEntries(formatter.formatToParts(new Date(time)).map(x=>[x.type,x.value]));return {day:p.year+'-'+p.month+'-'+p.day,hour:Number(p.hour)};}
 const dayOf=time=>localParts(time).day;
 const addDays=(day,n)=>new Date(Date.parse(day+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
 function elapsed(session,now=Date.now()){
  if(!session)return 0;
  const extra=session.status==='running'&&Number.isFinite(Date.parse(session.last_started_at))?Math.max(0,(now-Date.parse(session.last_started_at))/1000):0;
  return Math.min(Number(session.planned_seconds),Math.max(0,Number(session.elapsed_seconds)||0)+extra);
 }
 function segments(session,now=Date.now()){
  const parts=(Array.isArray(session.segments)?session.segments:[]).map(s=>({start:Date.parse(s.start),end:Date.parse(s.end)}));
  if(session.status==='running'){
   const start=Date.parse(session.last_started_at),remaining=Math.max(0,Number(session.planned_seconds)-Number(session.elapsed_seconds||0));
   parts.push({start,end:Math.min(now,start+remaining*1000)});
  }
  return parts.filter(p=>Number.isFinite(p.start)&&Number.isFinite(p.end)&&p.end>p.start);
 }
 function pauseSnapshot(session,at,stop=false){
  const copy={...session,segments:[...(session.segments||[])]};
  if(copy.status==='running'){
   const start=Date.parse(copy.last_started_at),end=Math.min(Math.max(start,at),start+(copy.planned_seconds-copy.elapsed_seconds)*1000);
   if(end>start)copy.segments.push({start:new Date(start).toISOString(),end:new Date(end).toISOString()});
   copy.elapsed_seconds=elapsed(copy,end);copy.last_started_at=null;
  }
  copy.status=copy.elapsed_seconds>=copy.planned_seconds?'completed':stop?'stopped':'paused';
  if(['completed','stopped'].includes(copy.status))copy.finished_at=new Date(at).toISOString();
  return copy;
 }
 function summarize(sessions,selectedDay,now=Date.now()){
  const days=Array.from({length:7},(_,i)=>addDays(selectedDay,i-6)),daySet=new Set(days),week=Object.fromEntries(days.map(d=>[d,0]));
  const areas=Object.fromEntries(Object.keys(AREAS).map(k=>[k,0])),hours=Array(24).fill(0),tasks={};let focus=0,breaks=0,cycles=0;
  const unique=new Map(sessions.map(s=>[s.id,s]));
  for(const session of unique.values()){
   if(session.kind==='focus'&&session.status==='completed'&&session.finished_at&&dayOf(session.finished_at)===selectedDay)cycles++;
   for(const part of segments(session,now)){
    let cursor=part.start;
    while(cursor<part.end){
     const end=Math.min(part.end,(Math.floor(cursor/3600000)+1)*3600000),seconds=(end-cursor)/1000,{day,hour}=localParts(cursor);
     if(session.kind==='focus'){
      if(daySet.has(day)){week[day]+=seconds;hours[hour]+=seconds;}
      if(day===selectedDay){focus+=seconds;areas[AREAS[session.category]?session.category:'other']+=seconds;if(session.task_id)tasks[session.task_id]=(tasks[session.task_id]||0)+seconds;}
     }else if(day===selectedDay)breaks+=seconds;
     cursor=end;
    }
   }
  }
  const bestHour=Math.max(...hours)>0?hours.indexOf(Math.max(...hours)):null;
  return {focus,breaks,cycles,week,areas,hours,tasks,bestHour};
 }
 function duration(seconds){if(!seconds)return '0 min';if(seconds<60)return '<1 min';const n=Math.round(seconds/60);return n>=60?Math.floor(n/60)+'h'+(n%60?String(n%60).padStart(2,'0'):''):n+' min';}
 function countdown(seconds){const n=Math.max(0,Math.ceil(seconds));return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');}
 function dailyRows(tasks,plans,day){
  const map=new Map();
  tasks.filter(t=>String(t.due_date||t.due?.date||'').slice(0,10)===day).forEach(t=>map.set(String(t.id),{task_id:String(t.id),task_name:t.content,category:'other',day,available:t.status!=='completed',completed_at:t.status==='completed'?t.completed_at:null,priority:t.priority||1}));
  plans.filter(p=>p.day===day).forEach(p=>{const task=tasks.find(t=>String(t.id)===p.task_id);map.set(p.task_id,{...map.get(p.task_id),...p,task_name:task?.content||p.task_name,available:!!task,priority:task?.priority||1});});
  return [...map.values()].filter(p=>!p.excluded).sort((a,b)=>Number(!!a.completed_at)-Number(!!b.completed_at)||(b.priority||1)-(a.priority||1)||a.task_name.localeCompare(b.task_name));
 }
 if(typeof module!=='undefined'&&module.exports)module.exports={elapsed,segments,pauseSnapshot,summarize,duration,countdown,dailyRows,dayOf,addDays};
 if(typeof document==='undefined')return;
 const el=id=>document.getElementById(id),owner=()=>typeof currentUserId==='undefined'?null:currentUserId,db=()=>sb;
 const state={owner:null,tasks:[],nativeRecords:[],todoistConfirmed:false,syncText:'Aguardando leitura do Danielle OS.',plans:[],sessions:[],settings:{...DEFAULTS},active:null,last:null,phase:'focus',selected:null,view:'today',offset:0,busy:false,loaded:false,request:0,loading:null,lastCloud:0,lastPoll:0,startingId:null,pending:null,planQueue:new Map(),planFlight:null};
 const originalTitle=document.title;
 const CACHE_PREFIX='danielle-focus-v2:';
 const now=()=>Date.now()+state.offset,today=()=>dayOf(now());
 const notify=(text,error=false)=>{el('fpNotice').textContent=text;el('fpNotice').dataset.error=String(error);};
 const dateLabel=d=>new Date(d+'T12:00:00Z').toLocaleDateString('pt-BR',{day:'2-digit',month:'short',timeZone:TZ});
 const timeLabel=d=>new Date(d).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',timeZone:TZ});
 function cache(){
  if(!state.owner)return;
  try{localStorage.setItem(CACHE_PREFIX+state.owner,JSON.stringify({active:state.active,last:state.last,pending:state.pending,planQueue:[...state.planQueue.values()],settings:state.settings}));}
  catch{if(state.pending||state.planQueue.size)notify('Não consegui guardar as alterações neste navegador. Mantenha a página aberta para sincronizar.',true);}
 }
 function resetOwner(){
  const id=owner();if(id===state.owner)return false;
  state.owner=id;state.request++;state.tasks=[];state.nativeRecords=[];state.todoistConfirmed=false;state.plans=[];state.sessions=[];state.active=null;state.last=null;state.pending=null;state.planQueue=new Map();state.planFlight=null;state.loaded=false;state.loading=null;state.selected=null;state.offset=0;state.startingId=null;state.settings={...DEFAULTS};state.phase='focus';
  state.syncText=id?'Aguardando leitura do Danielle OS.':'Entre na sua conta para planejar.';state.busy=false;state.lastCloud=0;state.lastPoll=0;
  if(id){try{const saved=localStorage.getItem(CACHE_PREFIX+id);const previous=!saved?JSON.parse(localStorage.getItem('danielle-focus-v1:'+id)||'null'):null;const data=saved?JSON.parse(saved):previous?{...previous,planQueue:[]}:null;if(data){if(data.active?.user_id===id)state.active=data.active;if(data.last?.user_id===id)state.last=data.last;if(data.pending?.owner===id)state.pending=data.pending;for(const p of data.planQueue||[])if(p.user_id===id)state.planQueue.set(p.day+':'+p.task_id,p);if(data.settings?.focus_minutes>=1&&data.settings?.break_minutes>=1&&data.settings?.daily_goal>=1)state.settings={...DEFAULTS,...data.settings};}}catch{}}
  if(state.active)state.sessions=[state.active];el('fpDay').value=today();notify('');render();return true;
 }
 async function readPages(table,configure,id){const rows=[];for(let from=0;;from+=1000){let query=configure(db().from(table).select('*').eq('user_id',id));query=table==='focus_sessions'?query.order('started_at').order('id'):query.order('day').order('task_id');const {data,error}=await query.range(from,from+999);if(error)throw error;rows.push(...(data||[]));if(!data||data.length<1000)return rows;}}
 function ingest(result,sent,received){
  if(result.server_now)state.offset=Date.parse(result.server_now)-(sent+received)/2;
  const session=result.session;
  if(session){state.sessions=state.sessions.filter(s=>s.id!==session.id);state.sessions.push(session);if(['running','paused'].includes(session.status))state.active=session;else{state.active=null;state.last=session;state.phase=session.status==='completed'&&session.kind==='focus'?'break':'focus';}}
  else state.active=null;
  state.sessions=state.sessions.filter(s=>!['running','paused'].includes(s.status)||s.id===state.active?.id);
  cache();
 }
 async function rpc(payload){const sent=Date.now();const {data,error}=await db().rpc('focus_timer_command',payload);if(error)throw error;if(!data||!data.server_now)throw new Error('Resposta do timer não confirmada.');return {data,sent,received:Date.now()};}
 async function flushPending(){
  const pending=state.pending;if(!pending)return;
  const id=state.owner,{data,sent,received}=await rpc(pending.payload);if(owner()!==id||state.owner!==id)return;
  state.pending=null;ingest(data,sent,received);
  if(data.conflict)notify('O timer mudou em outro aparelho. Seu pedido não foi reaplicado; confira o estado atual antes de continuar.',true);
 }
 async function flushPlans(){
  if(state.planFlight)return state.planFlight;
  if(!state.planQueue.size)return;
  const id=state.owner;
  state.planFlight=(async()=>{try{for(const [key,payload] of state.planQueue){
   const {data,error}=await db().from('focus_task_plans').upsert(payload,{onConflict:'user_id,day,task_id'}).select().single();if(error)throw error;
   if(owner()!==id||state.owner!==id)return;
   if(state.planQueue.get(key)===payload)state.planQueue.delete(key);
   const newer=state.planQueue.get(key);state.plans=state.plans.filter(p=>p.day+':'+p.task_id!==key);state.plans.push({...data,...(newer||{})});cache();
  }}catch{if(owner()===id)notify('Seu planejamento está guardado neste aparelho e aguarda conexão para sincronizar.',true);}finally{if(state.owner===id){state.planFlight=null;render();}}})();
  return state.planFlight;
 }
 function queuePlan(task,patch,day=el('fpDay').value){
  const key=day+':'+task.task_id,old=state.plans.find(p=>p.day+':'+p.task_id===key)||{};
  const payload={...(state.planQueue.get(key)||{}),user_id:state.owner,day,task_source:'native',task_id:task.task_id,task_name:task.task_name,...patch,updated_at:new Date(now()).toISOString()};
  state.planQueue.set(key,payload);state.plans=state.plans.filter(p=>p.day+':'+p.task_id!==key);state.plans.push({...old,category:'other',...old,...payload});cache();render();return flushPlans();
 }
 async function loadCloud(force=false){
  resetOwner();if(!state.owner)return;
  if(state.loading){if(state.loadDay===el('fpDay').value)return state.loading;return state.loading.then(()=>loadCloud(true));}if(!force&&Date.now()-state.lastCloud<15000)return;
  const id=state.owner,request=++state.request,day=el('fpDay').value,start=addDays(day,-6),end=addDays(day,1);
  state.loadDay=day;
  state.loading=(async()=>{try{
   await flushPending();await flushPlans();
   if(owner()!==id||state.owner!==id)return;
   const [plans,sessions,prefs,clock]=await Promise.all([
    readPages('focus_task_plans',q=>q.eq('task_source','native').gte('day',start).lte('day',day),id),
    readPages('focus_sessions',q=>q.lt('started_at',end+'T03:00:00Z').or('finished_at.gte.'+start+'T00:00:00Z,finished_at.is.null'),id),
    db().from('focus_settings').select('*').eq('user_id',id).maybeSingle(),rpc({p_action:'status'})
   ]);
   if(owner()!==id||request!==state.request||el('fpDay').value!==day)return;
   if(prefs.error)throw prefs.error;
   state.plans=plans;for(const p of state.planQueue.values()){const i=state.plans.findIndex(r=>r.day===p.day&&r.task_id===p.task_id);if(i<0)state.plans.push(p);else state.plans[i]={...state.plans[i],...p};}
   state.sessions=sessions;state.settings={...DEFAULTS,...(prefs.data||{})};ingest(clock.data,clock.sent,clock.received);
   if(!state.active&&!state.last){const recent=[...state.sessions].filter(s=>s.finished_at&&dayOf(s.finished_at)===today()).sort((a,b)=>Date.parse(b.finished_at)-Date.parse(a.finished_at))[0];if(recent){state.last=recent;state.phase=recent.status==='completed'&&recent.kind==='focus'?'break':'focus';}}
   state.loaded=true;state.lastCloud=Date.now();render();
  }catch{if(owner()===id&&request===state.request)notify('Não consegui conferir as sessões na sua conta. '+(state.pending?'A pausa/encerramento está guardado neste aparelho. ':'')+'Use Atualizar para tentar novamente.',true);}
  finally{if(request===state.request)state.loading=null;}})();return state.loading;
 }
 async function timerAction(action){
  resetOwner();if(!state.owner||state.busy||state.pending)return;
  const id=state.owner,session=state.active;let payload={p_action:action,p_session_id:session?.id||null,p_revision:session?.revision??null,p_command_id:crypto.randomUUID()};
  if(action==='start'){
   if(!state.loaded){notify('Confira a conexão do planejamento antes de iniciar.',true);return;}
   const task=rows().find(t=>t.task_id===state.selected);
   if(el('fpDay').value!==today()){notify('Volte para hoje para iniciar um ciclo.');return;}
   if(state.phase==='focus'&&(!state.todoistConfirmed||!task?.available||task.completed_at)){notify('Escolha uma tarefa aberta na leitura confirmada do Danielle OS.',true);return;}
   if(!state.startingId)state.startingId=crypto.randomUUID();
   payload={...payload,p_session_id:state.startingId,p_revision:null,p_kind:state.phase,p_planned_seconds:(state.phase==='focus'?state.settings.focus_minutes:state.settings.break_minutes)*60,p_task_id:state.phase==='focus'?task.task_id:null,p_task_name:state.phase==='focus'?task.task_name:'Pausa',p_category:state.phase==='focus'?task.category||'other':'other'};
   if(state.phase==='focus')queuePlan(task,{excluded:false});
  }
  if(['pause','stop'].includes(action)&&session){
   payload.p_occurred_at=new Date(now()).toISOString();state.pending={owner:id,payload};state.active=pauseSnapshot(session,now(),action==='stop');cache();
  }
  state.busy=true;renderTimer();
  try{
   const {data,sent,received}=await rpc(payload);if(owner()!==id||state.owner!==id)return;
   state.pending=null;state.startingId=null;ingest(data,sent,received);
   if(data.conflict)notify('Já existe um ciclo ou o timer foi alterado em outro aparelho. Trouxe o estado atual para você conferir.',true);
   else if(data.session?.status==='completed')notify(data.session.kind==='focus'?'Ciclo finalizado. Quando quiser, comece a pausa.':'Pausa concluída. Escolha sua próxima tarefa.');
   else if(action!=='settle')notify('');render();
  }catch{
   if(owner()!==id)return;
   notify(state.pending?'Seu pedido de pausa/encerramento está guardado neste aparelho e aguarda conexão.':'Não consegui confirmar a ação no timer. Atualize para conferir antes de tentar novamente.',true);
  }finally{if(state.owner===id){state.busy=false;renderTimer();}}
 }
 const rows=()=>{const records=state.nativeRecords||[];const completed=records.filter(r=>r.status==='completed'&&!r.archived_at);const plans=state.plans.map(p=>{const r=records.find(t=>t.id===p.task_id);return r?{...p,completed_at:r.status==='completed'?r.completed_at:null,excluded:p.excluded||!!r.archived_at}:p;});return dailyRows([...state.tasks,...completed],plans,el('fpDay').value);};
 function allSessions(){const m=new Map(state.sessions.map(s=>[s.id,s]));if(state.active)m.set(state.active.id,state.active);return [...m.values()];}
 function stats(){return summarize(allSessions(),el('fpDay').value,now());}
 function render(){
  if(!el('fpKpis'))return;
  const list=rows();if(!state.selected||!list.some(t=>t.task_id===state.selected&&!t.completed_at&&t.available))state.selected=list.find(t=>!t.completed_at&&t.available)?.task_id||null;
  el('fpSync').textContent=state.syncText;
  document.querySelectorAll('[data-fp-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.fpView===state.view)));
  const main=['today','plan'].includes(state.view);el('fpTodayPanel').hidden=!main;el('fpTodayPanel').dataset.plan=String(state.view==='plan');document.querySelector('.fp-timer-panel').hidden=state.view==='plan';el('fpInsights').hidden=state.view==='plan';
  ['History','Stats','Settings'].forEach(x=>el('fp'+x+'Panel').hidden=state.view!==x.toLowerCase());
  renderTasks(list);renderMetrics(list);renderTimer();renderHistory();
  if(document.activeElement?.closest?.('#fpSettingsForm')==null){el('fpFocusMinutes').value=state.settings.focus_minutes;el('fpBreakMinutes').value=state.settings.break_minutes;el('fpDailyGoal').value=state.settings.daily_goal;}
  el('fpCloudState').textContent=state.pending?'Timer com alteração aguardando sincronização.':state.planQueue.size?state.planQueue.size+' alteração(ões) do planejamento aguardando sincronização.':state.loaded?'Planejamento e sessões conferidos na sua conta.':'Conferindo suas sessões…';
 }
 function renderTimer(){
  const session=state.active,active=!!session&&['running','paused'].includes(session.status),kind=active?session.kind:state.phase,total=active?session.planned_seconds:(kind==='focus'?state.settings.focus_minutes:state.settings.break_minutes)*60,spent=active?elapsed(session,now()):0,remaining=total-spent;
  el('fpTime').textContent=countdown(remaining);el('fpClock').style.setProperty('--fp-progress',Math.min(360,spent/total*360)+'deg');el('fpClock').dataset.kind=kind;
  el('fpPhaseLabel').textContent=(kind==='focus'?'Foco':'Pausa')+' · '+Math.round(total/60)+' min';
  el('fpClockState').textContent=state.pending?'Sincronização pendente':active?(session.status==='paused'?'Pausado':remaining<=0?'Confirmando fim do ciclo…':'Um ciclo de cada vez'):'Pronto para começar';
  el('fpCurrentTask').textContent=kind==='break'?'Tempo de respirar e descansar':active?session.task_name:(rows().find(r=>r.task_id===state.selected)?.task_name||'Escolha uma tarefa do seu dia');
  el('fpStart').hidden=active&&session.status==='running';el('fpStart').textContent=active?'Continuar':kind==='break'?'Começar pausa':'Começar foco';
  el('fpStart').disabled=state.busy||!!state.pending||!state.owner||!state.loaded||(!active&&el('fpDay').value!==today())||(!active&&kind==='focus'&&(!state.selected||!state.todoistConfirmed));
  el('fpPause').hidden=!active||session.status!=='running';el('fpPause').disabled=state.busy||!!state.pending;el('fpStop').hidden=!active;el('fpStop').disabled=state.busy||!!state.pending;
  document.querySelectorAll('[data-fp-kind]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.fpKind===kind));b.disabled=active||state.busy||!!state.pending;});
  el('fpTimerHint').textContent=active&&session.status==='paused'?'A pausa do timer não conta como tempo de foco.':state.pending?'Vamos aplicar o pedido assim que a conexão voltar.':kind==='break'?'A pausa tem seu próprio registro e não entra no tempo de foco.':'O fim do ciclo registra seu foco. A tarefa só é concluída quando você marcar a caixa.';
  document.title=active&&session.status==='running'?countdown(remaining)+' · '+(kind==='focus'?'Foco':'Pausa')+' | Danielle OS':originalTitle;
 }
 function renderTasks(list){
  const s=stats();el('fpPlanCount').textContent=list.filter(t=>t.completed_at).length+' de '+list.length+' concluídas';
  el('fpTasks').innerHTML=list.length?list.map(t=>{
   const missing=!t.available&&!t.completed_at;
   return '<article class="fp-task" data-selected="'+(t.task_id===state.selected)+'" data-done="'+!!t.completed_at+'"><div class="fp-task-main"><input type="checkbox" data-fp-complete="'+esc(t.task_id)+'" aria-label="Concluir '+esc(t.task_name)+' no Danielle OS" '+(t.completed_at?'checked disabled':missing||el('fpDay').value!==today()||!state.todoistConfirmed?'disabled':'')+'><span class="fp-task-name">'+esc(t.task_name)+'</span><button class="fp-focus-pick" data-fp-select="'+esc(t.task_id)+'" aria-label="Focar em '+esc(t.task_name)+'" '+(missing||t.completed_at?'disabled':'')+'>▷</button></div><div class="fp-task-meta"><label>Estimativa <input type="number" min="1" max="1440" data-fp-estimate="'+esc(t.task_id)+'" value="'+(t.estimated_minutes||'')+'" placeholder="min" aria-label="Minutos previstos para '+esc(t.task_name)+'"></label><select data-fp-area="'+esc(t.task_id)+'" aria-label="Área de '+esc(t.task_name)+'">'+Object.entries(AREAS).map(([key,name])=>'<option value="'+key+'" '+((t.category||'other')===key?'selected':'')+'>'+name+'</option>').join('')+'</select><small>'+duration(s.tasks[t.task_id]||0)+' de foco</small><button class="fp-task-remove" data-fp-remove="'+esc(t.task_id)+'" '+(state.active?.task_id===t.task_id?'disabled':'')+'>Tirar do dia</button></div>'+(missing?'<p class="fp-small">Essa tarefa foi concluída, arquivada ou reagendada. Confira em Minhas listas e tarefas.</p>':'')+'</article>';
  }).join(''):'<div class="fp-empty"><strong>Um dia com espaço para focar</strong>Inclua uma tarefa do Danielle OS no planejamento ou crie uma nova.</div>';
  const ids=new Set(list.map(t=>t.task_id));el('fpTaskPicker').innerHTML='<option value="">Selecione uma tarefa do Danielle OS…</option>'+state.tasks.filter(t=>!ids.has(String(t.id))).map(t=>'<option value="'+esc(t.id)+'">'+esc(t.content)+'</option>').join('');
  el('fpAddPlan').disabled=!state.todoistConfirmed;
 }
 function areaHtml(s){const max=Math.max(...Object.values(s.areas),1);return Object.entries(AREAS).map(([key,name])=>'<div class="fp-area"><span>'+name+'</span><div class="fp-area-track"><i style="width:'+s.areas[key]/max*100+'%"></i></div><span>'+duration(s.areas[key])+'</span></div>').join('');}
 function weekHtml(s){const max=Math.max(...Object.values(s.week),1);return '<div class="fp-week" role="img" aria-label="'+esc(Object.entries(s.week).map(([d,n])=>dateLabel(d)+': '+duration(n)).join('; '))+'">'+Object.entries(s.week).map(([d,n])=>'<div class="fp-week-day"><small>'+Math.round(n/60)+'</small><i style="height:'+Math.max(2,n/max*76)+'px"></i><span>'+d.slice(8,10)+'</span></div>').join('')+'</div><p class="fp-small">'+duration(Object.values(s.week).reduce((a,b)=>a+b,0))+' de foco · '+dateLabel(Object.keys(s.week)[0])+' a '+dateLabel(Object.keys(s.week).at(-1))+'</p>';}
 function renderMetrics(list=rows()){
  const s=stats(),done=list.filter(t=>t.completed_at).length,estimated=list.reduce((a,t)=>a+Number(t.estimated_minutes||0),0),missing=list.filter(t=>!t.estimated_minutes).length;
  const best=s.bestHour===null?'—':s.bestHour+'h–'+(s.bestHour+1)+'h';
  el('fpKpis').innerHTML=[
   [s.cycles,'ciclos de foco','meta: '+state.settings.daily_goal],
   [duration(s.focus),'tempo de foco','pausas: '+duration(s.breaks)],
   [done+' de '+list.length,'tarefas concluídas','confirmações feitas por aqui'],
   [(estimated?duration(estimated*60):'—')+' → '+duration(s.focus),'estimado × foco real',missing?missing+' sem estimativa':'estimativas do dia'],
   [best,'horário de maior foco','nos últimos 7 dias']
  ].map(([n,label,caption])=>'<div class="fp-kpi"><b>'+esc(state.loaded?n:'—')+'</b><span>'+label+'</span><small>'+caption+'</small></div>').join('');
  const daily=summarize(allSessions(),today(),now());el('fpGoalCount').textContent=daily.cycles+' de '+state.settings.daily_goal;el('fpGoalBar').style.width=Math.min(100,daily.cycles/state.settings.daily_goal*100)+'%';
  el('fpAreas').innerHTML=areaHtml(s);el('fpWeek').innerHTML=weekHtml(s);el('fpRhythm').textContent=s.bestHour===null?'Seu horário de maior foco aparece conforme você usa o timer.':'Até aqui, '+best+' concentrou mais tempo de foco nos últimos 7 dias. Use como referência para planejar suas próximas tarefas.';
  el('fpStatsContent').innerHTML='<div class="fp-stat-grid"><div><h3>Tempo por área no dia</h3>'+areaHtml(s)+'</div><div><h3>Foco na semana</h3>'+weekHtml(s)+'</div></div><p class="fp-small">Ciclos interrompidos também entram no tempo real. Apenas ciclos completos entram na meta diária.</p>';
 }
 function renderHistory(){
  const day=el('fpDay').value,records=allSessions().filter(s=>segments(s,now()).some(p=>dayOf(p.start)===day||dayOf(p.end-1)===day)||dayOf(s.started_at)===day).sort((a,b)=>Date.parse(b.started_at)-Date.parse(a.started_at));
  const labels={running:'Em andamento',paused:'Pausado',completed:'Concluído',stopped:'Interrompido'};
  el('fpHistory').innerHTML=records.length?records.map(s=>'<article class="fp-history-item"><time>'+timeLabel(s.started_at)+(s.finished_at?'–'+timeLabel(s.finished_at):'')+'</time><div><strong>'+esc(s.kind==='break'?'Pausa':s.task_name)+'</strong><small>'+labels[s.status]+' · '+(s.kind==='focus'?AREAS[s.category]||AREAS.other:'descanso')+'</small></div><span>'+duration(elapsed(s,now()))+'</span></article>').join(''):'<div class="fp-empty">Seus ciclos de foco e pausas aparecerão aqui.</div>';
  el('fpRecent').innerHTML=records.slice(0,3).map(s=>'<div class="fp-session-row"><span>'+esc(s.kind==='break'?'Pausa':s.task_name)+'<br><small>'+labels[s.status]+'</small></span><time>'+duration(elapsed(s,now()))+'</time></div>').join('')||'<p class="fp-small">Comece seu primeiro ciclo.</p>';
 }
 function revealLegacy(create=false){if(create&&window.NativeTasks?.openEditor){window.NativeTasks.openEditor();return;}el('fpTodoistOriginal').open=true;el('fpTodoistOriginal').scrollIntoView({behavior:'smooth',block:'start'});if(create){el('tdDue').value='hoje';el('tdContent').focus({preventScroll:true});}}
 async function completeTask(id){
  const task=rows().find(t=>t.task_id===id);if(!task||task.completed_at||!task.available)return;
  try{await closeTodoistTask(id);}finally{render();}
 }
 const nativeTodoistCall=todoistCall;
 todoistCall=async function(payload={}){
  resetOwner();const id=state.owner,revision=typeof todoistReadRevision==='undefined'?0:todoistReadRevision;
  try{
   const data=await nativeTodoistCall(payload);if(owner()!==id||state.owner!==id)return data;
   const action=payload.action||'list';
   if(action==='list'&&data.sync?.provider==='danielle-os'&&(typeof todoistReadRevision==='undefined'||revision===todoistReadRevision)){
    state.tasks=data.groups.all;state.nativeRecords=data.records||[];state.todoistConfirmed=true;state.syncText=typeof todoistSyncText==='function'?todoistSyncText(data):state.tasks.length+' tarefas abertas conferidas no Danielle OS.';render();loadCloud().catch(()=>{});
   }
   if(['reopen','archive','restore'].includes(action)){const task=state.plans.find(p=>p.day===today()&&p.task_id===String(payload.id));if(task)queuePlan(task,action==='reopen'?{completed_at:null}:action==='archive'?{excluded:true}:{excluded:false},today());}
   if(action==='close'){
    const task=dailyRows(state.tasks,state.plans,today()).find(t=>t.task_id===String(payload.id));
    if(task)queuePlan(task,{completed_at:new Date(now()).toISOString()},today());
    if(state.active?.kind==='focus'&&state.active.task_id===String(payload.id))timerAction('stop').catch(()=>{});
    state.tasks=state.tasks.filter(t=>String(t.id)!==String(payload.id));render();
   }
   return data;
  }catch(error){if((payload.action||'list')==='list'&&owner()===id){state.todoistConfirmed=false;state.syncText='Leitura do Danielle OS não confirmada. '+(state.tasks.length?'Exibindo a última lista conhecida.':'');render();}throw error;}
 };
 el('fpStart').addEventListener('click',()=>timerAction(state.active?.status==='paused'?'resume':'start'));
 el('fpPause').addEventListener('click',()=>timerAction('pause'));el('fpStop').addEventListener('click',()=>timerAction('stop'));
 el('fpRefresh').addEventListener('click',async()=>{notify('');await Promise.allSettled([loadTodoistTasks(),loadCloud(true)]);});
 el('fpToday').addEventListener('click',()=>{el('fpDay').value=today();render();loadCloud(true);});
 el('fpDay').value=today();el('fpDay').addEventListener('change',()=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(el('fpDay').value))return;state.loaded=false;render();loadCloud(true);});
 el('fpAddPlan').addEventListener('click',()=>{const t=state.tasks.find(t=>String(t.id)===el('fpTaskPicker').value);if(t)queuePlan({task_id:String(t.id),task_name:t.content},{excluded:false});});
 el('fpSettingsForm').addEventListener('submit',async event=>{
  event.preventDefault();if(!state.owner||!el('fpSettingsForm').reportValidity())return;const id=state.owner;
  const settings={user_id:id,focus_minutes:Number(el('fpFocusMinutes').value),break_minutes:Number(el('fpBreakMinutes').value),daily_goal:Number(el('fpDailyGoal').value),updated_at:new Date(now()).toISOString()};
  const {data,error}=await db().from('focus_settings').upsert(settings,{onConflict:'user_id'}).select().single();if(owner()!==id)return;if(error){notify('Não consegui salvar as configurações. Tente novamente quando estiver conectado.',true);return;}state.settings=data;cache();render();notify('Configurações salvas. As novas durações valem para os próximos ciclos.');
 });
 document.querySelector('[data-page="todoist"]').addEventListener('click',event=>{
  const b=event.target.closest('[data-fp-view],[data-fp-kind],[data-fp-select],[data-fp-remove],[data-fp-action]');if(!b)return;
  if(b.dataset.fpView){state.view=b.dataset.fpView;render();loadCloud();}
  if(b.dataset.fpKind&&!state.active){state.phase=b.dataset.fpKind;renderTimer();}
  if(b.dataset.fpSelect){if(state.active?.kind==='focus'&&state.active.task_id!==b.dataset.fpSelect){notify('Encerre o ciclo atual para trocar de tarefa. O tempo já feito fica registrado.');return;}state.selected=b.dataset.fpSelect;render();}
  if(b.dataset.fpRemove){const t=rows().find(t=>t.task_id===b.dataset.fpRemove);if(t)queuePlan(t,{excluded:true});}
  if(b.dataset.fpAction)revealLegacy(b.dataset.fpAction==='new');
 });
 el('fpTasks').addEventListener('change',event=>{
  const input=event.target,id=input.dataset.fpEstimate||input.dataset.fpArea||input.dataset.fpComplete,task=rows().find(t=>t.task_id===id);if(!task)return;
  if(input.dataset.fpComplete){input.checked=false;input.disabled=true;completeTask(id);}
  if(input.dataset.fpEstimate){if(input.value&&!input.reportValidity())return;queuePlan(task,{estimated_minutes:input.value?Number(input.value):null});}
  if(input.dataset.fpArea&&AREAS[input.value])queuePlan(task,{category:input.value});
 });
 async function poll(){
  if(!state.owner||state.busy)return;
  try{if(state.pending){await flushPending();render();}if(state.planQueue.size)flushPlans();await loadCloud(true);}catch{}
 }
 let tickCount=0;
 setInterval(()=>{
  const changed=resetOwner();if(changed&&state.owner){loadCloud(true);if(document.querySelector('.page.active')?.dataset.page==='todoist')loadTodoistTasks();}
  if(!state.owner)return;renderTimer();tickCount++;
  if(tickCount%15===0&&document.visibilityState!=='hidden'){renderMetrics();renderHistory();}
  if(state.active?.status==='running'&&elapsed(state.active,now())>=state.active.planned_seconds&&!state.busy&&!state.pending)timerAction('settle');
  if(state.active?.kind==='focus'&&state.plans.some(p=>p.day===today()&&p.task_id===state.active.task_id&&p.completed_at)&&!state.busy&&!state.pending)timerAction('stop');
  if(Date.now()-state.lastPoll>20000&&(state.active||state.pending||document.querySelector('.page.active')?.dataset.page==='todoist')){state.lastPoll=Date.now();poll();}
 },1000);
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){resetOwner();poll();}});
 window.addEventListener('online',()=>{resetOwner();poll();});
 window.FocusWorkspace={load:()=>loadCloud(true)};
 resetOwner();render();if(state.owner)loadCloud(true);
})();
