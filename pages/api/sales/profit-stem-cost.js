import {randomUUID} from 'node:crypto';
import {withAuth} from '../../../lib/auth';
import {parseMarginScope} from '../../../lib/profitCustomerMargin.mjs';
import {loadStemCostReport} from '../../../lib/profitStemCostData';

// Read-only calculations live in process memory. No SQL/filesystem job writes.
// This prevents a long cold calculation from becoming a gateway 502/504.
export function createStemCostHandler({load=loadStemCostReport,timeoutMs=180000,now=Date.now,id=randomUUID,maxRunning=2}={}) {
  const jobs=new Map();
  const reply=(res,job)=>job.state==='done'?res.status(200).json(job.result)
    :job.state==='failed'?res.status(job.code).json({ok:false,status:'held',error:job.error})
      :res.status(202).json({ok:true,status:'running',jobId:job.id,year:job.scope.year,major:job.scope.major,progress:job.progress});
  return async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    if(req.method!=='GET')return res.status(405).json({ok:false,error:'GET만 허용합니다.'});
    const owner=req.user?.userId;
    if(typeof owner!=='string'||!owner)return res.status(401).json({ok:false,error:'로그인이 필요합니다.'});
    let scope;try{scope=parseMarginScope(req.query.year,req.query.week);}catch(error){return res.status(400).json({ok:false,error:error.message});}
    for(const [key,job]of jobs)if(job.state!=='running'&&now()-job.finishedAt>300000)jobs.delete(key);
    if(req.query.jobId!==undefined){
      if(typeof req.query.jobId!=='string')return res.status(400).json({ok:false,error:'작업 식별자가 올바르지 않습니다.'});
      const job=jobs.get(req.query.jobId);
      if(!job||job.owner!==owner||job.scope.year!==scope.year||job.scope.major!==scope.major)return res.status(404).json({ok:false,status:'held',error:'계산 작업이 만료되었거나 서버가 재시작되었습니다. 다시 계산하세요.'});
      return reply(res,job);
    }
    const existing=[...jobs.values()].find(j=>j.owner===owner&&j.scope.year===scope.year&&j.scope.major===scope.major&&(j.state==='running'||j.state==='done'&&now()-j.finishedAt<30000));
    if(existing)return reply(res,existing);
    if([...jobs.values()].filter(j=>j.state==='running').length>=maxRunning)return res.status(429).json({ok:false,status:'held',error:'다른 원가 계산이 진행 중입니다. 잠시 후 다시 계산하세요.'});
    if(jobs.size>=12){const removable=[...jobs.values()].filter(j=>j.state!=='running').sort((a,b)=>a.finishedAt-b.finishedAt)[0];if(removable)jobs.delete(removable.id);}
    const controller=new AbortController(),job={id:id(),owner,scope,state:'running',progress:'입고·출고·재고 원천 조회 중',startedAt:now()};
    jobs.set(job.id,job);
    const timer=setTimeout(()=>{controller.abort();job.state='failed';job.code=503;job.error='송이 원가 계산 시간 초과로 보류했습니다. 기존 저장본은 변경하지 않았습니다.';job.finishedAt=now();},timeoutMs);
    Promise.resolve().then(()=>load(scope,controller.signal,progress=>{if(job.state==='running')job.progress=String(progress);})).then(result=>{
      if(controller.signal.aborted)return;
      if(String(result?.year)!==scope.year||Number(result?.major)!==Number(scope.major)||result?.ok!==true)throw Error('STEM_SCOPE_MISMATCH');
      job.result=result;job.state='done';job.finishedAt=now();
    }).catch(()=>{if(controller.signal.aborted)return;job.state='failed';job.code=500;job.error='송이 원가 원천 조회 실패입니다. 누락값으로 수익률을 계산하지 않았습니다.';job.finishedAt=now();}).finally(()=>clearTimeout(timer));
    return reply(res,job);
  };
}
export default withAuth(createStemCostHandler());
