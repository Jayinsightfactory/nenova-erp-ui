import {prepareColombiaWeekCost} from './colombiaWeekCostSource.js';
import {calculateColombiaWeekCost,normalizeColombiaCostAwb} from './colombiaWeekCost.js';
import {createColombiaWeekCostWorkbook} from './colombiaWeekCostWorkbook.js';
import {preserveColombiaWeekCostVersion,readColombiaWeekCostVersion,listColombiaWeekCostVersions} from './colombiaWeekCostVersions.js';
const fail=(message,statusCode=422)=>{throw Object.assign(Error(message),{statusCode});};
export function createColombiaWeekCostHandler({queryFn,types,authorize,prepare=prepareColombiaWeekCost,calculate=calculateColombiaWeekCost,generate=createColombiaWeekCostWorkbook,preserve=preserveColombiaWeekCostVersion,readVersion=readColombiaWeekCostVersion,listVersions=listColombiaWeekCostVersions}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({success:false,error:'POST 요청만 지원합니다.'});}
  if(!authorize(req.user))return res.status(403).json({success:false,error:'수입부 업무 권한이 필요합니다.'});
  try{
   const request=req.body,owner=String(req.user?.userId??req.user?.UserID??'');
   if(!owner||!request||typeof request!=='object'||Array.isArray(request)||!['prepare','preview','download','openVersion','versions'].includes(request.action))fail('통합 원가 요청 형식을 확인하세요.',400);
   for(const field of ['lineInputs','awbAssignments','awbInputs','customsPools','expenseDecisions'])if(request[field]!=null&&(!Array.isArray(request[field])||request[field].length>1000))fail('원가 입력 목록 형식을 확인하세요.',400);
   if(request.action==='versions')return res.json({success:true,versions:await listVersions({owner,scope:{country:request.country,orderYear:request.orderYear,orderWeek:request.orderWeek}})});
   if(request.action==='openVersion'){
    const saved=await readVersion({owner,scope:{country:request.country,orderYear:request.orderYear,orderWeek:request.orderWeek},versionHash:request.versionHash});
    if(!saved)fail('이 사용자·연도·차수의 보관 원가 버전이 없습니다.',404);
    return send(res,saved);
   }
   const prepared=await prepare({queryFn,types,request});
   if(request.action==='prepare')return res.json({success:true,persisted:false,...prepared});
   if(prepared.baselineDigest!==request.baselineDigest)fail('입고 전체가 변경되었습니다. 같은 연도·차수를 다시 조회하세요.',409);
   if(prepared.issues.length)fail('귀속이 모호한 입고·품종 행을 먼저 확인하세요.');
   // Legacy expense rows do not store a reliable currency/cost category. Never
   // silently drop a small fee, or assume its amount is already in AWB freight.
   const decisions=new Map();
   for(const decision of request.expenseDecisions??[]){
    if(!Number.isSafeInteger(decision?.wdetailKey)||decisions.has(decision.wdetailKey)||decision.confirmed!==true||!['INCLUDED_IN_AWB_INPUT','NOT_APPLICABLE'].includes(decision.treatment)||typeof decision.evidence!=='string'||!decision.evidence.trim()||decision.evidence.length>500)fail('원장 비용행의 중복 여부·통화·포함 근거를 확인하세요.');
    decisions.set(decision.wdetailKey,decision);
   }
   for(const expense of prepared.excluded.filter(row=>Number(row.amount)!==0)){
    const decision=decisions.get(expense.wdetailKey);
    if(!decision)fail('금액이 있는 원장 비용행의 AWB 입력 포함 또는 제외 근거가 필요합니다.');
    if(decision.treatment==='INCLUDED_IN_AWB_INPUT'&&normalizeColombiaCostAwb(decision.awb)!==expense.awb)fail('원장 비용행을 다른 AWB에 배분할 수 없습니다.');
    decisions.delete(expense.wdetailKey);
   }
   if(decisions.size)fail('현재 차수에 없는 비용행 확인이 포함되어 있습니다.');
   const inputs=new Map();
   for(const row of request.awbInputs??[]){const awb=normalizeColombiaCostAwb(row?.awb);if(inputs.has(awb))fail('같은 AWB 비용이 중복되었습니다.');inputs.set(awb,row.input);}
   const expenseDecisions=[...(request.expenseDecisions??[])].sort((a,b)=>a.wdetailKey-b.wdetailKey);
   const awbs=prepared.awbs.map(entry=>{if(!inputs.has(entry.awb))fail('현재 차수의 모든 AWB 비용을 확인하세요.');const input=inputs.get(entry.awb);if(!input||typeof input!=='object'||Array.isArray(input))fail('AWB 비용 입력 형식을 확인하세요.');inputs.delete(entry.awb);return {...entry,input:{...input,weekEvidence:{baselineDigest:prepared.baselineDigest,expenseDecisions}}};});
   if(inputs.size)fail('현재 차수에 없는 AWB 비용이 포함되어 있습니다.');
   const calculation=calculate({scope:prepared.scope,awbs,customsPools:request.customsPools});
   if(request.action==='preview')return res.json({success:true,persisted:false,calculation});
   if(calculation.status!=='CALCULATED'||request.versionHash!==calculation.versionHash)fail('최신 계산 검증을 통과한 버전만 다운로드할 수 있습니다.',409);
   // Only server-projected inputs and rows are archived; client result/quantity
   // projections are deliberately ignored. Late goods change this digest/hash.
   const snapshot={baselineDigest:prepared.baselineDigest,awbs,customsSources:calculation.customsSources,rows:prepared.documents.map(d=>({warehouseKey:d.warehouseKey,invoiceNo:d.invoiceNo,rows:d.receiptLines})),excluded:prepared.excluded,expenseDecisions};
   const saved=await preserve({owner,scope:prepared.scope,versionHash:calculation.versionHash,snapshot,createWorkbook:async()=>{
    const bytes=await generate({prepared,calculation});
    const after=await prepare({queryFn,types,request});
    if(after.baselineDigest!==prepared.baselineDigest)fail('파일 생성 중 입고가 변경되어 보관·다운로드하지 않았습니다.',409);
    return bytes;
   }});
   // Reused originals are immutable, but current download still checks freshness.
   const after=await prepare({queryFn,types,request});
   if(after.baselineDigest!==prepared.baselineDigest)fail('입고가 변경되었습니다. 새 버전을 계산하거나 이력 원본을 여세요.',409);
   return send(res,saved);
  }catch(error){const status=Number.isInteger(error.statusCode)?error.statusCode:500;return res.status(status).json({success:false,error:status<500?error.message:'통합 원가 처리에 실패했습니다. 자동 재시도 없이 담당자에게 확인하세요.',code:error.code??(status===500?'WEEK_COST_INTERNAL':'WEEK_COST_REVIEW')});}
 };
}
function send(res,saved){
 const {scope,versionHash,sha256}=saved.metadata;
 res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
 res.setHeader('Content-Disposition',`attachment; filename="colombia-${scope.orderYear}-${scope.orderWeek}-${versionHash.slice(0,12)}.xlsx"`);
 res.setHeader('X-Workbook-SHA256',sha256);res.setHeader('X-Cost-Version',versionHash);
 return res.status(200).send(saved.bytes);
}
