const assert=require('node:assert/strict');
const {driveFile,sourcePayload,selectBrief,briefText}=require('../team-development.js');
assert.throws(()=>driveFile('javascript:alert(1)'));
assert.throws(()=>driveFile('https://example.com/private'));
assert.throws(()=>driveFile('https://drive.google.com/drive/folders/folder'));
assert.throws(()=>driveFile('https://attacker@drive.google.com/file/d/test/view'));
assert.equal(driveFile('https://docs.google.com/document/d/doc-id/edit?token=discard').url,'https://drive.google.com/file/d/doc-id/view');
const input={title:'Conversa individual',kind:'transcript',person_key:'manu',content:'Texto factual'};
const row=sourcePayload(input,'owner','stable-id');assert.equal(row.user_id,'owner');assert.equal(row.source_key,'local:stable-id');assert.equal(row.analysis_status,'pending');assert.equal(row.content,'Texto factual');
assert.throws(()=>sourcePayload({...input,content:''},'owner','id'),/Cole/);
assert.throws(()=>sourcePayload({...input,content:'x'.repeat(1000001)},'owner','id'),/milhão/);
const withLink=sourcePayload({...input,url:'https://drive.google.com/file/d/doc-id/view'},'owner','id');assert.equal(withLink.metadata.user_context,'Texto factual','Pasted context survives later extraction of the Drive file');
const briefs=[{person_key:'manu',kind:'one_on_one',created_at:'2026-11-01',body:{title:'Anterior'}},{person_key:'marcos',kind:'one_on_one',created_at:'2027-01-01',body:{title:'Outra pessoa'}},{person_key:'manu',kind:'one_on_one',created_at:'2026-11-18',body:{title:'Atual',unknowns:['Sem transcrição anterior'],actions:[{title:'Validar uma melhoria',owner_proposed:'A combinar',evidence:'Exemplo observado'}]}},{person_key:'team',kind:'cafe',created_at:'2026-11-18',body:{title:'Café'}}];
assert.equal(selectBrief(briefs,'one_on_one','manu').body.title,'Atual');assert.equal(selectBrief(briefs,'cafe','manu').body.title,'Café');assert.equal(selectBrief(briefs,'action_plan','manu'),null);assert.equal(briefText(null),'');assert(briefText(briefs[2]).includes('A confirmar: Sem transcrição anterior'));assert(briefText(briefs[2]).includes('Prazo: A combinar'));assert(!briefText(briefs[2]).includes('Outra pessoa'));
console.log('PASS: safe source URLs, owned pending imports, stable retry IDs, manual context retention, per-person briefs and honest copied drafts.');


const {actionData,personContext}=require('../team-development.js');
assert.throws(()=>actionData({title:'Concluir',status:'done'}),/evidência/);
assert.equal(actionData({title:'Concluir',status:'done',completion_note:'Guia testado em uma execução'}).status,'done');
assert.equal(actionData({title:'A combinar'}).due_proposed,null);
const ctx=personContext({sync:{settings:{people:[{key:'manu',member_id:'m'}]}},workspace:{team:{members:[{id:'m',development:{actions:[{title:'PDI Manu'}]}}]},formsOneOnOne:{responses:[{memberId:'m',submittedAt:'2026-11-11'},{memberId:'n'}]}},meetings:[{team_member_id:'n',commitments:'Nath'},{team_member_id:'m',commitments:'Manu'}]},'manu');
assert.equal(ctx.responses.length,1);assert.equal(ctx.meetings.length,1);assert.equal(ctx.meetings[0].commitments,'Manu');assert.equal(ctx.development.actions[0].title,'PDI Manu');
assert.equal(personContext({},'marcos').meetings.length,0);
assert.equal(sourcePayload({...input,context:'whatsapp'},'owner','id').metadata.context,'whatsapp');
console.log('PASS: evidence required for completion; unknown deadlines; person-specific PDI, Forms and meetings; WhatsApp context.');
