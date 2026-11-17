const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const {typeOf,filterRecords,statistics,summaryText,sourceLink,validateFiles,duplicateUpload} = require('../career-portfolio.js');

const evidence=[
  {id:'old',user_id:'owner',evidence_date:'2025-11-02',competency:'Projeto estratégico',result:'Entrega anterior'},
  {id:'a',user_id:'owner',evidence_date:'2026-11-03',entry_type:'delivery',title:'Redução de tempo',result:'7 para 3 minutos',competency:'Processo/Sistema',before_value:'7',after_value:'3',metric_unit:'min'},
  {id:'b',user_id:'owner',evidence_date:'2026-10-12',entry_type:'feedback',title:'Feedback recebido',result:'Condução clara',stakeholder:'Colega'},
  {id:'c',user_id:'owner',evidence_date:'2026-11-08',entry_type:'course',title:'Curso de negociação',result:'Preparação de reuniões'},
  {id:'d',user_id:'owner',evidence_date:'2026-11-04',entry_type:'project',title:'Novo fluxo',result:'Equipes integradas',featured:true}
];
assert.equal(typeOf(evidence[0]),'project','Legacy strategic projects retain their classification');
assert.deepEqual(filterRecords(evidence,{year:'2026',month:'11'}).map(r=>r.id),['c','d','a']);
assert.deepEqual(filterRecords(evidence,{search:'reducao'}).map(r=>r.id),['a'],'Search ignores accents');
assert.deepEqual(filterRecords(evidence,{year:'2026',view:'feedback'}).map(r=>r.id),['b']);
const stats=statistics(evidence.slice(1),[{priorities_planned:5,priorities_completed:4},{priorities_planned:10,priorities_completed:5}]);
assert.equal(stats.deliveries,2,'Courses and feedback are not counted as deliveries');
assert.equal(stats.feedbacks,1);assert.equal(stats.courses,1);assert.equal(stats.projects,1);
assert.equal(stats.completion,60,'Aggregate completion uses planned counts, not averages of percentages');
assert.equal(statistics([]).completion,null,'No fabricated goal percentage without scorecard priorities');
assert.equal(statistics([],[{priorities_planned:0,priorities_completed:2}]).completion,null);
assert.match(summaryText(evidence.slice(1),'2026'),/7 → Depois: 3 min/);
assert.match(summaryText([],'2027'),/Ainda não há registros para 2027/);
assert.equal(sourceLink('javascript:alert(1)'),null);assert.equal(sourceLink('data:text/html,test'),null);
assert.equal(sourceLink('https://example.com/report'),'https://example.com/report');
assert.throws(()=>validateFiles([{name:'photo.svg',size:100}]),/Formato/);
assert.throws(()=>validateFiles([{name:'big.pdf',size:21*1024*1024}]),/20 MB/);
assert.throws(()=>validateFiles([{name:'x.pdf',size:10}],10),/10 arquivos/);
assert.equal(validateFiles([{name:'certificado.PDF',size:10,type:''}])[0].mime,'application/pdf');
assert(duplicateUpload({statusCode:'409'}));assert(duplicateUpload({statusCode:'400',message:'The resource already exists'}));
assert(!duplicateUpload({statusCode:'400',message:'Invalid MIME type'}));

