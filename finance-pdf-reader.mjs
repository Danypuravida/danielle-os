// Passwords and document bytes stay in the browser.
let fallbackPromise;
export function loadFinancePdfFallback(){
  if(globalThis.pdfjsLib)return Promise.resolve(globalThis.pdfjsLib);
  if(!fallbackPromise){
    fallbackPromise=new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      const fail=()=>{clearTimeout(timer);script.remove();reject(Error('Não consegui carregar o leitor alternativo de PDF. Verifique a conexão e tente novamente.'))};
      const timer=setTimeout(fail,20000);
      script.src='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      script.async=true;script.referrerPolicy='no-referrer';
      script.onerror=fail;
      script.onload=()=>{clearTimeout(timer);if(globalThis.pdfjsLib)resolve(globalThis.pdfjsLib);else fail()};
      document.head.appendChild(script);
    }).catch(error=>{fallbackPromise=null;throw error});
  }
  return fallbackPromise;
}
function compatibilityFailure(error){
  return error instanceof TypeError || /worker|fetch|module|withResolvers|Promise\.try|unsupported|not supported/i.test(error?.message||'');
}
function passwordError(error){
  return error?.code===2
    ? Error('Senha do PDF incorreta. Confira a senha do arquivo e tente novamente.')
    : Error('PDF protegido: informe a senha do arquivo e tente novamente.');
}
export async function extractFinancePdfText(file,password='',{
  loadPrimary=()=>import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs'),
  loadFallback=loadFinancePdfFallback
}={}){
  const bytes=new Uint8Array(await file.arrayBuffer());
  let pdf,task;
  const open=async(loader,workerSrc)=>{
    const reader=await loader();
    reader.GlobalWorkerOptions.workerSrc=workerSrc;
    // Each attempt needs its own buffer: PDF.js may transfer it to a worker.
    task=reader.getDocument({data:bytes.slice(),password:password||undefined});
    return await task.promise;
  };
  try{
    try{
      pdf=await open(loadPrimary,'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs');
    }catch(error){
      if(error?.name==='PasswordException')throw passwordError(error);
      if(!compatibilityFailure(error))throw error;
      if(task){try{await task.destroy()}catch{}task=null}
      pdf=await open(loadFallback,'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js');
    }
    const lines=[];
    for(let p=1;p<=pdf.numPages;p++){
      const page=await pdf.getPage(p);
      try{
        const content=await page.getTextContent(),byY=new Map();
        for(const item of content.items){
          const y=Math.round(item.transform?.[5]||0),x=item.transform?.[4]||0;
          if(!byY.has(y))byY.set(y,[]);
          byY.get(y).push({x,s:item.str||''});
        }
        for(const y of [...byY.keys()].sort((a,b)=>b-a)){
          const line=byY.get(y).sort((a,b)=>a.x-b.x).map(z=>z.s).join(' ').replace(/\s+/g,' ').trim();
          if(line)lines.push(line);
        }
      }finally{page.cleanup()}
    }
    const text=lines.join('\n');
    if(!text.trim())throw Error('O PDF não contém texto legível. Selecione o Excel original da fatura.');
    return text;
  }catch(error){
    if(error?.name==='PasswordException')throw passwordError(error);
    if(error?.name==='InvalidPDFException')throw Error('O arquivo PDF está inválido ou incompleto. Baixe o original novamente.');
    if(compatibilityFailure(error))throw Error('Não consegui iniciar o leitor de PDF neste navegador. Verifique a conexão e tente novamente; se persistir, use o Excel da fatura.');
    throw error;
  }finally{
    if(pdf){try{await pdf.destroy()}catch{}}
    else if(task){try{await task.destroy()}catch{}}
  }
}
