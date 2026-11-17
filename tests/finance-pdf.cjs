const assert=require('node:assert/strict');
(async()=>{
  const {extractFinancePdfText}=await import('../finance-pdf-reader.mjs');
  const file={arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer};
  let opened=[],destroyed=0,taskDestroyed=0;
  function reader(failure){
    return {GlobalWorkerOptions:{},getDocument(options){
      opened.push(options);
      return {promise:failure?Promise.reject(failure):Promise.resolve({
        numPages:1,getPage:async()=>({getTextContent:async()=>({items:[
          {str:'20,00',transform:[0,0,0,0,80,20]},
          {str:'LOJA',transform:[0,0,0,0,20,20]},
          {str:'Fatura',transform:[0,0,0,0,20,40]}
        ]}),cleanup(){}}),destroy:async()=>{destroyed++}
      }),destroy:async()=>{taskDestroyed++}};
    }};
  }
  let fallbackCalls=0;
  const good=async()=>{fallbackCalls++;return reader()};
  let text=await extractFinancePdfText(file,'test-password',{loadPrimary:async()=>reader(),loadFallback:good});
  assert.equal(text,'Fatura\nLOJA 20,00');assert.equal(fallbackCalls,0);assert.equal(destroyed,1);
  opened=[];
  text=await extractFinancePdfText(file,'test-password',{loadPrimary:async()=>reader(new TypeError('Promise.withResolvers is not a function')),loadFallback:good});
  assert.equal(text,'Fatura\nLOJA 20,00');assert.equal(fallbackCalls,1);assert.equal(taskDestroyed,1);
  assert.equal(opened.length,2);assert.notEqual(opened[0].data.buffer,opened[1].data.buffer);
  assert(opened.every(o=>o.password==='test-password'));
  for(const code of [1,2]){
    const password=Object.assign(Error('Password'),{name:'PasswordException',code});
    const count=fallbackCalls;
    await assert.rejects(extractFinancePdfText(file,'',{loadPrimary:async()=>reader(password),loadFallback:good}),code===2?/incorreta/:/informe a senha/);
    assert.equal(fallbackCalls,count);
  }
  const invalid=Object.assign(Error('Invalid'),{name:'InvalidPDFException'});
  await assert.rejects(extractFinancePdfText(file,'',{loadPrimary:async()=>reader(invalid),loadFallback:good}),/inválido ou incompleto/);
  await assert.rejects(extractFinancePdfText(file,'',{loadPrimary:async()=>{throw TypeError('Failed to fetch')},loadFallback:async()=>{throw TypeError('Failed to fetch')}}),/leitor de PDF neste navegador/);
  await assert.rejects(extractFinancePdfText(file,'test-password',{loadPrimary:async()=>{throw TypeError('module')},loadFallback:async()=>reader(Object.assign(Error('Password'),{name:'PasswordException',code:2}))}),/incorreta/);
  console.log('PDF reader checks passed: compatibility retry, password forwarding, separate buffers, cleanup, password errors and invalid PDF.');
})().catch(error=>{console.error(error);process.exit(1)});
