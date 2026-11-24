import {prepareArrivalWeekCost} from './arrivalWeekCost.js';
import {readImportTeamRecord,writeImportTeamRecord} from './importTeamStore.js';
import {reviewKey,validateCostReviewDraft} from './cloudCostReview.js';
export function createCloudCostReviewHandler({authorize,queryFn,types,prepare=prepareArrivalWeekCost,readRecord=readImportTeamRecord,writeRecord=writeImportTeamRecord}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({success:false,error:'POST만 지원합니다.'});
  if(req.user?.accountActive===false||!authorize(req.user))return res.status(403).json({success:false,error:'수입부 원가 작성 권한이 필요합니다.'});
  try{
   const request=req.body;
   if(!request||!['load','save'].includes(request.action)||JSON.stringify(request).length>250000)throw Object.assign(Error('검토 초안 요청을 확인하세요.'),{statusCode:400});
   const prepared=await prepare({queryFn,types,request:{...request,review:undefined,lineInputs:undefined}});
   if(prepared.scope.country!=='CN'||!prepared.members.length||prepared.members.some(m=>!/^Cloud(?:\s*land)?$/i.test(m.farmName)))throw Object.assign(Error('선택한 중국 CLOUD 입고에만 초안을 저장합니다.'),{statusCode:400});
   const key=reviewKey({...prepared.scope,selectedKeys:prepared.selectedKeys});
   let record=await readRecord(key);
   if(request.action==='save'){
    const value=validateCostReviewDraft(request.value),ids=new Set(prepared.members.flatMap(m=>m.rows.map(l=>l.lineId)));
    if(value.baselineDigest!==prepared.baselineDigest)throw Object.assign(Error('현재 입고가 변경되었습니다. 입력을 보존하고 원장 비교를 다시 조회하세요.'),{statusCode:409});
    if([...Object.keys(value.rows),...Object.keys(value.confirmations),...value.lineInputs.map(l=>l.lineId)].some(id=>!ids.has(id)))throw Object.assign(Error('선택 입고 밖의 검토 행입니다.'),{statusCode:400});
    const awbs=new Set(prepared.awbs.map(a=>a.awb));
    if(value.awbInputs.some(a=>!awbs.has(a.awb))||value.expensePools.some(p=>!Array.isArray(p.awbs)||p.awbs.some(a=>!awbs.has(a))))throw Object.assign(Error('선택 입고 밖의 비용 범위입니다.'),{statusCode:400});
    record=await writeRecord(key,{value,expectedRevision:request.expectedRevision,actor:req.user});
   }
   return res.json({success:true,revision:record.revision,value:record.value,stale:record.value!=null&&record.value.baselineDigest!==prepared.baselineDigest,history:record.history.slice(-10).map(h=>({revision:h.revision,at:h.at,action:h.action,changedCount:h.changedCount,changes:h.changes??[]})),persisted:request.action==='save'});
  }catch(e){const status=[400,403,409,413,422].includes(e.statusCode)?e.statusCode:503;return res.status(status).json({success:false,error:status===503?'검토 초안을 저장·조회하지 못했습니다. 현재 입력은 유지됩니다.':e.message});}
 };
}
