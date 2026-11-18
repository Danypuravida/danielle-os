/* Private career archive, backed by existing seniority evidence. No demo records. */
(function () {
  'use strict';
  const TYPES = {delivery:'Entrega',project:'Projeto',feedback:'Feedback',course:'Curso concluído',talk:'Palestra',material:'Material'};
  const MONTHS = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  const DELIVERY_TYPES = new Set(['delivery','project','talk']);
  const MIME = {jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',pdf:'application/pdf',ppt:'application/vnd.ms-powerpoint',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',csv:'text/csv'};
  const BUCKET = 'career-portfolio';
  const typeOf = r => TYPES[r.entry_type] ? r.entry_type : (r.domain === 'Projeto estratégico' || r.competency === 'Projeto estratégico' ? 'project' : 'delivery');
  const dateOf = r => String(r.evidence_date || r.created_at || '').slice(0,10);
  const titleOf = r => r.title || r.action_taken || r.situation || r.result || 'Registro de carreira';
  const normalize = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const escape = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function inPeriod(r,year,month,dateKey) {
    const date = dateKey ? String(r[dateKey] || '') : dateOf(r);
    return (!year || date.startsWith(String(year)+'-')) && (!month || date.slice(5,7) === month);
  }
  function filterRecords(records,{year='',month='',view='overview',search=''}={}) {
    const query = normalize(search.trim());
    return records.filter(r => inPeriod(r,year,month) &&
      (!TYPES[view] || typeOf(r) === view) &&
      (!query || normalize([titleOf(r),r.result,r.situation,r.action_taken,r.competency,r.technical_area,r.stakeholder,r.lesson_learned,r.measurable_impact,r.evidence_source].join(' ')).includes(query))
    ).sort((a,b)=>dateOf(b).localeCompare(dateOf(a)) || String(b.created_at||'').localeCompare(String(a.created_at||'')) || String(a.id).localeCompare(String(b.id)));
  }
  function statistics(records,scores=[]) {
    const positive = n => Math.max(0,Number(n) || 0);
    const planned = scores.reduce((s,r)=>s+positive(r.priorities_planned),0);
    const completed = scores.reduce((s,r)=>s+positive(r.priorities_completed),0);
    return {total:records.length,deliveries:records.filter(r=>DELIVERY_TYPES.has(typeOf(r))).length,
      projects:records.filter(r=>typeOf(r)==='project').length,feedbacks:records.filter(r=>typeOf(r)==='feedback').length,
      courses:records.filter(r=>typeOf(r)==='course').length,planned,completed,
      completion:planned > 0 ? Math.round(completed/planned*100) : null};
  }
  function summaryText(records,period) {
    const n = statistics(records);
    if (!n.total) return 'Ainda não há registros para '+period+'.\n\nAdicione uma entrega, um feedback recebido, um curso concluído ou uma palestra para começar seu resumo.';
    const counts = [[n.deliveries,'entrega(s), projeto(s) ou palestra(s)'],[n.feedbacks,'feedback(s) recebido(s)'],[n.courses,'curso(s) concluído(s)']].filter(([v])=>v).map(([v,label])=>v+' '+label);
    const selected = [...records].sort((a,b)=>Number(!!b.featured)-Number(!!a.featured)||Number(b.evidence_strength||0)-Number(a.evidence_strength||0)).slice(0,5);
    return 'Meu portfólio · '+period+'\n\n'+n.total+' registro(s) no período'+(counts.length?': '+counts.join('; '):'')+'.\n\nEvidências da minha trajetória:\n'+selected.map(r=>{
      const result = r.result ? '\n'+r.result : '';
      const metric = r.before_value && r.after_value ? '\nAntes: '+r.before_value+' → Depois: '+r.after_value+(r.metric_unit?' '+r.metric_unit:'')+'.' : '';
      return '• '+titleOf(r)+' ('+formatDate(dateOf(r))+')'+result+metric;
    }).join('\n\n')+(records.length>5?'\n\nO resumo seleciona até cinco registros, priorizando os destaques e a força da evidência.':'');
  }
  function linkedinCandidates(records){
    return [...records].sort((a,b)=>Number(!!b.featured)-Number(!!a.featured)||dateOf(b).localeCompare(dateOf(a))||String(a.id).localeCompare(String(b.id)));
  }
  function postSentence(value){
    const text=String(value||'').trim().replace(/\s+/g,' ');
    return text && !/[.!?…]$/.test(text)?text+'.':text;
  }
  function linkedinText(records,period,mode='achievement'){
    if(!records.length)return '';
    const selected=records.slice(0,mode==='review'?3:1);
    if(mode==='learning'&&!selected[0].lesson_learned?.trim())return '';
    function outcome(r){
      const title=postSentence(titleOf(r)),result=postSentence(r.result);
      const action=postSentence(r.action_taken);
      const parts=[title];
      if(action&&normalize(action)!==normalize(title)&&normalize(action)!==normalize(result))parts.push(action);
      if(result&&normalize(result)!==normalize(title))parts.push(result);
      // Use the recorded values without inferring a gain, a reduction or a percentage.
      if(r.before_value!=null&&r.after_value!=null&&String(r.before_value).trim()&&String(r.after_value).trim()){
        const before=String(r.before_value).trim(),after=String(r.after_value).trim(),unit=r.metric_unit?' '+String(r.metric_unit).trim():'';
        if(!String(r.result||'').includes(before)||!String(r.result||'').includes(after))parts.push('Antes: '+before+unit+'. Depois: '+after+unit+'.');
      }
      return parts.join(' ');
    }
    if(mode==='review'){
      const lessons=[...new Set(selected.map(r=>String(r.lesson_learned||'').trim()).filter(Boolean))];
      return 'Alguns registros de '+period+' que quero compartilhar.\n\n'+selected.map(outcome).join('\n\n')+(lessons.length?'\n\nUm aprendizado que levo desse período: '+postSentence(lessons[0]):'');
    }
    const r=selected[0];
    if(mode==='learning')return 'Um aprendizado da minha rotina de trabalho: '+postSentence(r.lesson_learned)+'\n\nIsso veio de uma experiência que quero registrar: '+outcome(r);
    if(typeOf(r)==='feedback')return 'Recebi um feedback que quero guardar e compartilhar:\n\n“'+String(r.result||'').trim()+'”'+(r.lesson_learned?'\n\nO que levo dessa troca: '+postSentence(r.lesson_learned):'');
    const intro=({course:'Um curso que entrou para a minha trajetória.',talk:'Uma participação que quero registrar por aqui.',material:'Um material do meu portfólio.'})[typeOf(r)]||'Uma entrega que quero registrar por aqui.';
    return intro+'\n\n'+outcome(r)+(r.lesson_learned?'\n\nO que levo dessa experiência: '+postSentence(r.lesson_learned):'');
  }
  function formatDate(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'Sem data';
    return date.slice(8,10)+'/'+date.slice(5,7)+'/'+date.slice(0,4);
  }
  function sourceLink(text) {
    try { const u=new URL(text);return ['https:','http:'].includes(u.protocol) ? u.href : null; } catch { return null; }
  }
  function validateFiles(files,existing=0) {
    if(files.length+existing>10) throw new Error('Use até 10 arquivos por registro.');
    return files.map(file=>{
      const ext=file.name.split('.').pop().toLowerCase();
      if(!MIME[ext]) throw new Error('Formato não aceito: '+file.name+'. Use fotos, PDF, Office ou CSV.');
      if(!file.size || file.size>20*1024*1024) throw new Error(file.name+': o arquivo deve ter entre 1 byte e 20 MB.');
      return {file,mime:MIME[ext],safeName:file.name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9._-]/g,'_').slice(-140)};
    });
  }
  function duplicateUpload(error){
    const status=String(error?.statusCode||error?.status||'');
    return status==='409' || ['ResourceAlreadyExists','KeyAlreadyExists','Duplicate'].includes(error?.code||error?.error) || (status==='400' && /already exists/i.test(error?.message||''));
  }
  // Export only pure helpers for regression tests; production runs as a classic script.
  if(typeof module!=='undefined' && module.exports) module.exports={typeOf,dateOf,filterRecords,statistics,summaryText,sourceLink,validateFiles,duplicateUpload,linkedinCandidates,linkedinText};
  if(typeof document==='undefined') return;

  const el=id=>document.getElementById(id);
  const state={owner:null,records:[],scores:[],assets:[],loaded:false,loading:null,request:0,view:'overview',editorId:null,saving:false,removing:false,pendingFiles:[],uploads:new WeakMap(),signed:new Map(),summaryKey:'',summaryDrafts:new Map(),linkedinSourceView:'overview',linkedinSourceKey:'',linkedinKey:'',linkedinSelected:[],linkedinDrafts:new Map()};
  const getOwner=()=>typeof currentUserId==='undefined'?null:currentUserId;
  const client=()=>sb;
  const notify=(message,good=false)=>{ if(typeof cloudMsg==='function') cloudMsg(message,good); };
  const today=()=>typeof isoDateLocal==='function'?isoDateLocal():new Date().toLocaleDateString('en-CA');
  const status=(text,error=false)=>{el('cpStatus').textContent=text;el('cpStatus').dataset.error=String(error);};
  function filters(){return {year:el('cpYear').value,month:el('cpMonth').value,view:state.view,search:el('cpSearch').value};}
  function periodLabel(f){return (f.month?new Date(2000,Number(f.month)-1,1).toLocaleDateString('pt-BR',{month:'long'})+' de ':'')+(f.year||'todos os anos');}
  function summaryLabel(f){return periodLabel(f)+(TYPES[f.view]?' · '+TYPES[f.view]:'')+(f.search.trim()?' · busca: “'+f.search.trim()+'”':'');}
  async function readAll(table,owner,columns='*') {
    const rows=[];
    for(let start=0;;start+=1000){
      const {data,error}=await client().from(table).select(columns).eq('user_id',owner).order('id').range(start,start+999);
      if(error) throw error;
      rows.push(...(data||[]));
      if(!data || data.length<1000) return rows;
    }
  }
  async function load(force=false) {
    const owner=getOwner();
    if(owner!==state.owner){
      state.request++;state.owner=owner;state.loaded=false;state.loading=null;state.records=[];state.scores=[];state.assets=[];state.signed.clear();state.summaryDrafts.clear();state.summaryKey='';
      state.linkedinDrafts.clear();state.linkedinSourceKey='';state.linkedinKey='';state.linkedinSelected=[];state.linkedinSourceView='overview';
      if(el('cpEditor').open) el('cpEditor').close();
      el('cpForm').reset();el('cpEditorFiles').innerHTML='';state.pendingFiles=[];state.editorId=null;
      render();
    }
    if(!owner){status('Entre na sua conta para ver seu portfólio.');render();return;}
    if(state.loading) return state.loading;
    if(state.loaded && !force){render();return;}
    const request=++state.request;
    status('Carregando seus registros…');el('cpRefresh').disabled=true;el('cpAdd').disabled=!state.loaded;
    state.loading=(async()=>{
      try{
        const [records,scores,assets]=await Promise.all([
          readAll('seniority_evidence',owner),
          readAll('weekly_scorecards',owner,'id,user_id,week_start,priorities_planned,priorities_completed'),
          readAll('career_portfolio_assets',owner)
        ]);
        if(request!==state.request || getOwner()!==owner)return;
        state.records=records;state.scores=scores;state.assets=assets;state.loaded=true;
        renderYears();status('');render();
      }catch(error){
        if(request===state.request && getOwner()===owner) status('Não consegui carregar o portfólio. '+(state.loaded?'Os registros exibidos são da última leitura. ':'')+'Use Atualizar para tentar novamente.',true);
      }finally{
        if(request===state.request){state.loading=null;el('cpRefresh').disabled=false;el('cpAdd').disabled=!state.loaded;}
      }
    })();
    return state.loading;
  }
  function renderYears(){
    const selected=el('cpYear').options.length?el('cpYear').value:String(new Date().getFullYear());
    const years=new Set([String(new Date().getFullYear()+1),...Array.from({length:6},(_,i)=>String(new Date().getFullYear()-i)),...state.records.map(r=>dateOf(r).slice(0,4)),...state.scores.map(r=>String(r.week_start||'').slice(0,4))]);
    el('cpYear').innerHTML=[...years].filter(v=>/^\d{4}$/.test(v)).sort().reverse().map(y=>'<option value="'+y+'">'+y+'</option>').join('')+'<option value="">Todos os anos</option>';
    el('cpYear').value=selected;
  }
  function render(){
    if(!el('cpKpis'))return;
    const f=filters();
    const period=state.records.filter(r=>inPeriod(r,f.year,f.month));
    const visible=filterRecords(state.records,f);
    const scores=state.scores.filter(r=>inPeriod(r,f.year,f.month,'week_start'));
    const stats=statistics(period,scores);
    el('cpBrandYear').textContent=f.year||'acervo';el('cpArchiveCount').textContent=state.loaded?state.records.length:'—';
    el('cpKpis').innerHTML=[
      [stats.deliveries,'entregas registradas','inclui projetos e palestras'],
      [stats.completion===null?'—':stats.completion+'%','prioridades concluídas',stats.planned?stats.completed+' de '+stats.planned+' · Scorecard':'Sem prioridades no Scorecard'],
      [stats.feedbacks,'feedbacks recebidos','registrados no período'],
      [stats.courses,'cursos concluídos','registrados no período'],
      [stats.projects,'projetos registrados','parte das entregas']
    ].map(([v,label,note])=>'<div class="cp-kpi"><strong>'+(state.loaded?escape(v):'—')+'</strong><span>'+label+'</span><small>'+note+'</small></div>').join('');
    const material=state.view==='materials',summary=state.view==='summary',linkedin=state.view==='linkedin';
    el('cpMainColumns').hidden=material||linkedin;el('cpMaterialsPanel').hidden=!material;el('cpLinkedInPanel').hidden=!linkedin;el('cpListPanel').hidden=summary;el('cpInsights').hidden=summary;
    el('cpMainColumns').style.gridTemplateColumns=summary?'1fr':'';
    el('cpHighlights').hidden=state.view!=='overview';
    document.querySelectorAll('[data-cp-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.cpView===state.view)));
    el('cpListTitle').textContent=({overview:'Entregas e resultados',delivery:'Minhas entregas',project:'Projetos',feedback:'Feedbacks recebidos',course:'Cursos concluídos',talk:'Palestras e eventos'})[state.view]||'Meu acervo';
    el('senioritySummary').textContent=visible.length+' registro'+(visible.length===1?'':'s');
    renderHighlights(visible);renderList(visible);renderChart(f);renderCompetencies(period);renderFeedbacks(period);renderGallery(visible);
    const key=JSON.stringify([state.owner,f.year,f.month,f.search,state.view]);
    if(key!==state.summaryKey)el('cpCopyStatus').textContent='';
    state.summaryKey=key;
    el('cpSummaryText').value=state.summaryDrafts.get(key)||summaryText(visible,summaryLabel(f));
    renderLinkedin();
    el('cpFootnote').textContent='Indicadores do período selecionado. Busca e seções filtram a lista e o resumo. Arquivos privados.';
  }
  function empty(title,body,button=true){return '<div class="cp-empty"><span class="cp-empty-mark" aria-hidden="true">✳</span><h3>'+title+'</h3><p>'+body+'</p>'+(button?'<button type="button" class="cp-btn cp-primary" data-cp-action="new">＋ Novo registro</button>':'')+'</div>';}
  function renderHighlights(records){
    const featured=records.filter(r=>r.featured).sort((a,b)=>dateOf(b).localeCompare(dateOf(a))).slice(0,4);
    el('cpHighlights').innerHTML=featured.map(r=>'<article class="cp-highlight"><p class="cp-eyebrow">✦ Conquista em destaque</p><h3>'+escape(titleOf(r))+'</h3><p>'+escape((r.measurable_impact||r.result||'').slice(0,180))+'</p><button type="button" data-cp-action="edit" data-id="'+escape(r.id)+'">Ver registro · '+formatDate(dateOf(r))+'</button></article>').join('');
  }
  function renderList(records){
    if(!state.loaded){el('seniorityList').innerHTML=empty('Seu acervo profissional','Os registros aparecerão aqui depois da leitura.',false);return;}
    if(!records.length){el('seniorityList').innerHTML=empty(state.records.length?'Nenhum registro neste filtro':'Sua próxima conquista começa aqui',state.records.length?'Experimente outro período ou uma busca mais curta.':'Registre uma entrega, um feedback, um curso ou uma palestra. Seu portfólio cresce com a sua trajetória.');return;}
    let month='';
    el('seniorityList').innerHTML=records.map(r=>{
      const date=dateOf(r),group=date.slice(0,7),kind=typeOf(r);
      let heading='';if(group!==month){month=group;heading='<h3 class="cp-month-title">'+(/^\d{4}-\d{2}$/.test(group)?MONTHS[Number(date.slice(5,7))-1]+' · '+date.slice(0,4):'Sem data')+'</h3>';}
      const details=[['Situação',r.situation],['Minha ação',r.action_taken],['Impacto',r.measurable_impact],['Pessoas envolvidas',r.stakeholder],['Aprendizado',r.lesson_learned],['Área técnica',r.technical_area]].filter(([,v])=>v);
      const source=sourceLink(r.evidence_source);
      const assets=state.assets.filter(a=>a.evidence_id===r.id);
      return heading+'<article class="cp-entry"><div class="cp-entry-top"><time class="cp-day" datetime="'+escape(date)+'" title="'+formatDate(date)+'">'+escape(date.slice(8,10)||'—')+'</time><div class="cp-entry-content"><div class="cp-entry-title">'+escape(titleOf(r))+'</div><p>'+escape(r.result||'')+'</p><div class="cp-entry-meta"><span>'+escape(r.competency||r.domain||'')+'</span>'+(r.before_value&&r.after_value?'<span>· '+escape(r.before_value)+' → '+escape(r.after_value)+' '+escape(r.metric_unit||'')+'</span>':'')+(assets.length?'<span>· '+assets.length+' arquivo(s)</span>':'')+'</div><details><summary>Ver contexto e evidências</summary><div class="cp-details"><dl>'+details.map(([label,value])=>'<dt>'+label+'</dt><dd>'+escape(value)+'</dd>').join('')+(r.evidence_source?'<dt>Fonte</dt><dd>'+(source?'<a href="'+escape(source)+'" target="_blank" rel="noopener noreferrer">'+escape(r.evidence_source)+'</a>':escape(r.evidence_source))+'</dd>':'')+'</dl>'+assets.map(a=>'<button type="button" class="cp-text-btn" data-cp-action="file" data-id="'+escape(a.id)+'">Abrir '+escape(a.file_name)+'</button><br>').join('')+'</div></details><div class="cp-entry-actions"><button type="button" class="cp-text-btn" data-cp-action="edit" data-id="'+escape(r.id)+'">Editar registro</button><button type="button" class="cp-text-btn" data-cp-action="feature" data-id="'+escape(r.id)+'" aria-pressed="'+!!r.featured+'">'+(r.featured?'★ Em destaque':'☆ Destacar')+'</button></div></div><span class="cp-tag" data-type="'+kind+'">'+TYPES[kind]+'</span></div></article>';
    }).join('');
  }
  function renderChart(f){
    el('cpChartCaption').textContent='Entregas, projetos e palestras '+(f.year?'registrados em '+f.year+'.':'agrupados por mês, somando todos os anos.');
    const deliveries=state.records.filter(r=>(!f.year||dateOf(r).startsWith(f.year+'-'))&&DELIVERY_TYPES.has(typeOf(r)));
    const counts=MONTHS.map((_,i)=>deliveries.filter(r=>Number(dateOf(r).slice(5,7))===i+1).length);
    const max=Math.max(...counts,1);
    el('cpMonthlyChart').innerHTML=deliveries.length?'<div class="cp-chart" role="img" aria-label="'+escape(MONTHS.map((m,i)=>m+': '+counts[i]).join('; '))+'">'+counts.map((n,i)=>'<div class="cp-bar-item"><span class="cp-bar-value">'+n+'</span><div class="cp-bar" style="height:'+Math.max(3,n/max*94)+'px"></div><span>'+MONTHS[i]+'</span></div>').join('')+'</div>':'<p class="cp-small">As entregas aparecerão aqui conforme você registrar as datas.</p>';
  }
  function renderCompetencies(records){
    const counts=new Map();records.filter(r=>DELIVERY_TYPES.has(typeOf(r))).forEach(r=>{const key=r.competency||r.domain||'Outras';counts.set(key,(counts.get(key)||0)+1);});
    const top=[...counts].sort((a,b)=>b[1]-a[1]).slice(0,5),max=Math.max(1,...top.map(([,v])=>v));
    el('cpCompetencies').innerHTML=top.length?top.map(([name,n])=>'<div class="cp-skill"><span>'+escape(name)+'</span><div class="cp-meter" aria-hidden="true"><i style="width:'+n/max*100+'%"></i></div><b aria-label="'+n+' registros">'+n+'</b></div>').join(''):'<p class="cp-small">As competências serão agrupadas a partir das suas entregas.</p>';
  }
  function renderFeedbacks(records){
    const recent=filterRecords(records,{view:'feedback'}).slice(0,3);
    el('cpFeedbacks').innerHTML=recent.length?recent.map(r=>'<div class="cp-quote"><blockquote>“'+escape(r.result||titleOf(r))+'”</blockquote><cite>'+escape(r.stakeholder||'Autoria não informada')+' · '+formatDate(dateOf(r))+'</cite></div>').join(''):'<p class="cp-small">Guarde aqui os feedbacks que recebeu. Eles ficam separados dos feedbacks que você dá à equipe.</p>';
  }
  function renderGallery(records){
    const ids=new Set(records.map(r=>r.id));
    const assets=state.assets.filter(a=>ids.has(a.evidence_id));
    el('cpMaterialsCount').textContent=assets.length+' arquivo(s)';
    el('cpGallery').innerHTML=assets.length?assets.map(a=>{
      const r=records.find(r=>r.id===a.evidence_id),image=/^image\/(jpeg|png|webp)$/.test(a.mime_type);
      return '<article class="cp-asset">'+(image?'<img data-cp-image="'+escape(a.id)+'" alt="'+escape(a.file_name)+'" loading="lazy">':'<div class="cp-asset-icon" aria-hidden="true">'+escape(a.file_name.split('.').pop().toUpperCase())+'</div>')+'<div class="cp-asset-body"><strong>'+escape(a.file_name)+'</strong><p>'+escape(titleOf(r))+' · '+formatDate(dateOf(r))+'</p><button type="button" class="cp-text-btn" data-cp-action="file" data-id="'+escape(a.id)+'">Abrir arquivo</button> · <button type="button" class="cp-text-btn" data-cp-action="edit" data-id="'+escape(r.id)+'">Ver registro</button></div></article>';
    }).join(''):'<div style="grid-column:1/-1">'+empty('As provas das suas conquistas','Adicione fotos, certificados e apresentações ao criar ou editar um registro.')+'</div>';
    if(state.view==='materials') hydrateImages();
  }
  async function signedUrl(asset){
    const cached=state.signed.get(asset.id);
    if(cached && cached.until>Date.now())return cached.url;
    const owner=state.owner;
    if(asset.user_id!==owner || owner!==getOwner()) throw new Error('Sessão alterada. Atualize o portfólio.');
    const {data,error}=await client().storage.from(BUCKET).createSignedUrl(asset.storage_path,3600);
    if(error)throw error;
    if(owner!==getOwner() || owner!==state.owner)throw new Error('Sessão alterada.');
    state.signed.set(asset.id,{url:data.signedUrl,until:Date.now()+3300000});return data.signedUrl;
  }
  async function hydrateImages(){
    const owner=state.owner;
    await Promise.all([...document.querySelectorAll('[data-cp-image]')].map(async img=>{
      const asset=state.assets.find(a=>a.id===img.dataset.cpImage);if(!asset)return;
      try{const url=await signedUrl(asset);if(img.isConnected&&owner===state.owner)img.src=url;}catch{img.alt='Não foi possível abrir '+asset.file_name;}
    }));
  }
  async function openAsset(id){
    const asset=state.assets.find(a=>a.id===id);if(!asset)return;
    // Open synchronously in the click handler so the browser does not block the file.
    const target=window.open('about:blank','_blank');if(target)target.opener=null;
    try{const url=await signedUrl(asset);if(target)target.location.replace(url);else{status('O navegador bloqueou a abertura. Permita abrir arquivos em uma nova aba e tente novamente.',true);}}
    catch{target?.close();status('Não consegui abrir o arquivo. Atualize e tente novamente.',true);}
  }
  function openEditor(id=null){
    if(state.saving||!getOwner()||!state.loaded)return;
    const r=id?state.records.find(r=>r.id===id):null;if(id&&!r)return;
    state.editorId=id;state.pendingFiles=[];el('cpForm').reset();el('cpEditorStatus').textContent='';
    el('cpEditorTitle').textContent=id?'Editar registro':'Novo registro';
    el('cpEntryType').value=r?typeOf(r):(TYPES[state.view]?state.view:'delivery');
    el('cpEntryDate').value=r?dateOf(r):today();el('cpEntryTitle').value=r?.title|| (r?titleOf(r):'');
    el('cpFeatured').checked=!!r?.featured;
    const fields={seCompetency:'competency',seStrength:'evidence_strength',seTechnicalArea:'technical_area',seSituation:'situation',seAction:'action_taken',seResult:'result',seImpact:'measurable_impact',seStakeholder:'stakeholder',seLearning:'lesson_learned',seBefore:'before_value',seAfter:'after_value',seUnit:'metric_unit',seSource:'evidence_source'};
    if(r)Object.entries(fields).forEach(([field,key])=>{
      const input=el(field),value=r[key]??'';
      if(input.tagName==='SELECT' && value && ![...input.options].some(o=>o.value===String(value)))input.add(new Option(String(value),String(value)));
      input.value=value;
    });
    el('seStrength').value=r?.evidence_strength||'3';
    if(!el('seCompetency').value)el('seCompetency').value='Técnico/Operacional';
    el('cpEvidenceDetails').open=false;
    editorType();renderEditorFiles();el('cpEditor').showModal();
  }
  function editorType(){
    const t=el('cpEntryType').value;
    el('cpResultLabel').textContent=t==='feedback'?'Feedback que você recebeu':t==='course'?'O que aprendeu e como aplicou?':t==='talk'?'Tema, público e resultado da participação':t==='material'?'Sobre este material':'O que mudou? Qual foi o resultado?';
    el('cpStakeholderLabel').textContent=t==='feedback'?'Quem deu esse feedback?':t==='course'?'Instituição / instrutor':'Pessoas envolvidas';
  }
  function renderEditorFiles(){
    const saved=state.assets.filter(a=>a.evidence_id===state.editorId);
    el('cpEditorFiles').innerHTML=saved.map(a=>'<div class="cp-file-row"><span>'+escape(a.file_name)+' · salvo</span><button type="button" class="cp-text-btn" data-cp-action="remove-file" data-id="'+escape(a.id)+'">Remover</button></div>').join('')+state.pendingFiles.map(file=>'<div class="cp-file-row"><span>'+escape(file.name)+' · aguardando envio</span></div>').join('');
  }
  function editorBusy(busy){
    el('cpSave').disabled=busy;el('cpSave').textContent=busy?'Salvando…':'Salvar registro';
    el('cpCancel').disabled=busy;el('cpClose').disabled=busy;
    [...el('cpForm').elements].forEach(input=>{if(input!==el('cpSave')&&input!==el('cpCancel')&&input!==el('cpClose'))input.disabled=busy;});
  }
  function editorPayload(owner){
    const text=id=>el(id).value.trim();
    return {user_id:owner,title:text('cpEntryTitle'),entry_type:text('cpEntryType'),evidence_date:text('cpEntryDate'),featured:el('cpFeatured').checked,
      competency:text('seCompetency'),domain:text('seCompetency'),technical_area:text('seTechnicalArea')||null,
      evidence_strength:Number(text('seStrength')||3),situation:text('seSituation'),action_taken:text('seAction'),result:text('seResult'),
      measurable_impact:text('seImpact'),stakeholder:text('seStakeholder'),lesson_learned:text('seLearning'),
      before_value:text('seBefore')||null,after_value:text('seAfter')||null,metric_unit:text('seUnit')||null,
      delta_percent:typeof numericDelta==='function'?numericDelta(text('seBefore'),text('seAfter')):null,evidence_source:text('seSource')||null};
  }
  async function save(){
    if(state.saving||state.removing)return;
    if(!el('cpForm').reportValidity())return;
    const owner=getOwner();if(!owner||owner!==state.owner){el('cpEditorStatus').textContent='Sua sessão mudou. Atualize o portfólio antes de salvar.';return;}
    let files;
    try{files=validateFiles(state.pendingFiles,state.assets.filter(a=>a.evidence_id===state.editorId).length);}catch(error){el('cpEditorStatus').textContent=error.message;return;}
    const payload=editorPayload(owner);
    if(!payload.title||!payload.result||!TYPES[payload.entry_type]||!/^\d{4}-\d{2}-\d{2}$/.test(payload.evidence_date)){el('cpEditorStatus').textContent='Preencha título, data e resultado / relato.';return;}
    state.saving=true;editorBusy(true);el('cpEditorStatus').textContent='Salvando seu registro…';
    try{
      // Assign a stable UUID before the first write: a network retry can never create a duplicate.
      if(!state.editorId)state.editorId=crypto.randomUUID();
      const id=state.editorId;
      const {data,error}=await client().from('seniority_evidence').upsert({id,...payload},{onConflict:'id'}).select().single();
      if(error)throw error;
      if(getOwner()!==owner)return;
      const index=state.records.findIndex(r=>r.id===id);if(index<0)state.records.push(data);else state.records[index]=data;
      for(const item of files){
        if(getOwner()!==owner)throw new Error('A sessão mudou durante o envio.');
        const {file,mime,safeName}=item;
        let upload=state.uploads.get(file);
        if(!upload){upload={id:crypto.randomUUID(),path:owner+'/'+id+'/'+crypto.randomUUID()+'-'+safeName};state.uploads.set(file,upload);}
        const path=upload.path;
        const uploaded=await client().storage.from(BUCKET).upload(path,file,{contentType:mime,upsert:false});
        if(uploaded.error && !duplicateUpload(uploaded.error))throw new Error('Registro salvo, mas não consegui enviar '+file.name+'. Tente salvar novamente para reenviar os arquivos pendentes.');
        const asset={id:upload.id,user_id:owner,evidence_id:id,storage_path:path,file_name:file.name,mime_type:mime,file_size:file.size};
        const metadata=await client().from('career_portfolio_assets').insert(asset);
        if(metadata.error){
          // A lost response can follow a committed insert. Verify before cleaning up or retrying.
          const check=await client().from('career_portfolio_assets').select('id').eq('id',asset.id).eq('user_id',owner).maybeSingle();
          if(check.error)throw new Error('Registro salvo. Não consegui confirmar o envio de '+file.name+'. Tente salvar novamente para conferir os arquivos pendentes.');
          if(!check.data){
            const cleanup=await client().storage.from(BUCKET).remove([path]);
            throw new Error('Registro salvo, mas não consegui vincular '+file.name+'. '+(cleanup.error?'O arquivo ficou guardado, porém ainda não está vinculado. ':'')+'Tente salvar novamente para enviar os arquivos pendentes.');
          }
        }
        if(getOwner()!==owner || state.owner!==owner)return;
        if(!state.assets.some(a=>a.id===asset.id))state.assets.push(asset);state.pendingFiles=state.pendingFiles.filter(f=>f!==file);
      }
      if(getOwner()!==owner || state.owner!==owner)return;
      el('cpFiles').value='';
      el('cpEditor').close();state.summaryDrafts.clear();state.summaryKey='';renderYears();el('cpYear').value=payload.evidence_date.slice(0,4);el('cpMonth').value='';el('cpSearch').value='';
      if(TYPES[state.view]&&state.view!==payload.entry_type)state.view=payload.entry_type;
      render();notify('Registro salvo no portfólio.',true);
      // Secondary dashboard updates must never turn a successful save into a failed save.
      if(typeof refreshDashboardMetrics==='function')Promise.resolve(refreshDashboardMetrics()).catch(()=>{});
      if(typeof loadMonthlyReview==='function')Promise.resolve(loadMonthlyReview()).catch(()=>{});
    }catch(error){
      el('cpEditorStatus').textContent=error.message||'Não consegui salvar. Seus dados continuam no formulário para tentar novamente.';renderEditorFiles();render();
    }finally{state.saving=false;editorBusy(false);}
  }
  async function toggleFeatured(id,button){
    const row=state.records.find(r=>r.id===id),owner=getOwner();if(!row||owner!==state.owner)return;
    button.disabled=true;
    try{
      const featured=!row.featured;
      const {data,error}=await client().from('seniority_evidence').update({featured}).eq('id',id).eq('user_id',owner).select('id,featured').single();
      if(error)throw error;if(getOwner()!==owner)return;
      row.featured=data.featured;state.summaryDrafts.clear();state.summaryKey='';render();
    }catch{status('Não consegui alterar o destaque. Tente novamente.',true);}finally{button.disabled=false;}
  }
  async function removeAsset(id){
    if(state.saving||state.removing)return;
    const asset=state.assets.find(a=>a.id===id),owner=getOwner();if(!asset||owner!==state.owner)return;
    if(!window.confirm('Remover o arquivo “'+asset.file_name+'” deste registro?'))return;
    state.removing=true;editorBusy(true);
    try{
      const removed=await client().storage.from(BUCKET).remove([asset.storage_path]);if(removed.error)throw removed.error;
      const {error}=await client().from('career_portfolio_assets').delete().eq('id',id).eq('user_id',owner);if(error)throw error;
      if(getOwner()!==owner)return;
      state.assets=state.assets.filter(a=>a.id!==id);state.signed.delete(id);renderEditorFiles();render();el('cpEditorStatus').textContent='Arquivo removido.';
    }catch{el('cpEditorStatus').textContent='Não consegui concluir a remoção. Tente remover novamente.';}
    finally{state.removing=false;editorBusy(false);}
  }
  function linkedinRows(){
    const f=filters();return linkedinCandidates(filterRecords(state.records,{...f,view:state.linkedinSourceView}));
  }
  function renderLinkedin(force=false){
    const f=filters(),mode=el('cpLinkedInMode').value||'achievement';
    const rows=linkedinRows();
    const available=mode==='learning'?rows.filter(r=>r.lesson_learned?.trim()):rows;
    const sourceKey=JSON.stringify([state.owner,f.year,f.month,f.search,state.linkedinSourceView,mode,...available.map(r=>r.id)]);
    if(sourceKey!==state.linkedinSourceKey){
      state.linkedinSourceKey=sourceKey;
      state.linkedinSelected=available.slice(0,mode==='review'?3:1).map(r=>r.id);
    }
    state.linkedinSelected=state.linkedinSelected.filter(id=>rows.some(r=>r.id===id));
    const selected=state.linkedinSelected.map(id=>rows.find(r=>r.id===id)).filter(Boolean);
    state.linkedinKey=JSON.stringify([sourceKey,...state.linkedinSelected]);
    const draft=force?null:state.linkedinDrafts.get(state.linkedinKey);
    if(force)state.linkedinDrafts.delete(state.linkedinKey);
    el('cpLinkedInText').value=draft??linkedinText(selected,periodLabel(f),mode);
    el('cpLinkedInCopyStatus').textContent='';
    const kind=TYPES[state.linkedinSourceView];
    el('cpLinkedInPeriod').textContent=periodLabel(f)+(kind?' · '+kind:'')+(f.search.trim()?' · busca: “'+f.search.trim()+'”':'');
    el('cpLinkedInSelectionHint').textContent=mode==='review'?'Selecione até 3 registros para o balanço.':'Selecione o registro que vai virar publicação.';
    el('cpLinkedInSources').innerHTML=rows.length?rows.map(r=>'<label class="cp-li-source"><input type="checkbox" data-cp-linkedin-source="'+escape(r.id)+'" '+(state.linkedinSelected.includes(r.id)?'checked':'')+'><span><strong>'+escape(titleOf(r))+'</strong><small>'+TYPES[typeOf(r)]+' · '+formatDate(dateOf(r))+(r.featured?' · Em destaque':'')+'</small></span></label>').join(''):'<p class="cp-small">Adicione uma conquista ou altere os filtros para preparar seu texto.</p>';
    const noLearning=mode==='learning'&&selected.length&&!selected[0].lesson_learned?.trim();
    el('cpLinkedInText').placeholder=noLearning?'Este registro ainda não tem um aprendizado. Complete esse campo em Editar registro ou escolha outro foco.':rows.length?'Escolha um registro ao lado para ver o texto pronto.':'Assim que você registrar uma conquista, o rascunho aparece aqui.';
    if(mode==='learning'&&!selected.length&&rows.length)el('cpLinkedInText').placeholder='Nenhum aprendizado foi preenchido nesses registros. Escolha Uma conquista ou complete o campo Aprendizado em um registro.';
    linkedinCount();
  }
  function linkedinCount(){
    const text=el('cpLinkedInText').value.trim();el('cpLinkedInCount').textContent=text.length+' caracteres';el('cpLinkedInCopy').disabled=!text;
  }
  async function copyLinkedin(){
    const text=el('cpLinkedInText').value.trim();if(!text)return;
    try{await navigator.clipboard.writeText(text);el('cpLinkedInCopyStatus').textContent='Texto copiado. Agora você pode colar no LinkedIn.';}
    catch{el('cpLinkedInText').focus();el('cpLinkedInText').select();el('cpLinkedInCopyStatus').textContent='Selecione e copie o texto para colar no LinkedIn.';}
  }
  function setView(view){if(view==='linkedin'&&state.view!=='linkedin')state.linkedinSourceView=TYPES[state.view]?state.view:'overview';state.view=view;render();}
  async function copySummary(){
    try{await navigator.clipboard.writeText(el('cpSummaryText').value);el('cpCopyStatus').textContent='Resumo copiado. Revise antes de compartilhar.';}
    catch{el('cpSummaryText').focus();el('cpSummaryText').select();el('cpCopyStatus').textContent='Selecione e copie o texto do resumo.';}
  }
  function closeEditor(){if(state.saving||state.removing)return;el('cpEditor').close();}
  el('cpForm').addEventListener('submit',event=>{event.preventDefault();save();});
  el('cpFiles').addEventListener('change',()=>{
    state.pendingFiles=[...el('cpFiles').files];el('cpEditorStatus').textContent='';
    try{validateFiles(state.pendingFiles,state.assets.filter(a=>a.evidence_id===state.editorId).length);}catch(error){el('cpEditorStatus').textContent=error.message;}
    renderEditorFiles();
  });
  el('cpEntryType').addEventListener('change',editorType);
  el('cpAdd').addEventListener('click',()=>openEditor());el('cpClose').addEventListener('click',closeEditor);el('cpCancel').addEventListener('click',closeEditor);
  el('cpEditor').addEventListener('cancel',event=>{if(state.saving||state.removing)event.preventDefault();});
  el('cpRefresh').addEventListener('click',()=>load(true));
  ['cpYear','cpMonth'].forEach(id=>el(id).addEventListener('change',render));el('cpSearch').addEventListener('input',render);
  el('cpCopy').addEventListener('click',copySummary);
  el('cpSummaryText').addEventListener('input',()=>{state.summaryDrafts.set(state.summaryKey,el('cpSummaryText').value);});
  el('cpRegenerate').addEventListener('click',()=>{const f=filters();state.summaryDrafts.delete(state.summaryKey);el('cpSummaryText').value=summaryText(filterRecords(state.records,f),summaryLabel(f));el('cpCopyStatus').textContent='Resumo refeito a partir dos registros atuais.';});
  el('cpLinkedInMode').addEventListener('change',()=>renderLinkedin());
  el('cpLinkedInText').addEventListener('input',()=>{state.linkedinDrafts.set(state.linkedinKey,el('cpLinkedInText').value);el('cpLinkedInCopyStatus').textContent='';linkedinCount();});
  el('cpLinkedInRegenerate').addEventListener('click',()=>renderLinkedin(true));
  el('cpLinkedInCopy').addEventListener('click',copyLinkedin);
  el('cpLinkedInSources').addEventListener('change',event=>{
    const input=event.target.closest('[data-cp-linkedin-source]');if(!input)return;
    const id=input.dataset.cpLinkedinSource,mode=el('cpLinkedInMode').value;
    if(!input.checked)state.linkedinSelected=state.linkedinSelected.filter(x=>x!==id);
    else if(mode!=='review')state.linkedinSelected=[id];
    else if(state.linkedinSelected.length<3)state.linkedinSelected.push(id);
    else{input.checked=false;el('cpLinkedInCopyStatus').textContent='Escolha até 3 registros. Desmarque um deles para incluir outro.';return;}
    renderLinkedin();
  });
  document.querySelector('section.page[data-page="senioridade"]').addEventListener('click',event=>{
    const button=event.target.closest('[data-cp-view],[data-cp-action]');if(!button)return;
    if(button.dataset.cpView){setView(button.dataset.cpView);return;}
    const action=button.dataset.cpAction,id=button.dataset.id;
    if(action==='new')openEditor();if(action==='edit')openEditor(id);if(action==='feature')toggleFeatured(id,button);if(action==='file')openAsset(id);if(action==='remove-file')removeAsset(id);
  });
  // Keep the host app's existing entry points and integrations intact.
  loadSeniorityEvidence=function(){return load(true);};
  saveSeniorityEvidence=save;
  window.CareerPortfolio={load,openEditor};
  renderYears();render();
  if(getOwner())load();
})();
