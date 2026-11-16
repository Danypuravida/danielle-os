// Shared by the browser preview and the authenticated importer. No account data here.
export function cardNormalize(value){return String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim().toUpperCase()}
export function cardAmount(value){
  if(typeof value==='number'){if(Number.isFinite(value))return value;throw Error('Valor inválido na fatura.')}
  let s=String(value??'').trim().replace(/\u00a0/g,' '),negative=/^-|^\(|-$/.test(s);
  s=s.replace(/R\$|\s|[()+-]/g,'');
  if(!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{2})$/.test(s)&&!/^\d+(?:\.\d{1,2})?$/.test(s))throw Error('Valor não reconhecido na fatura: '+String(value));
  const n=Number(s.includes(',')?s.replace(/\./g,'').replace(',','.'):s);
  if(!Number.isFinite(n))throw Error('Valor inválido na fatura.');return (negative?-1:1)*n;
}
export function cardDate(value,billingMonth){
  const s=String(value??'').trim();let iso;
  if(/^\d{4}-\d{2}-\d{2}$/.test(s))iso=s;
  else{
    const m=s.match(/^(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2}|\d{4}))?$/);
    if(!m)throw Error('Data não reconhecida na fatura: '+s);
    let y=m[3]?Number(m[3]):Number(billingMonth.slice(0,4));if(y<100)y+=2000;
    if(!m[3]&&Number(m[2])>Number(billingMonth.slice(5,7)))y--;
    iso=`${y}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  }
  const d=new Date(iso+'T12:00:00Z');
  if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==iso)throw Error('Data inválida na fatura: '+s);
  return iso;
}
export function requireCardMonth(month){if(!/^20\d{2}-(0[1-9]|1[0-2])(?:-01)?$/.test(String(month)))throw Error('Informe o mês de vencimento da fatura.');return String(month).slice(0,7)}
const aliases={
  description:['DESCRICAO','ESTABELECIMENTO','LANCAMENTO','HISTORICO','NOME DO ESTABELECIMENTO'],
  date:['DATA DE COMPRA','DATA DA COMPRA','DATA','DATA DA TRANSACAO'],
  amount:['VALOR (EM R$)','VALOR EM R$','VALOR (R$)','VALOR R$','VALOR','VALOR EM REAIS','VALOR DA COMPRA'],
  category:['CATEGORIA'],last4:['FINAL DO CARTAO','FINAL CARTAO','CARTAO','ULTIMOS 4 DIGITOS'],installment:['PARCELA','PARCELAS']
};
function headerMap(row){const keys=row.map(cardNormalize);return Object.fromEntries(Object.entries(aliases).map(([k,aa])=>[k,keys.findIndex(x=>aa.includes(x))]))}
export function cardTableHasHeader(table){return table.some(r=>{const h=headerMap(r);return h.description>=0&&h.date>=0&&h.amount>=0})}
function last4(value,fallback){let s=String(value??'').trim()||String(fallback||'');if(!s)return '';if(/^\d{1,4}$/.test(s))s=s.padStart(4,'0');const m=s.match(/(?:^|\D)(\d{4})$/);if(!m)throw Error('Final do cartão inválido. Informe os quatro últimos números.');return m[1]}
export function parseCardTable(table,{billingMonth,cardLast4=''}={}){
  billingMonth=requireCardMonth(billingMonth);let index=-1,h;
  for(let i=0;i<table.length;i++){const candidate=headerMap(table[i]);if(candidate.description>=0&&candidate.date>=0&&candidate.amount>=0){index=i;h=candidate;break}}
  if(index<0)throw Error('Não encontrei as colunas Data, Descrição e Valor. Selecione a planilha original exportada pelo cartão.');
  const out=[];
  for(let i=index+1;i<table.length;i++){
    const r=table[i];if(!r.some(x=>String(x??'').trim()))continue;
    if(cardTableHasHeader([r]))continue;
    const desc=String(r[h.description]??'').trim(),date=String(r[h.date]??'').trim(),value=r[h.amount];
    if(!date&&/^TOTAL(?:\b|\s)/.test(cardNormalize(desc)))continue;
    if(!date||!desc||String(value??'').trim()==='')throw Error(`Linha ${i+1} incompleta: confira data, descrição e valor antes de importar.`);
    const installment=h.installment<0?'':String(r[h.installment]??'').trim();
    if(installment&&!/^\d+\s*\/\s*\d+$/.test(installment)&&!/^(?:-|0?1|UNICA|A VISTA|AVISTA)$/.test(cardNormalize(installment)))throw Error(`Parcela não reconhecida na linha ${i+1}.`);
    out.push({description:desc,purchase_date:cardDate(date,billingMonth),amount:cardAmount(value),category:h.category<0?'':String(r[h.category]??'').trim(),last4:last4(h.last4<0?'':r[h.last4],cardLast4),installment:installment.includes('/')?installment.replace(/\s/g,''):''});
  }
  if(!out.length)throw Error('Não encontrei compras na fatura.');return out;
}
export function parseCardCSV(text,options){
  text=String(text||'').replace(/^\uFEFF/,'').replace(/^sep=[;,\t]\r?\n/i,'');
  for(const delimiter of [';',',','\t']){
    const table=[];let row=[],cell='',quoted=false;
    for(let i=0;i<text.length;i++){
      const ch=text[i];if(ch==='"'&&quoted&&text[i+1]==='"'){cell+='"';i++;continue}
      if(ch==='"'){quoted=!quoted;continue}
      if(ch===delimiter&&!quoted){row.push(cell);cell='';continue}
      if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x.trim()))table.push(row);row=[];cell='';continue}
      cell+=ch;
    }
    if(quoted)throw Error('CSV incompleto: há uma célula com aspas abertas. Exporte o arquivo novamente.');
    if(cell||row.length){row.push(cell);table.push(row)}
    if(cardTableHasHeader(table))return parseCardTable(table,options);
  }
  throw Error('CSV não reconhecido: faltam as colunas Data, Descrição e Valor.');
}
export function parseCardPdfText(text,options){
  const billingMonth=requireCardMonth(options?.billingMonth),out=[];let currentCard=options?.cardLast4||'',pending=null,inTable=false;
  const flush=()=>{
    if(!pending)return;
    const m=pending.text.match(/\s+(-?\s*(?:R\$\s*)?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}-?)\s*$/);
    if(!m)throw Error('Não consegui ler o valor de uma compra no PDF. Use a planilha original para evitar leitura incompleta.');
    let description=pending.text.slice(0,m.index).trim(),installment='';
    const inst=description.match(/\s+(?:PARC(?:ELA)?\.?\s*)?(\d{1,2})\s*\/\s*(\d{1,2})$/i);
    if(inst){installment=inst[1]+'/'+inst[2];description=description.slice(0,inst.index).trim()}
    if(!description||/\b(?:USD|US\$|DOLAR|EUR|EURO)\b/.test(cardNormalize(description)))throw Error('Compra em moeda estrangeira sem coluna em reais reconhecida. Use a planilha da fatura.');
    out.push({description,purchase_date:cardDate(pending.date,billingMonth),amount:cardAmount(m[1]),category:'',last4:last4(pending.card,currentCard),installment});pending=null;
  };
  if(!/\b(?:FATURA|CARTAO|CREDIT)\b/.test(cardNormalize(text))||/EXTRATO DA CONTA/.test(cardNormalize(text)))throw Error('Selecione a fatura do cartão; o extrato da conta vai na área de extrato semanal.');
  for(const raw of String(text).split(/\r?\n/)){
    const line=raw.trim();if(!line)continue;
    const normalized=cardNormalize(line);
    if(/\bDATA\b.*\b(?:DESCRICAO|LANCAMENTO|ESTABELECIMENTO|HISTORICO)\b/.test(normalized)){flush();inTable=true;continue}
    const card=line.match(/(?:FINAL(?: DO CART[AÃ]O)?|CART[AÃ]O[^\n]{0,35}?(?:[•*Xx]{2,}\s*|FINAL\s*))\s*[:•-]?\s*(\d{4})\b/i);
    if(card){flush();currentCard=card[1];continue}
    if(/^(?:TOTAL|SUBTOTAL|RESUMO|ENCARGOS|LIMITES|PAGAMENTO MINIMO|OPCOES DE PAGAMENTO)\b/.test(normalized)){flush();inTable=false;continue}
    if(!inTable)continue;
    const date=line.match(/^(\d{2}[/.]\d{2}(?:[/.](?:\d{4}|\d{2}))?)\s+(.+)$/);
    if(date){flush();pending={date:date[1],text:date[2],card:currentCard};if(/\s+-?\s*(?:R\$\s*)?[\d.]+,\d{2}-?\s*$/.test(' '+pending.text))flush();continue}
    if(pending){
      if(/^(?:TOTAL|SUBTOTAL|DATA |PAGINA |VENCIMENTO|C6 BANK)/.test(cardNormalize(line)))flush();
      else{pending.text+=' '+line;if(/\s+-?\s*(?:R\$\s*)?[\d.]+,\d{2}-?\s*$/.test(pending.text))flush()}
    }
  }
  flush();if(!out.length)throw Error('O PDF não contém uma tabela de compras legível. Selecione o Excel exportado pelo cartão.');
  return out;
}
export function cardRowsToCSV(rows){
  const quote=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
  return [['Descrição','Data de Compra','Valor (em R$)','Categoria','Final do Cartão','Parcela'],...rows.map(r=>[r.description,r.purchase_date,Number(r.amount).toFixed(2).replace('.',','),r.category,r.last4,r.installment])].map(row=>row.map(quote).join(';')).join('\n');
}
export function cardRowIdentity(r){return JSON.stringify([String(r.billing_month||'').slice(0,7),r.card_last4||'',r.purchase_date,cardNormalize(r.description),r.installment_number??null,r.installment_total??null,Math.round(Number(r.amount)*100)])}
export function selectNewCardRows(rows,existing){const known=new Map(),seen=new Map();for(const r of existing){const k=cardRowIdentity(r);known.set(k,(known.get(k)||0)+1)}return rows.filter(r=>{const k=cardRowIdentity(r),n=(seen.get(k)||0)+1;seen.set(k,n);return n>(known.get(k)||0)})}