// Run the actual UI controller against an in-memory adapter. No production rows or files are created.
async function controllerTests(){
  class Element{
    constructor(id){this.id=id;this.value='';this.innerHTML='';this.textContent='';this.dataset={};this.listeners={};this.options=[];this.tagName='INPUT';this.files=[];this.disabled=false;this.open=false;this.checked=false;this.style={};this.elements=[];}
    addEventListener(name,fn){this.listeners[name]=fn;}
    setAttribute(){} add(option){this.options.push(option);} reportValidity(){return true;}
    showModal(){this.open=true;} close(){this.open=false;} reset(){} focus(){} select(){}
  }
  const nodes=new Map(),el=id=>{if(!nodes.has(id))nodes.set(id,new Element(id));return nodes.get(id);};
  const document={getElementById:el,querySelector:()=>el('section'),querySelectorAll:()=>[]};
  const rows=[],assets=[],objects=new Set(),queries=[],writeIds=[],uploadPaths=[];
  let failUpload=true,failMetadata=false,failRead=false,uid='owner',sequence=0;
  const client={from(table){let mode='read',payload,filters=[],single=false,range=[0,999];
    const q={select(){return q},eq(k,v){filters.push([k,v]);return q},order(){return q},range(a,b){range=[a,b];return q},
      upsert(p){mode='upsert';payload=p;return q},insert(p){mode='insert';payload=p;return q},update(p){mode='update';payload=p;return q},delete(){mode='delete';return q},single(){single=true;return q},maybeSingle(){single=true;return q},
      then(ok,bad){queries.push({table,mode,filters});let result;
        if(mode==='read'){
          if(failRead)return Promise.resolve({data:null,error:{message:'offline'}}).then(ok,bad);
          result=(table==='seniority_evidence'?rows:table==='career_portfolio_assets'?assets:[]).filter(r=>filters.every(([k,v])=>r[k]===v)).slice(range[0],range[1]+1);if(single)result=result[0]||null;
        }else if(mode==='upsert'){
          writeIds.push(payload.id);const i=rows.findIndex(r=>r.id===payload.id);if(i<0)rows.push({...payload});else rows[i]={...rows[i],...payload};result={...payload};
        }else if(mode==='insert'){
          // Simulate a committed metadata insert with a lost network response.
          if(!assets.some(r=>r.id===payload.id))assets.push({...payload});
          if(failMetadata){failMetadata=false;return Promise.resolve({data:null,error:{message:'response lost'}}).then(ok,bad);}
          result=payload;
        }
        return Promise.resolve({data:result,error:null}).then(ok,bad);
      }};return q;},storage:{from(){return {async upload(p){uploadPaths.push(p);if(failUpload){failUpload=false;return {error:{statusCode:500}};}objects.add(p);return {error:null};},async remove(paths){paths.forEach(p=>objects.delete(p));return {error:null};},async createSignedUrl(p){return {data:{signedUrl:'https://example.com/private/'+p},error:null};}};}}};
  const context={document,window:{},sb:client,console,URL,Option:class{constructor(text,value){this.text=text;this.value=value;}},crypto:{randomUUID:()=> 'test-uuid-'+(++sequence)},setTimeout,clearTimeout,
    get currentUserId(){return uid;},loadSeniorityEvidence(){},saveSeniorityEvidence(){},isoDateLocal:()=> '2026-11-17',numericDelta:()=>null,cloudMsg(){},refreshDashboardMetrics:async()=>{},loadMonthlyReview:async()=>{}};
  vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../career-portfolio.js'),'utf8'),context);
  await context.window.CareerPortfolio.load();
  context.window.CareerPortfolio.openEditor();
  el('cpEntryTitle').value='Entrega nova';el('cpEntryType').value='delivery';el('cpEntryDate').value='2026-11-17';el('seResult').value='Resultado real';el('seCompetency').value='Processo/Sistema';el('seStrength').value='4';
  el('cpFiles').files=[{name:'prova.pdf',size:100}];el('cpFiles').listeners.change();
  await context.saveSeniorityEvidence();
  assert.match(el('cpEditorStatus').textContent,/Registro salvo, mas/);
  assert.equal(el('cpEditor').open,true,'An upload failure keeps the editor available to retry');
  assert.equal(rows.length,1,'The parent is saved exactly once');
  failMetadata=true;
  await context.saveSeniorityEvidence();
  assert.equal(rows.length,1,'Retry updates the same stable entry UUID');
  assert.equal(new Set(writeIds).size,1);
  assert.equal(new Set(uploadPaths).size,1,'A retry reuses the pending file path');
  assert.equal(assets.length,1,'A lost metadata response is confirmed, never duplicated');
  assert.equal(objects.size,1,'Committed metadata never loses its referenced object');
  assert.equal(el('cpEditor').open,false,'The editor closes only after every file is confirmed');
  assert.match(el('cpSummaryText').value,/Entrega nova/,'An initial empty state never becomes a stale draft after data loads');
  assert(queries.filter(q=>q.mode==='read').every(q=>q.filters.some(([k])=>k==='user_id')),'All archive reads are explicitly scoped to the signed-in owner');
  const before=el('seniorityList').innerHTML;failRead=true;await context.window.CareerPortfolio.load(true);
  assert.equal(el('seniorityList').innerHTML,before,'A failed refresh preserves the last confirmed list');
  assert.match(el('cpStatus').textContent,/última leitura/);
  // Replacing an account must not display the previous account's records during a failed read.
  uid='other';await context.window.CareerPortfolio.load(true);
  assert(!el('seniorityList').innerHTML.includes('Entrega nova'),'An account change clears private data even when the new read fails');
}
controllerTests().then(()=>console.log('PASS: period filters, factual metrics, legacy records, safe links and files, owner-scoped reads, idempotent saves, partial-upload retries and account isolation.')).catch(error=>{console.error(error);process.exitCode=1;});
