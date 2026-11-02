const bank=require('./ecountPendingReceipts.cjs');
// Only already-sanitized bank snapshots are cached. A failed read or session/period change invalidates it.
function sharedPendingReader({read,now=Date.now,version=()=>null,maxAgeMs=90000}){
 let cached=null,key=null;
 const scope=p=>JSON.stringify([p.from,p.to,version()]);
 const fresh=async period=>{cached=null;key=null;const value=bank.validateBankSnapshot(await read(period));if(value.from!==period.from.slice(0,7)+'-01'||value.to!==period.to)throw Error('BANK_SCOPE_MISMATCH');if(value.rows.some(r=>r.status!=='PENDING'))throw Error('BANK_STATUS_MISMATCH');cached=value;key=scope(period);return value;};
 const before=async period=>{const t=Date.parse(cached?.at),age=now()-t;return cached&&key===scope(period)&&Number.isFinite(age)&&age>=-60000&&age<maxAgeMs?cached:fresh(period);};
 return {fresh,before,invalidate:()=>{cached=null;key=null;}};
}
function serialReads(){let tail=Promise.resolve();return fn=>{const job=tail.then(fn,fn);tail=job.catch(()=>{});return job;};}
module.exports={sharedPendingReader,serialReads};

function lookupFailureMemo(saved={}, {now=Date.now,maxAgeMs=24*3600000}={}){
 const crypto=require('node:crypto');const data={};
 const signature=c=>crypto.createHash('sha256').update(JSON.stringify(['E040723','voucher','relation-v1','lookup-v1',c.sourceCode,c.lookupName??null,c.lookupQuery??null])).digest('hex');
 for(const [key,v]of Object.entries(saved??{}))if(/^[1-9]\d*$/.test(key)&&/^[a-f0-9]{64}$/.test(v?.signature??'')&&Number.isFinite(v?.at))data[key]={signature:v.signature,at:v.at};
 return {skip:c=>{const v=data[c.custKey],age=now()-(v?.at??NaN);return !!v&&v.signature===signature(c)&&age>=0&&age<maxAgeMs&&new Date(now()+9*3600000).toISOString().slice(0,10)===new Date(v.at+9*3600000).toISOString().slice(0,10);},fail:c=>{data[c.custKey]={signature:signature(c),at:now()};},success:c=>{delete data[c.custKey];},snapshot:()=>structuredClone(data)};
}
module.exports.lookupFailureMemo=lookupFailureMemo;

function scheduledReadCycle({lastAttempt=null,save,now=Date.now}){
 const schedule=require('./ecountLedgerSchedule.cjs');let active=false;
 return async operation=>{if(active)return false;const slot=schedule.dueSlot(now(),lastAttempt);if(slot===null)return false;active=true;
  try{await save(slot);lastAttempt=slot;await operation();return true;}finally{active=false;}
 };
}
module.exports.scheduledReadCycle=scheduledReadCycle;
