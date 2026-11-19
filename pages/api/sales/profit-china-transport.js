import { withAuth } from '../../../lib/auth';
import { parseChinaTransportScope } from '../../../lib/profitChinaTransport.mjs';
import { loadChinaTransportEvidence } from '../../../lib/profitChinaTransportData';
import { randomUUID } from 'node:crypto';

// Bounded process-memory job avoids keeping a gateway request open during cold inventory reads.
export function createChinaTransportHandler({load=loadChinaTransportEvidence,now=Date.now,id=randomUUID}={}){
const jobs=new Map();
return async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({ok:false,message:'GET만 허용합니다.'});
  const scope=parseChinaTransportScope(req.query?.year,req.query?.week);
  if(!scope)return res.status(400).json({ok:false,message:'연도와 1~53차를 선택하세요.'});
  const owner=req.user?.userId;
  if(typeof owner!=='string'||!owner)return res.status(401).json({ok:false,message:'로그인이 필요합니다.'});
  for(const [key,job]of jobs)if(job.finished&&now()-job.finished>300000)jobs.delete(key);
  const reply=job=>job.error?res.status(500).json({ok:false,message:'중국 근거 조회 실패. 본표는 변경되지 않았습니다. 다시 시도하세요.'})
    :job.result?res.status(200).json({ok:true,...job.result}):res.status(202).json({ok:true,status:'running',jobId:job.id,...scope});
  if(req.query.jobId!==undefined){
    const job=typeof req.query.jobId==='string'?jobs.get(req.query.jobId):null;
    if(!job||job.owner!==owner||job.scope.orderYear!==scope.orderYear||job.scope.major!==scope.major)return res.status(404).json({ok:false,message:'조회 작업이 만료되었습니다. 다시 조회하세요.'});
    return reply(job);
  }
  const existing=[...jobs.values()].find(job=>job.owner===owner&&!job.finished&&job.scope.orderYear===scope.orderYear&&job.scope.major===scope.major);
  if(existing)return reply(existing);
  if([...jobs.values()].some(job=>!job.finished))return res.status(429).json({ok:false,message:'다른 중국 근거 조회가 진행 중입니다. 잠시 후 다시 조회하세요.'});
  if(jobs.size>=8){const oldest=[...jobs.values()].filter(job=>job.finished).sort((a,b)=>a.finished-b.finished)[0];if(oldest)jobs.delete(oldest.id);}
  const job={id:id(),owner,scope};jobs.set(job.id,job);
  // Keep the in-flight lock until all SQL settles, even after the UI deadline.
  const timer=setTimeout(()=>{job.error=true;},180000);timer.unref?.();
  Promise.resolve().then(()=>load(scope)).then(result=>{
    if(result?.orderYear!==scope.orderYear||result?.major!==scope.major)throw Error('SCOPE_MISMATCH');
    job.result=result;
  }).catch(()=>{job.error=true;}).finally(()=>{clearTimeout(timer);job.finished=now();});
  return reply(job);
};
}
export default withAuth(createChinaTransportHandler());
