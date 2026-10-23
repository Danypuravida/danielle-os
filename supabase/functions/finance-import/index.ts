
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED=new Set(["https://danypuravida.github.io","http://localhost:3000","http://127.0.0.1:5500"]);
function cors(req){const o=req.headers.get("origin")||"";return {
  "Access-Control-Allow-Origin":ALLOWED.has(o)?o:"https://danypuravida.github.io",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS",
  "Content-Type":"application/json; charset=utf-8","Vary":"Origin"
}}
function send(req,b,s=200){return new Response(JSON.stringify(b),{status:s,headers:cors(req)})}
function normalize(s){return String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().replace(/\s+/g," ").trim()}
function moneyBR(s){return Number(String(s||"0").replace(/R\$/g,"").replace(/\s/g,"").replace(/\./g,"").replace(",",".").replace(/[^0-9.-]/g,""))||0}
function dmyToISO(s,yearOverride){const m=String(s||"").match(/^(\d{2})\/(\d{2})(?:\/(\d{4}))?$/);if(!m)return null;return `${m[3]||yearOverride}-${m[2]}-${m[1]}`}
function hashText(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return (h>>>0).toString(16).padStart(8,"0")}
function parseInstallment(s){const m=String(s||"").match(/^(\d+)\/(\d+)$/);return m?{n:Number(m[1]),total:Number(m[2])}:{n:null,total:null}}
function parseCSV(text){
  const rows=[];let row=[],cell="",q=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i],next=text[i+1];
    if(ch==='"' && q && next==='"'){cell+='"';i++;continue}
    if(ch==='"'){q=!q;continue}
    if(ch===';'&&!q){row.push(cell);cell="";continue}
    if((ch==='\n'||ch==='\r')&&!q){
      if(ch==='\r'&&next==='\n')i++;
      row.push(cell);cell="";
      if(row.some(x=>String(x).trim()!==""))rows.push(row);
      row=[];continue
    }
    cell+=ch;
  }
  if(cell||row.length){row.push(cell);rows.push(row)}
  if(!rows.length)return [];
  const headers=rows.shift().map(x=>x.trim());
  return rows.map(r=>Object.fromEntries(headers.map((h,i)=>[h,(r[i]??"").trim()])));
}
async function getUser(req){
  const auth=req.headers.get("Authorization")||"";
  if(!auth.startsWith("Bearer "))return {error:"Sessão ausente."};
  const pub=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")||"{}").default||Deno.env.get("SUPABASE_ANON_KEY")||"";
  const sb=createClient(Deno.env.get("SUPABASE_URL")||"",pub,{global:{headers:{Authorization:auth}},auth:{persistSession:false}});
  const {data:{user},error}=await sb.auth.getUser(auth.slice(7));
  if(error||!user)return {error:"Sessão inválida."};
  return {user};
}
function matchRule(text,direction,rules){
  const n=normalize(text);
  for(const r of rules){
    if(r.direction && r.direction!==direction)continue;
    const needle=normalize(r.match_text);
    let ok=false;
    if(r.match_type==="exact")ok=n===needle;
    else if(r.match_type==="starts_with")ok=n.startsWith(needle);
    else ok=n.includes(needle);
    if(ok)return r;
  }
  return null;
}
function cardFallback(raw){
  const n=normalize(raw);
  if(n.includes("RESTAURANTE"))return "Restaurantes e bares";
  if(n.includes("SUPERMERCADOS"))return "Mercado e alimentação";
  if(n.includes("ASSISTENCIA MEDICA"))return "Saúde e farmácia";
  if(n==="TRANSPORTE")return "Transporte";
  if(n==="EDUCACIONAL")return "Educação e desenvolvimento";
  if(n.includes("TELECOMUNICACOES"))return "Contas e serviços";
  if(n==="ENTRETENIMENTO")return "Lazer e entretenimento";
  if(n.includes("VESTUARIO")||n.includes("DEPARTAMENTO")||n.includes("ESPECIALIDADE VAREJO")||n.includes("VAREJOS DIVERSOS"))return "E-commerce / compras";
  if(n.includes("CASA / ESCRITORIO")||n==="CONSTRUCAO")return "Casa";
  return null;
}
function bankCounterparty(type,desc){
  if(type==="Saída PIX")return desc.replace(/^Pix enviado para\s+/i,"").trim();
  if(type==="Entrada PIX")return desc.replace(/^Pix recebido(?: c6)? de\s+/i,"").trim();
  if(type==="Devolução PIX")return desc.replace(/^Pix devolvido(?: para| por)?\s*/i,"").trim()||desc;
  return desc;
}
async function categoryMaps(admin,userId){
  const [cR,rR]=await Promise.all([
    admin.from("finance_categories").select("id,name,kind").eq("user_id",userId).eq("active",true),
    admin.from("finance_rules").select("match_text,match_type,category_id,direction").eq("user_id",userId).eq("active",true)
  ]);
  if(cR.error)throw cR.error;if(rR.error)throw rR.error;
  const byName=new Map((cR.data||[]).map(c=>[c.name,c.id]));
  return {byName,rules:rR.data||[]};
}
async function ensureStatement(admin,userId,body,accountId){
  const q=admin.from("finance_statements").select("*").eq("user_id",userId).eq("file_name",body.file_name||"import");
  if(body.document_kind)q.eq("document_kind",body.document_kind);
  if(body.billing_month)q.eq("source_period_label",body.billing_month);
  const {data:existing,error:lookupError}=await q.order("created_at",{ascending:false}).limit(1).maybeSingle();
  if(lookupError)throw lookupError;
  if(existing){
    const up=await admin.from("finance_statements").update({status:"processing",parse_notes:null,account_id:accountId||existing.account_id||null}).eq("id",existing.id).select("*").single();
    if(up.error)throw up.error;return up.data;
  }
  const ins=await admin.from("finance_statements").insert({
    user_id:userId,file_name:body.file_name||"import",file_type:body.file_type||null,
    document_kind:body.document_kind||"manual_import",source_period_label:body.billing_month||body.period_label||null,
    period_start:body.period_start||null,period_end:body.period_end||null,account_id:accountId||null,status:"processing"
  }).select("*").single();
  if(ins.error)throw ins.error;return ins.data;
}
async function ensureCard(admin,userId,last4){
  const name=`C6 • Cartão ${last4}`;
  const {data}=await admin.from("finance_accounts").select("id").eq("user_id",userId).eq("last4",last4).eq("account_type","credit_card").limit(1).maybeSingle();
  if(data?.id)return data.id;
  const ins=await admin.from("finance_accounts").insert({user_id:userId,name,institution:"C6 Bank",account_type:"credit_card",owner_scope:"personal",last4,active:true}).select("id").single();
  if(ins.error)throw ins.error;return ins.data.id;
}
async function importCard(admin,userId,statement,body,maps){
  const data=parseCSV(body.text||"");
  if(!data.length)throw new Error("CSV vazio ou não reconhecido.");
  const rows=[];
  for(const r of data){
    const desc=String(r["Descrição"]||"").trim();if(!desc)continue;
    const rawCat=String(r["Categoria"]||"").trim();
    const amountRaw=Number(String(r["Valor (em R$)"]||"0").replace(",", "."))||0;
    const abs=Math.abs(amountRaw);
    const last4=String(r["Final do Cartão"]||"").trim();
    const accountId=last4?await ensureCard(admin,userId,last4):null;
    const inst=parseInstallment(r["Parcela"]);
    const purchase=dmyToISO(r["Data de Compra"],String(body.billing_month||"2026").slice(0,4));
    const ndesc=normalize(desc);
    let direction=amountRaw<0?"refund":"expense";
    let exclude=false,isCardPayment=false;
    if(/INCLUSAO DE PAGAMENTO|PAGAMENTO CDB|PAG ENTRADA PARCEL FATURA/.test(ndesc)){direction="transfer";exclude=true;isCardPayment=true}
    else if(/CREDITO REFINANCIAMENTO|ESTORNO TARIFA/.test(ndesc)){direction="refund";exclude=true}
    const rule=matchRule(desc+" "+rawCat,direction,maps.rules);
    let categoryId=rule?.category_id||null,source=rule?"rule":"unclassified";
    if(!categoryId){
      const fb=cardFallback(rawCat);
      if(fb&&maps.byName.get(fb)){categoryId=maps.byName.get(fb);source="rule"}
    }
    if(direction==="refund"&&!categoryId&&maps.byName.get("Estorno / reembolso")){categoryId=maps.byName.get("Estorno / reembolso");source="rule"}
    if(direction==="transfer"&&!categoryId&&maps.byName.get("Transferência própria")){categoryId=maps.byName.get("Transferência própria");source="rule"}
    const fp=hashText(["card",body.billing_month,last4,purchase,desc,r["Parcela"],amountRaw].join("|"));
    rows.push({
      user_id:userId,statement_id:statement.id,account_id:accountId,
      transaction_date:String(body.billing_month||purchase||"2026-01-01"),purchase_date:purchase,billing_month:body.billing_month||null,
      description:desc,normalized_description:normalize(desc),merchant:desc,counterparty:desc,
      amount:abs,direction,category_id:categoryId,classification_source:source,classification_confidence:source==="rule"?0.98:null,
      exclude_from_spend:exclude,is_card_payment:isCardPayment,reconciliation_status:isCardPayment?"review":"not_applicable",
      fingerprint:fp,card_last4:last4||null,original_category:rawCat||null,raw_type:"credit_card",
      source_document_kind:"monthly_credit_card_bill",source_file:body.file_name||null,
      installment_number:inst.n,installment_total:inst.total,statement_line_key:fp
    });
  }
  if(rows.length){
    const q=await admin.from("finance_transactions").upsert(rows,{onConflict:"user_id,fingerprint"});
    if(q.error)throw q.error;
  }
  return rows.length;
}
function parseBankRows(userId,statement,body,maps,accountId){
  const text=String(body.text||"").replace(/\u00a0/g," ");
  const lines=text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const period=bankDocumentPeriod(text);
  const year=Number(String(period.period_start||body.period_start||body.period_year||new Date().getFullYear()).slice(0,4));
  const types=["Saída PIX","Débito de Cartão","Entrada PIX","Entradas","Devolução PIX","Pagamento","Outros gastos","Transferência"];
  const rows=[],occurrences=new Map();
  for(const line of lines){
    const head=line.match(/^(\d{2}\/\d{2})\s+(\d{2}\/\d{2})\s+/);if(!head)continue;
    const amountM=line.match(/(-?R\$\s*[\d\.]+,\d{2})\s*$/);if(!amountM)throw new Error("Não consegui ler o valor de um lançamento. Nenhuma linha deve ser ignorada.");
    const tail=line.slice(head[0].length,amountM.index).trim();
    let type=null,desc="";
    for(const t of types){if(tail.startsWith(t)){type=t;desc=tail.slice(t.length).trim();break}}
    if(!type||!desc)throw new Error("Tipo de lançamento não reconhecido. A importação foi interrompida para evitar leitura incompleta.");
    const signed=moneyBR(amountM[1]);
    const abs=Math.abs(signed);
    let rowYear=year;
    if(period.period_end && period.period_start.slice(0,4)!==period.period_end.slice(0,4) && Number(head[1].slice(3))<Number(period.period_start.slice(5,7)))rowYear=Number(period.period_end.slice(0,4));
    const date=dmyToISO(head[1],rowYear);
    if(!date || new Date(date+"T12:00:00Z").toISOString().slice(0,10)!==date || (period.period_start&&date<period.period_start)||(period.period_end&&date>period.period_end))throw new Error("Data fora do período do extrato.");
    let direction="expense",exclude=false,isCardPayment=false;
    if(type==="Entrada PIX")direction="income";
    else if(type==="Entradas"){
      if(/^(?:EST(?:ORNO)?\b|CREDITO DE COMPRA\b|DEVOLUCAO CARTAO)/.test(normalize(desc))){direction="refund";exclude=true}else direction="income";
    } else if(type==="Devolução PIX"){direction="refund";exclude=true}
    else if(type==="Pagamento"&&/PGTO FAT CARTAO/i.test(desc)){direction="transfer";exclude=true;isCardPayment=true}
    const cp=bankCounterparty(type,desc);
    const rule=matchRule(desc+" "+cp,direction,maps.rules);
    let categoryId=rule?.category_id||null,source=rule?"rule":"unclassified";
    if(!categoryId){
      if(direction==="refund"&&maps.byName.get("Estorno / reembolso")){categoryId=maps.byName.get("Estorno / reembolso");source="rule"}
      else if(direction==="transfer"&&maps.byName.get("Transferência própria")){categoryId=maps.byName.get("Transferência própria");source="rule"}
      else if(type==="Débito de Cartão"){
        const n=normalize(desc);
        const fall = /DROG|RAIA|PACHECO|VENANCIO/.test(n)?"Saúde e farmácia":
          /UBER|99APP|METRO/.test(n)?"Transporte":
          /SUPERMARKET|MERCADO|HORTIFRUT|PAO DE ACUCAR|ZONA SUL/.test(n)?"Mercado e alimentação":null;
        if(fall&&maps.byName.get(fall)){categoryId=maps.byName.get(fall);source="rule"}
      }
    }
    const base=hashText(["bank",date,type,desc,signed].join("|"));
    const occurrence=(occurrences.get(base)||0)+1;occurrences.set(base,occurrence);
    const fp=occurrence===1?base:base+":"+occurrence;
    rows.push({
      user_id:userId,statement_id:statement.id,account_id:accountId,
      transaction_date:date,description:desc,normalized_description:normalize(desc),counterparty:cp,
      amount:abs,direction,category_id:categoryId,classification_source:source,classification_confidence:source==="rule"?0.98:null,
      exclude_from_spend:exclude,is_card_payment:isCardPayment,reconciliation_status:isCardPayment?"review":"not_applicable",
      fingerprint:fp,raw_type:type,source_document_kind:body.document_kind||"weekly_bank_statement",source_file:body.file_name||null,statement_line_key:fp
    });
  }
  if(!rows.length)throw new Error("Não encontrei transações no extrato. Se for PDF, confirme a senha e o tipo de documento.");
  validateBankTotals(text,rows);
  return rows;
}
function bankDocumentPeriod(text){
  const ranges=[...String(text).matchAll(/(\d{2}\/\d{2}\/\d{4})\s*(?:-|a)\s*(\d{2}\/\d{2}\/\d{4})/g)];
  return {period_start:ranges.map(m=>dmyToISO(m[1])).sort()[0]||null,period_end:ranges.map(m=>dmyToISO(m[2])).sort().at(-1)||null};
}
function bankClosingBalance(text){
  const s=String(text||"").replace(/\u00a0/g," ");
  const header=s.match(/Saldo no dia da exportação\s*(?:\d{2}\/\d{2}\/\d{4}\s*a\s*\d{2}\/\d{2}\/\d{4}\s*)?(-?R\$\s*[\d.]+,\d{2})/i);
  if(header)return moneyBR(header[1]);
  const balances=[...s.matchAll(/Saldo contábil do dia\s+\d{2}\/\d{2}\/\d{2,4}\s+(-?R\$\s*[\d.]+,\d{2})/gi)];
  return balances.length?moneyBR(balances.at(-1)[1]):null;
}
function bankRowIdentity(r){return JSON.stringify([r.transaction_date,normalize(r.raw_type),normalize(r.description),Math.round(Number(r.amount)*100)])}
function selectNewBankRows(rows,existing){
  const known=new Map(),seen=new Map();
  for(const r of existing){const k=bankRowIdentity(r);known.set(k,(known.get(k)||0)+1)}
  return rows.filter(r=>{const k=bankRowIdentity(r),n=(seen.get(k)||0)+1;seen.set(k,n);return n>(known.get(k)||0)});
}
function validateBankTotals(text,rows){
  const re=/(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}\/\d{2}\/\d{4})\s*\)\s*Entradas:\s*(R\$\s*[\d.]+,\d{2})\s*[•·]?\s*Saídas:\s*(R\$\s*[\d.]+,\d{2})/g;
  for(const m of String(text).matchAll(re)){
    const start=dmyToISO(m[1]),end=dmyToISO(m[2]),inRange=rows.filter(r=>r.transaction_date>=start&&r.transaction_date<=end);
    const incoming=r=>["Entrada PIX","Entradas","Devolução PIX"].includes(r.raw_type);
    const sum=arr=>arr.reduce((v,r)=>v+Math.round(r.amount*100),0);
    if(sum(inRange.filter(incoming))!==Math.round(moneyBR(m[3])*100)||sum(inRange.filter(r=>!incoming(r)))!==Math.round(moneyBR(m[4])*100))throw new Error("A leitura não confere com os totais do extrato. Nenhum lançamento foi importado; tente selecionar o PDF original novamente.");
  }
}
async function importBank(admin,userId,statement,body,maps,accountId){
  const rows=parseBankRows(userId,statement,body,maps,accountId),dates=rows.map(r=>r.transaction_date).sort(),existing=[];
  for(let offset=0;;offset+=1000){
    const q=await admin.from("finance_transactions").select("transaction_date,raw_type,description,amount")
      .eq("user_id",userId).eq("account_id",accountId).neq("source_document_kind","monthly_credit_card_bill")
      .gte("transaction_date",dates[0]).lte("transaction_date",dates.at(-1)).order("id").range(offset,offset+999);
    if(q.error)throw q.error;existing.push(...(q.data||[]));if((q.data||[]).length<1000)break;
  }
  const fresh=selectNewBankRows(rows,existing);
  let inserted=0;
  if(fresh.length){
    const q=await admin.from("finance_transactions").upsert(fresh,{onConflict:"user_id,fingerprint",ignoreDuplicates:true}).select("id");
    if(q.error)throw q.error;inserted=(q.data||[]).length;
  }
  return {total:rows.length,inserted,skipped:rows.length-inserted,period_start:bankDocumentPeriod(body.text).period_start||dates[0],period_end:bankDocumentPeriod(body.text).period_end||dates.at(-1)};
}

