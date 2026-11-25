import {prepareArrivalWeekCost,calculateArrivalWeekCost} from './arrivalWeekCost.js';
import {createArrivalWeekCostWorkbook} from './arrivalWeekCostWorkbook.js';

export function createArrivalWeekCostHandler({queryFn,types,authorize,prepare=prepareArrivalWeekCost,calculate=calculateArrivalWeekCost,generate=createArrivalWeekCostWorkbook}){
 return async(req,res)=>{
  if(req.method!=='POST')return res.status(405).json({success:false,error:'POST만 지원합니다.'});
  if(req.user?.accountActive===false||!authorize(req.user))return res.status(403).json({success:false,error:'수입부 원가 작성 권한이 필요합니다.'});
  try{
   const request=req.body;if(!request||typeof request!=='object'||Array.isArray(request)||JSON.stringify(request).length>250000)throw Object.assign(Error('요청 형식을 확인하세요.'),{statusCode:400});
   for(const key of ['selectedKeys','lineInputs','awbInputs','expensePools','expenseDecisions','awbAssignments'])if(request[key]!=null&&(!Array.isArray(request[key])||request[key].length>1000))throw Object.assign(Error('입고·비용 입력 목록 형식을 확인하세요.'),{statusCode:400});
   if(!['prepare','preview','download'].includes(request.action))throw Object.assign(Error('원가 작업을 확인하세요.'),{statusCode:400});
   if(request.review){request.lineInputs=request.review.lineInputs;request.awbInputs=request.review.awbInputs;request.expensePools=request.review.expensePools;request.expenseDecisions=request.review.expenseDecisions??[];}
   const prepared=await prepare({queryFn,types,request});
   if(request.action==='prepare')return res.json({success:true,...prepared});
   if(request.baselineDigest!==prepared.baselineDigest)throw Object.assign(Error('같은 차수의 입고가 변경되었습니다. 추가 입고를 포함해 다시 조회하세요.'),{statusCode:409});
   const calculation=calculate(prepared,request);
   if(request.action==='preview')return res.json({success:true,calculation});
   if(request.versionHash!==calculation.versionHash)throw Object.assign(Error('입력이나 선택 입고가 변경되었습니다. 통합 계산을 다시 검증하세요.'),{statusCode:409});
   const bytes=await generate({prepared,calculation});
   const after=await prepare({queryFn,types,request});
   if(prepared.baselineDigest!==after.baselineDigest)throw Object.assign(Error('다운로드 생성 중 입고가 변경되었습니다. 다시 조회하세요.'),{statusCode:409});
   res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('Content-Disposition',`attachment; filename="arrival-${prepared.scope.country}-${prepared.scope.orderYear}-${prepared.scope.orderWeek}.xlsx"`);
   return res.status(200).send(bytes);
  }catch(e){const status=e.statusCode??500;return res.status(status).json({success:false,error:status<500?e.message:'통합 원가 처리에 실패했습니다. 입력 근거를 확인하세요.'});}
 };
}
