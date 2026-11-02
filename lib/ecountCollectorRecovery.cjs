const schedule=require('./ecountLedgerSchedule.cjs');
function isSourceLoginUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&(u.hostname==='login.ecount.com'||(u.hostname==='logincc.ecount.com'&&/^\/ec\d+\/view\/login\/erp_login\/?$/i.test(u.pathname)));}catch{return false;}}
function isSourceErpUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='logincc.ecount.com'&&/^\/ec\d+\/view\/erp\/?$/i.test(u.pathname);}catch{return false;}}
function singleFlight(recover){let active=null,version=0;const run=()=>{if(!active)active=Promise.resolve().then(recover).then(result=>{version++;return result;}).finally(()=>{active=null;});return active;};run.version=()=>version;run.wait=()=>active||Promise.resolve();return run;}
async function withSessionRecovery(operation,recover){await recover?.wait?.();const version=recover?.version?.();try{return await operation();}catch(e){if(e?.message!=='LOGIN_EXPIRED'||typeof recover!=='function')throw e;if(version===recover.version?.())await recover();return operation();}}
function recoveryRequestId(request,lastId,now=Date.now()){
 if(!schedule.isRefreshRequestAllowed(now)||!request||typeof request.requestedAt!=='string'||typeof request.id!=='string'||!/^[-a-zA-Z0-9]{16,80}$/.test(request.id)||request.id===lastId)return null;
 const at=Date.parse(request.requestedAt);return Number.isFinite(at)&&at<=now&&now-at<10*60000?request.id:null;
}
function makeContinuation(work,keys,now=Date.now()){
 if(!work?.period||!/^\d{4}-\d{2}-\d{2}$/.test(work.period.from)||!/^\d{4}-\d{2}-\d{2}$/.test(work.period.to)||work.period.from>work.period.to||!Array.isArray(keys)||!keys.length||keys.length>1000||keys.some(k=>!Number.isSafeInteger(k)||k<=0)||new Set(keys).size!==keys.length)return null;
 return {day:new Date(now+9*3600000).toISOString().slice(0,10),period:{from:work.period.from,to:work.period.to},keys:[...keys]};
}
function continuationEligible(value,now=Date.now()){
 return schedule.isRefreshRequestAllowed(now)&&!!value&&value.day===new Date(now+9*3600000).toISOString().slice(0,10)&&!!makeContinuation(value,value.keys,now);
}
async function withReadPage(ctx,operation){
 for(let attempt=0;attempt<2;attempt++){
  let page;try{page=await ctx.newPage();}catch{throw new Error('SOURCE_CONTEXT_UNAVAILABLE');}
  try{return await operation(page);}
  catch(e){if(attempt===1||(!page.isClosed?.()&&!['SOURCE_NAVIGATION_FAILED','BANK_SCOPE_MISMATCH'].includes(e?.message)))throw e;}
  finally{try{await page.close({runBeforeUnload:false});}catch{}}
 }
}
module.exports={isSourceLoginUrl,isSourceErpUrl,singleFlight,withSessionRecovery,recoveryRequestId,makeContinuation,continuationEligible,withReadPage};
