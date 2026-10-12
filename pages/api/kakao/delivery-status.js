import { withAuth } from '../../../lib/auth';
import { periodBounds } from '../../../lib/distributionSalesInbox';
import { recentSalesPeriod } from '../../../lib/distributionSalesInboxRefresh';
import { DELIVERY_ROOM, deliveryIdentity, matchDeliveryStatus } from '../../../lib/distributionDeliveryStatus';
import { createDistributionDeliveryEvidenceStore } from '../../../lib/distributionDeliveryEvidenceStore';

const ENDPOINT='https://mindmap-viewer-production-adb2.up.railway.app/api/kakao/nenova-delivery-feed';
let cached=null,pending=null;
const evidenceStore=createDistributionDeliveryEvidenceStore();
function validCursor(value){return typeof value==='string'&&value.length<=512&&!/[\u0000-\u001f\u007f-\u009f]/.test(value);}
async function readDeliveryFeed(token,period) {
  const key=`${period.from}/${period.to}`;
  if(cached?.key===key&&cached.token===token&&Date.now()-cached.at<30000)return cached.messages;
  if(pending?.key===key&&pending.token===token)return pending.promise;
  const promise=(async()=>{
    const bounds=periodBounds(period.from,period.to),messages=[],seen=new Set();let afterKey='';
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    try {
      for(let page=0;page<20;page++){
        const url=new URL(ENDPOINT);Object.entries({...bounds,afterKey,limit:'200'}).forEach(([k,v])=>url.searchParams.set(k,v));
        const response=await fetch(url,{headers:{Authorization:`Bearer ${token}`},signal:controller.signal,redirect:'error'});
        if(!response.ok)throw new Error('upstream');
        const data=await response.json();
        if(data.ok!==true||!Array.isArray(data.messages)||data.messages.length>200||typeof data.hasMore!=='boolean'||(data.nextAfterKey!==null&&!validCursor(data.nextAfterKey))||(data.hasMore&&!data.nextAfterKey))throw new Error('contract');
        if(data.messages.some(row=>row.chatroom!==DELIVERY_ROOM||!deliveryIdentity(row)||typeof row.message!=='string'))throw new Error('scope');
        messages.push(...data.messages);
        if(!data.hasMore){cached={key,token,at:Date.now(),messages};return messages;}
        if(data.nextAfterKey===afterKey||seen.has(data.nextAfterKey))throw new Error('cursor');
        seen.add(data.nextAfterKey);afterKey=data.nextAfterKey;
      }
      throw new Error('incomplete');
    }finally{clearTimeout(timer);}
  })();
  pending={key,token,promise};
  try{return await promise;}finally{if(pending?.promise===promise)pending=null;}
}
export default withAuth(async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'조회 요청은 POST만 지원합니다.'});}
  if(req.user?.accountActive===false)return res.status(403).json({error:'비활성 계정은 전달 상태를 조회할 수 없습니다.'});
  const {year,week,sources}=req.body||{};
  if(typeof year!=='string'||!/^\d{4}$/.test(year)||typeof week!=='string'||!new RegExp(`^${year}-(?:0[1-9]|[1-4]\\d|5[0-3])-(?:0[1-9]|[1-9]\\d)$`).test(week)||!Array.isArray(sources)||sources.length>200||sources.some(row=>!row||typeof row.identity!=='string'||!row.identity||row.identity.length>1200||typeof row.message!=='string'||row.message.length>20000)||sources.reduce((sum,row)=>sum+row.message.length,0)>200000)return res.status(400).json({error:'연도·전체 차수·원문 조회 범위를 확인하세요.'});
  const period=recentSalesPeriod();
  let saved;
  try{
    saved=await Promise.all(sources.map(source=>evidenceStore.read({source,year})));
  }catch{return res.status(503).json({error:'저장된 전달 근거를 읽지 못했습니다. 잠시 후 다시 확인하세요.'});}
  const response=items=>({ok:true,year,week,asOf:new Date().toISOString(),...period,items});
  const fallback=(status,error)=>saved.some(Boolean)?res.json({...response(sources.map((source,index)=>saved[index]||{identity:source.identity,status:'UNCONFIRMED'})),warning:error}):res.status(status).json({error});
  if(saved.every(Boolean))return res.json(response(saved));
  const token=process.env.NENOVA_SALES_READ_TOKEN;
  if(!token)return fallback(503,'추가취소방 최신 조회 설정이 없습니다. 저장된 전달 완료 근거는 유지합니다.');
  try{
    const targets=sources.length?await readDeliveryFeed(token,period):[];
    // The client batches raw messages; carry ambiguity observed across all batches.
    const matched=matchDeliveryStatus({sources,targets,year}).map((item,index)=>sources[index].duplicateOriginal===true?{identity:item.identity,status:'AMBIGUOUS',reason:'ambiguous'}:item);
    const items=await Promise.all(matched.map(async(item,index)=>saved[index]||(item.status==='DELIVERED'?evidenceStore.confirm({source:sources[index],target:targets.find(target=>deliveryIdentity(target)===item.deliveryIdentity),year}):item)));
    const qualifiedSourceCount=matched.filter(item=>!['source_metadata','incomplete','source_time_approximate','source_time_invalid'].includes(item.reason)).length;
    return res.json({...response(items),diagnostics:{targetCount:targets.length,qualifiedSourceCount}});
  }catch{return fallback(502,'추가취소방 최신 전달 여부를 확인하지 못했습니다. 저장된 전달 완료 근거는 유지합니다.');}
});
export const config={api:{bodyParser:{sizeLimit:'512kb'}}};
