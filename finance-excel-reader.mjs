// Decrypt protected Excel files locally; passwords never enter an import payload.
let decryptorPromise;
const compatibleDecryptors=new WeakMap();
async function supportInlineCells(decryptor){
  if(!compatibleDecryptors.has(decryptor)){
    const ready=(async()=>{
      // xlsx-populate 1.21.0 crashes on empty inlineStr cells and exports
      // inline rich-text arrays without their text. C6 uses both forms.
      // This importer needs text values, so normalize them before parsing.
      const blank=await decryptor.fromBlankAsync();
      const prototype=Object.getPrototypeOf(blank.sheet(0).cell('A1'));
      const parseNode=prototype._parseNode;
      if(typeof parseNode!=='function')throw Error('Leitor de Excel incompatível com células vazias.');
      prototype._parseNode=function(node){
        if(node?.attributes?.t==='inlineStr'){
          const text=n=>n?.name==='t'?(n.children||[]).join(''):(n?.children||[]).map(text).join('');
          const inline=(node.children||[]).find(child=>child?.name==='is');
          node={...node,attributes:{...node.attributes,t:'str'},children:[
            ...(node.children||[]).filter(child=>child?.name!=='is'&&child?.name!=='v'),
            {name:'v',attributes:{},children:[text(inline)]}
          ]};
        }
        return parseNode.call(this,node);
      };
    })().catch(error=>{compatibleDecryptors.delete(decryptor);throw error});
    compatibleDecryptors.set(decryptor,ready);
  }
  await compatibleDecryptors.get(decryptor);
}
export async function loadExcelDecryptor(){
  if(globalThis.XlsxPopulate)return globalThis.XlsxPopulate;
  if(!decryptorPromise){
    decryptorPromise=new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      const timer=setTimeout(()=>{script.remove();reject(Error('O leitor de Excel protegido demorou para carregar. Verifique a conexão e tente novamente.'))},20000);
      script.src='https://cdn.jsdelivr.net/npm/xlsx-populate@1.21.0/browser/xlsx-populate.min.js';
      script.referrerPolicy='no-referrer';script.async=true;
      script.onload=()=>{clearTimeout(timer);if(globalThis.XlsxPopulate)resolve(globalThis.XlsxPopulate);else{script.remove();reject(Error('Não consegui iniciar o leitor de Excel protegido. Tente novamente.'))}};
      script.onerror=()=>{clearTimeout(timer);script.remove();reject(Error('Não consegui carregar o leitor de Excel protegido. Verifique a conexão e tente novamente.'))};
      document.head.appendChild(script);
    }).catch(error=>{decryptorPromise=null;throw error});
  }
  return decryptorPromise;
}
export async function readFinanceExcelWorkbook(data,password='',{loadReader=()=>import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs'),loadDecryptor=loadExcelDecryptor}={}){
  let XLSX;
  try{XLSX=await loadReader()}catch{throw Error('Não consegui carregar o leitor de Excel. Verifique a conexão e tente novamente.')}
  const options={type:'array',cellDates:true,password:password||undefined};
  try{return {XLSX,book:XLSX.read(data,options)}}catch(error){
    if(!/password|encrypt|decrypt|protegido|senha/i.test(error?.message||''))throw error;
    if(!password)throw Error('Excel protegido: informe a senha do arquivo no campo acima e tente novamente.');
  }
  const decryptor=await loadDecryptor();
  await supportInlineCells(decryptor);
  let clearData;
  try{
    const workbook=await decryptor.fromDataAsync(data,{password});
    clearData=await workbook.outputAsync({type:'arraybuffer'});
  }catch(error){
    if(/unsupported|not supported|standard encryption|agile.*only/i.test(error?.message||''))throw Error('Esse tipo de proteção do Excel ainda não é compatível. Salve uma cópia em .xlsx ou use a fatura em PDF.');
    if(error instanceof TypeError||error?.name==='TypeError')throw Error('O leitor encontrou uma estrutura de planilha incompatível. Tente a fatura em PDF. Esse erro não confirma senha incorreta.');
    throw Error('Não consegui abrir o Excel com essa senha. Confira a senha do arquivo e tente novamente.');
  }
  return {XLSX,book:XLSX.read(clearData,{type:'array',cellDates:true})};
}
