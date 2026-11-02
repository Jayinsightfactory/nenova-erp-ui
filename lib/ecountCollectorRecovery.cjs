const schedule=require('./ecountLedgerSchedule.cjs');
function isSourceLoginUrl(value){try{return new URL(value).hostname.toLowerCase()==='login.ecount.com';}catch{return false;}}
function singleFlight(recover){let active=null,version=0;const run=()=>{if(!active)active=Promise.resolve().then(recover).then(result=>{version++;return result;}).finally(()=>{active=null;});return active;};run.version=()=>version;run.wait=()=>active||Promise.resolve();return run;}
async function withSessionRecovery(operation,recover){await recover?.wait?.();const version=recover?.version?.();try{return await operation();}catch(e){if(e?.message!=='LOGIN_EXPIRED'||typeof recover!=='function')throw e;if(version===recover.version?.())await recover();return operation();}}
function recoveryRequestId(request,lastId,now=Date.now()){
 if(!schedule.isRefreshRequestAllowed(now)||!request||typeof request.requestedAt!=='string'||typeof request.id!=='string'||!/^[-a-zA-Z0-9]{16,80}$/.test(request.id)||request.id===lastId)return null;
 const at=Date.parse(request.requestedAt);return Number.isFinite(at)&&at<=now&&now-at<10*60000?request.id:null;
}
module.exports={isSourceLoginUrl,singleFlight,withSessionRecovery,recoveryRequestId};
