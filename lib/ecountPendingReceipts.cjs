// A calculation belongs to one ledger snapshot. Never subtract a second dataset at read time.
const crypto = require('node:crypto');
const codeHash = code => crypto.createHash('sha256').update(`E040723:${String(code).replace(/[-\s]/g,'')}`).digest('hex');
const hashPattern=/^[a-f0-9]{64}$/;
function validateBankSnapshot(input) {
  if(!input||input.complete!==true||!Number.isFinite(Date.parse(input.at))||!Array.isArray(input.rows)||input.rows.length>10000)throw new Error('INVALID_BANK_EVIDENCE');
  if(!/^\d{4}-\d{2}-01$/.test(input.from)||!/^\d{4}-\d{2}-\d{2}$/.test(input.to)||input.from>input.to)throw new Error('INVALID_BANK_EVIDENCE');
  const rows=input.rows.map(r=>{
    if(!hashPattern.test(r.id)||!hashPattern.test(r.pattern)||!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||r.date<input.from||r.date>input.to||!Number.isSafeInteger(r.amount)||r.amount<=0||!['PENDING','REFLECTED'].includes(r.status)||!(r.code===null||hashPattern.test(r.code))||typeof r.self!=='boolean')throw new Error('INVALID_BANK_EVIDENCE');
    if(r.status==='REFLECTED'&&!/^\d{4}-\d{2}-\d{2}$/.test(r.postingDate))throw new Error('INVALID_BANK_EVIDENCE');
    return {id:r.id,pattern:r.pattern,date:r.date,amount:r.amount,status:r.status,code:r.code,self:r.self,postingDate:r.status==='REFLECTED'?r.postingDate:null};
  });
  return {at:new Date(input.at).toISOString(),from:input.from,to:input.to,complete:true,rows};
}
function calculatePendingReceipts(evidence,ledger,targetHash) {
  const unavailable=reason=>({status:'UNAVAILABLE',reason,pendingAmount:null,calculatedBalance:null,rows:[]});
  if(!evidence)return unavailable('NOT_COLLECTED');
  let before,after,history;
  try{before=validateBankSnapshot(evidence.before);after=validateBankSnapshot(evidence.after);history=validateBankSnapshot(evidence.history);}catch{return unavailable('INVALID_EVIDENCE');}
  const t=Date.parse(ledger.collectedAt),start=Date.parse(before.at),end=Date.parse(after.at);
  if(!Number.isFinite(t)||start>t||t>end||end-start>5*60000||Date.parse(history.at)>start||start-Date.parse(history.at)>60*60000||before.from!==after.from||before.to!==after.to||history.from!==before.from||history.to!==before.to||before.from>ledger.periodFrom||before.to!==ledger.periodTo)return unavailable('COLLECTION_MISMATCH');
  if(before.rows.some(r=>r.status!=='PENDING')||after.rows.some(r=>r.status!=='PENDING')||history.rows.some(r=>r.status!=='REFLECTED'))return unavailable('INVALID_STATUS');
  const canonical=rows=>JSON.stringify([...rows].sort((a,b)=>a.id.localeCompare(b.id)||JSON.stringify(a).localeCompare(JSON.stringify(b))));
  if(canonical(before.rows)!==canonical(after.rows))return unavailable('BANK_CHANGED');
  const historical=new Map(),reflectedIds=new Set(history.rows.map(r=>r.id)),counts=new Map();
  for(const r of history.rows){const codes=historical.get(r.pattern)||new Set();codes.add(r.self?'SELF':r.code||'UNKNOWN');historical.set(r.pattern,codes);}
  for(const r of after.rows)counts.set(r.id,(counts.get(r.id)||0)+1);
  const posted=history.rows.filter(r=>r.code===targetHash&&!r.self&&r.postingDate>=ledger.periodFrom&&r.postingDate<=ledger.periodTo);
  const postedAmount=posted.reduce((sum,r)=>sum+r.amount,0);
  const accountingReconciled=Number.isSafeInteger(postedAmount)&&postedAmount===ledger.totals?.receipt&&new Set(posted.map(r=>r.id)).size===posted.length;
  const rows=[];
  for(const r of after.rows){
    const candidates=historical.get(r.pattern)||new Set();
    const inferred=candidates.size===1?[...candidates][0]:null;
    const belongs=r.code===targetHash||(!r.code&&candidates.has(targetHash));
    if(!belongs||r.date<ledger.periodFrom||r.date>ledger.periodTo)continue;
    let reason=null;
    if(r.self)reason='SELF_TRANSFER';
    else if(reflectedIds.has(r.id))reason='ALREADY_REFLECTED';
    else if(counts.get(r.id)!==1)reason='DUPLICATE_IDENTITY';
    else if(candidates.size>1||(r.code&&inferred&&inferred!==r.code))reason='MAPPING_CONFLICT';
    // A direct customer code is authoritative; history is used only when that code is absent.
    else if(!r.code&&inferred!==targetHash)reason='MAPPING_REQUIRED';
    // Posting can precede the bank status change. Require the official receipt total to
    // reconcile with the reflected bank rows, including many bank rows per voucher.
    else if(!accountingReconciled)reason='ACCOUNTING_RECONCILIATION';
    // A posted receipt of this exact amount on/after the bank date may be a delayed status update.
    else if(ledger.rows.some(x=>x.date>=r.date&&x.receipt===r.amount))reason='POSSIBLE_POSTED_RECEIPT';
    rows.push({id:r.id,date:r.date,amount:r.amount,matchedBy:r.code?'SOURCE_CODE':'REFLECTED_HISTORY',deduct:!reason,reason});
  }
  const pendingAmount=rows.filter(r=>r.deduct).reduce((a,r)=>a+r.amount,0);
  if(!Number.isSafeInteger(pendingAmount)||!Number.isFinite(ledger.totals?.balance))return unavailable('BALANCE_UNAVAILABLE');
  const heldCount=rows.filter(r=>!r.deduct).length;
  return {bankReconciled:accountingReconciled&&new Set(history.rows.filter(r=>r.code===targetHash&&!r.self).map(r=>r.id)).size===history.rows.filter(r=>r.code===targetHash&&!r.self).length,bankReceipts:accountingReconciled?history.rows.filter(r=>r.code===targetHash&&!r.self&&r.date>=ledger.periodFrom&&r.date<=ledger.periodTo).map(r=>({date:r.date,amount:r.amount})):[],status:'VERIFIED',checkedAt:after.at,periodFrom:ledger.periodFrom,periodTo:ledger.periodTo,pendingAmount,calculatedBalance:heldCount?null:ledger.totals.balance-pendingAmount,heldCount,rows};
}
module.exports={codeHash,validateBankSnapshot,calculatePendingReceipts};
