const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
assert.match(html.trim(),/<\/body>\s*<\/html>$/i,'The published page must have its complete document ending');
const opens=[...html.matchAll(/<script\b/gi)],closes=[...html.matchAll(/<\/script\s*>/gi)];
assert.equal(opens.length,closes.length,'A truncated script must never pass page verification');
for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi))if(!/\bsrc\s*=|type\s*=\s*["']application\//i.test(m[1]))new vm.Script(m[2]);
for(const marker of ['let jamesHealth=','const jamesTriageOriginal=','function shouldResumeJamesRead(','function renderTravelList(','function toggleTravelItem(','const jamesLoadOriginal='])assert(html.includes(marker),'Missing required app behavior: '+marker);
console.log('PASS: complete HTML document, every script closed and parsed, source health, triage confirmation, resume and checklist retained.');