function daysBetween(a,b){if(!a||!b)return 999;return Math.abs((new Date(a+"T12:00:00Z").getTime()-new Date(b+"T12:00:00Z").getTime())/86400000)}
async function reconcileBills(admin,userId,statementId){
  const {data:txs,error:te}=await admin.from("finance_transactions")
    .select("id,transaction_date,description,counterparty,amount,direction,account_id")
    .eq("user_id",userId).eq("statement_id",statementId)
    .in("direction",["expense","transfer"]).order("transaction_date",{ascending:true});
  if(te)throw te;if(!txs?.length)return {matched:0,items:[]};
  const months=[...new Set(txs.map(t=>String(t.transaction_date).slice(0,7)+"-01"))];
  const {data:bills,error:be}=await admin.from("finance_bill_monthly")
    .select("id,template_id,month,name,planned_amount,due_date,status,transaction_id")
    .eq("user_id",userId).in("month",months).eq("status","pending");
  if(be)throw be;if(!bills?.length)return {matched:0,items:[]};
  const templateIds=[...new Set(bills.map(b=>b.template_id).filter(Boolean))];
  let aliases=[];
  if(templateIds.length){
    const ar=await admin.from("finance_bill_aliases").select("template_id,match_text").eq("user_id",userId).eq("active",true).in("template_id",templateIds);
    if(ar.error)throw ar.error;aliases=ar.data||[];
  }
  const used=new Set();
  const existing=await admin.from("finance_bill_monthly").select("transaction_id").eq("user_id",userId).not("transaction_id","is",null);
  if(existing.error)throw existing.error;for(const x of existing.data||[])if(x.transaction_id)used.add(x.transaction_id);
  const aliasMap=new Map();
  for(const a of aliases){const arr=aliasMap.get(a.template_id)||[];arr.push(normalize(a.match_text));aliasMap.set(a.template_id,arr)}
  const matched=[];
  for(const bill of bills){
    const bm=String(bill.month).slice(0,7);
    const aa=aliasMap.get(bill.template_id)||[];
    if(!aa.length)continue;
    const scored=[];
    for(const t of txs){
      if(used.has(t.id)||String(t.transaction_date).slice(0,7)!==bm)continue;
      const hay=normalize((t.description||"")+" "+(t.counterparty||""));
      const aliasHit=aa.some(a=>a&&hay.includes(a));
      if(!aliasHit)continue;
      let score=5;
      const planned=bill.planned_amount==null?null:Number(bill.planned_amount),amount=Number(t.amount||0);
      if(planned!=null&&planned>0){
        const diff=Math.abs(amount-planned),pct=diff/planned;
        if(diff<=0.01)score+=4;else if(pct<=0.03)score+=3;else if(pct<=0.10)score+=1;
      }
      if(bill.due_date&&daysBetween(t.transaction_date,bill.due_date)<=7)score+=1;
      scored.push({t,score});
    }
    scored.sort((a,b)=>b.score-a.score||String(a.t.transaction_date).localeCompare(String(b.t.transaction_date)));
    if(!scored.length)continue;
    const best=scored[0],second=scored[1];
    if(best.score<5)continue;
    if(second&&second.score===best.score)continue;
    const paidAt=best.t.transaction_date+"T12:00:00Z";
    const ur=await admin.from("finance_bill_monthly").update({
      status:"paid",paid_amount:Number(best.t.amount||0),paid_at:paidAt,transaction_id:best.t.id,
      note:"Conciliado automaticamente com o extrato"
    }).eq("id",bill.id).eq("status","pending");
    if(ur.error)throw ur.error;
    used.add(best.t.id);matched.push({bill_id:bill.id,name:bill.name,transaction_id:best.t.id,amount:Number(best.t.amount||0),date:best.t.transaction_date});
  }
  return {matched:matched.length,items:matched};
}
Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors(req)});
  if(req.method!=="POST")return send(req,{error:"Método não permitido."},405);
  let importContext=null;
  try{
    const auth=await getUser(req);if(auth.error)return send(req,{error:auth.error},401);
    const userId=auth.user.id;
    const admin=createClient(Deno.env.get("SUPABASE_URL")||"",Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"",{auth:{persistSession:false}});
    const body=await req.json();
    if(!body?.text)return send(req,{error:"Arquivo sem conteúdo extraído."},400);
    const maps=await categoryMaps(admin,userId);
    let accountId=body.account_id||null;
    if(!accountId && body.document_kind!=="monthly_credit_card_bill"){
      const {data:a}=await admin.from("finance_accounts").select("id").eq("user_id",userId).eq("account_type","personal_checking").eq("active",true).limit(1).maybeSingle();
      accountId=a?.id||null;
    }
    if(body.document_kind!=="monthly_credit_card_bill"){
      const ar=await admin.from("finance_accounts").select("id").eq("id",accountId).eq("user_id",userId).eq("active",true).maybeSingle();
      if(ar.error)throw ar.error;if(!ar.data)throw new Error("Selecione uma conta válida para importar o extrato.");
    }
    const st=await ensureStatement(admin,userId,body,accountId);
    importContext={admin,userId,statementId:st.id};
    let count=0,bankStats=null;
    if(body.document_kind==="monthly_credit_card_bill")count=await importCard(admin,userId,st,body,maps);
    else {bankStats=await importBank(admin,userId,st,body,maps,accountId);count=bankStats.total}
    const {count:unc}=await admin.from("finance_transactions").select("id",{count:"exact",head:true}).eq("user_id",userId).eq("classification_source","unclassified");
    const statementPatch={status:"ready",transaction_count:count,reviewed_at:new Date().toISOString()};
    let balanceCaptured=null;
    if(body.document_kind!=="monthly_credit_card_bill"){
      statementPatch.period_start=bankStats.period_start;
      statementPatch.period_end=bankStats.period_end;
      statementPatch.parse_notes=`${count} movimentos lidos; ${bankStats.inserted} novos; ${bankStats.skipped} já existentes preservados.`;
      const documentBalance=bankClosingBalance(body.text);
      const parsedBalance=documentBalance??((body.closing_balance===null||body.closing_balance===undefined||body.closing_balance==="")?null:Number(body.closing_balance));
      if(Number.isFinite(parsedBalance)){
        statementPatch.closing_balance=parsedBalance;balanceCaptured=parsedBalance;
        if(accountId){
          const asOf=statementPatch.period_end;
          const {data:existingBal}=await admin.from("finance_account_balance_snapshots").select("id").eq("user_id",userId).eq("statement_id",st.id).limit(1).maybeSingle();
          if(existingBal?.id){
            const ub=await admin.from("finance_account_balance_snapshots").update({balance:parsedBalance,as_of_date:asOf,source:"import",note:"Saldo capturado automaticamente do extrato"}).eq("id",existingBal.id);
            if(ub.error)throw ub.error;
          }else{
            const ib=await admin.from("finance_account_balance_snapshots").insert({user_id:userId,account_id:accountId,balance:parsedBalance,as_of_date:asOf,source:"import",statement_id:st.id,note:"Saldo capturado automaticamente do extrato"});
            if(ib.error)throw ib.error;
          }
        }
      }
    }
    const saved=await admin.from("finance_statements").update(statementPatch).eq("id",st.id).eq("user_id",userId);if(saved.error)throw saved.error;
    const reconciliation=body.document_kind==="monthly_credit_card_bill"?{matched:0,items:[]}:await reconcileBills(admin,userId,st.id);
    return send(req,{ok:true,statement_id:st.id,transaction_count:count,inserted_count:bankStats?.inserted??count,skipped_count:bankStats?.skipped??0,unclassified_count:unc||0,closing_balance:balanceCaptured,reconciled_bills:reconciliation});
  }catch(e){
    if(importContext){const {admin,userId,statementId}=importContext;await admin.from("finance_statements").update({status:"error",parse_notes:e instanceof Error?e.message:String(e)}).eq("id",statementId).eq("user_id",userId)}
    return send(req,{error:e instanceof Error?e.message:String(e)},500);
  }
});
