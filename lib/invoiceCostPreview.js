import { createHash } from 'node:crypto';
import { normalizeInvoiceDraft } from './invoiceReceiptDocuments.js';
import { validateInvoiceReceiptLines } from './invoiceReceiptValidation.js';
import { INVOICE_COST_FORMULAS, previewInvoiceCost } from './invoiceReceiptCost.js';
import { createInvoicePreviewCostWorkbook } from './invoiceReceiptCostExport.js';
import { auInvoiceTariffDefault } from './auInvoiceTariffDefaults.js';

const countries={AU:'호주',CN:'중국',CO:'콜롬비아',EC:'에콰도르',NL:'네덜란드',TH:'태국',US:'미국',VN:'베트남',NZ:'뉴질랜드'};
// These checks protect native header persistence, which this calculation never performs.
const nativeHeaderOnly=new Set(['FARM_REQUIRED','INVOICE_YEAR_REQUIRED','AWB_INVALID','METADATA_PRECISION_INVALID','FREIGHT_CURRENCY_REQUIRED']);
const qtyFields=['boxQuantity','bunchQuantity','stemQuantity','unitPrice','lineAmount'];
function fail(message,statusCode=422){throw Object.assign(new Error(message),{statusCode});}
export async function prepareInvoiceCostPreview({queryFn,types,request}) {
  const draft=normalizeInvoiceDraft(request.document);
  const lines=draft.lines.map(line=>({...line,...Object.fromEntries(qtyFields.map(k=>[k,line[k]==null?null:Number(line[k])]))}));
  const document={...draft,lines,revision:request.document.revision??draft.expectedRevision??0,
    receiptStatus:'INVOICE_PREVIEW',costStatus:'PREVIEW_ONLY',operations:[],warehouseKey:null};
  const keys=[...new Set(lines.map(l=>l.prodKey).filter(Number.isInteger))].sort((a,b)=>a-b);
  const params=Object.fromEntries(keys.map((key,i)=>[`p${i}`,{type:types.Int,value:key}]));
  const products=(await queryFn(`/* invoice-cost:upload-preview-products */ SELECT ProdKey,ProdName,CounName,CountryFlower,
    OutUnit,EstUnit,SteamOf1Box,SteamOf1Bunch,BunchOf1Box,isDeleted FROM dbo.Product
    WHERE ProdKey IN (${keys.length?keys.map((_,i)=>`@p${i}`).join(','):'NULL'}) ORDER BY ProdKey`,params)).recordset;
  if(!Array.isArray(products))fail('전산 품목을 조회하지 못했습니다. 다시 시도하세요.',503);
  const validation=validateInvoiceReceiptLines(document,products);
  const issues=validation.issues.filter(i=>!nativeHeaderOnly.has(i.code));
  const country=countries[document.reviewedMetadata.country];
  if(!country)issues.push({code:'COUNTRY_REQUIRED',message:'인보이스 국가를 선택하세요.'});
  if(!['AIR','SEA'].includes(document.reviewedMetadata.transportMode))issues.push({code:'TRANSPORT_REQUIRED',message:'원가 계산에 적용할 항공·해상 운송 방식을 선택하세요.'});
  for(const line of lines){
    const p=products.find(p=>p.ProdKey===line.prodKey);
    if(p&&country&&p.CounName?.trim()!==country)issues.push({code:'PRODUCT_COUNTRY_CONFLICT',lineId:line.lineId,message:'매칭 품목의 국가가 인보이스와 다릅니다.'});
    if(line.reviewed?.confirmed!==true)issues.push({code:'SOURCE_REVIEW_REQUIRED',lineId:line.lineId,message:'품목 매칭과 원문 수량·금액 확인을 완료하세요.'});
    if(line.sourceEvidence?.conversionValidation?.status==='MISMATCH'&&line.reviewed?.conversionConfirmed!==true)
      issues.push({code:'CONVERSION_REVIEW_REQUIRED',lineId:line.lineId,message:'원문과 변환 수량 차이를 확인하세요.'});
  }
  if(request.document.sourceWarnings?.length)issues.push({code:'SOURCE_WARNING',message:'파일·품목 매칭 화면의 원문 확인 이슈를 먼저 해결하세요.'});
  document.receiptLines=validation.lines;
  const meta=document.reviewedMetadata, saved=meta.invoiceCostInput||{}, byId=new Map((saved.lineInputs||[]).map(l=>[l.lineId,l]));
  const tariffDefaults=Object.fromEntries(validation.lines.map(l=>[l.lineId,auInvoiceTariffDefault(document,products.find(p=>p.ProdKey===l.prodKey))]).filter(([,v])=>v));
  document.reviewedMetadata={...meta,tariffDefaults,invoiceCostInput:{formulaEffectiveDate:meta.inputDate,exchangeRateDate:meta.inputDate,
    exchangeRateType:'MANUAL',allocationScope:'SINGLE_INVOICE',allocationShareNumerator:1,allocationShareDenominator:1,
    costSourceId:`인보이스 ${document.invoiceNo}`, ...saved,
    lineInputs:validation.lines.map(l=>({lineId:l.lineId,...(tariffDefaults[l.lineId]?{tariffRate:tariffDefaults[l.lineId].tariffRate}:{}),
      stemsPerBunch:l.bunchQuantity>0&&l.stemQuantity!=null?l.stemQuantity/l.bunchQuantity:null,
      bunchesPerBox:l.boxQuantity>0&&l.bunchQuantity!=null?l.bunchQuantity/l.boxQuantity:null,...byId.get(l.lineId)}))}};
  const baselineDigest=createHash('sha256').update(JSON.stringify({document,products})).digest('hex');
  return {document,issues,baselineDigest};
}
export function calculateInvoiceCostPreview(prepared,request){
  if(request.baselineDigest!==prepared.baselineDigest)fail('인보이스 입력이나 전산 품목 기준이 변경되었습니다. 인보이스 원가 준비를 다시 실행하세요.',409);
  if(prepared.issues.length)fail(prepared.issues.map(i=>i.message).join('\n'));
  const input=request.input||{}, formula=INVOICE_COST_FORMULAS[input.formulaId],document=prepared.document;
  if(!formula||formula.country!==document.reviewedMetadata.country||formula.transportMode!==document.reviewedMetadata.transportMode)
    fail('인보이스 국가·운송 방식과 원가 공식이 일치하지 않습니다.');
  const preview=previewInvoiceCost({...document,costInput:input},document.receiptLines);
  return {document,input,preview:{...preview,note:'인보이스 수량 기준 미승인 계산본입니다. 입고·재고·승인 원가는 변경하지 않습니다.'}};
}
export function createInvoiceCostPreviewHandler({queryFn,types,authorize,generate=createInvoicePreviewCostWorkbook}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({success:false,error:'지원하지 않는 요청입니다.'});}
  if(!authorize?.(req.user))return res.status(403).json({success:false,error:'수입부 업무 권한이 필요합니다.'});
  try{
    if(!['prepare','preview','download'].includes(req.body?.action))fail('원가 준비·미리보기·다운로드만 가능합니다.',400);
    const prepared=await prepareInvoiceCostPreview({queryFn,types,request:req.body});
    if(req.body.action==='prepare')return res.json({success:true,...prepared,persisted:false});
    const result=calculateInvoiceCostPreview(prepared,req.body);
    if(req.body.action==='preview')return res.json({success:true,preview:result.preview,persisted:false});
    const bytes=await generate(result);
    const latest=await prepareInvoiceCostPreview({queryFn,types,request:req.body});
    if(latest.baselineDigest!==prepared.baselineDigest)fail('엑셀 생성 중 품목 기준이 변경되었습니다. 다시 준비하세요.',409);
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition',`attachment; filename="invoice-cost-${result.document.orderYear}-${result.document.orderWeek}.xlsx"`);
    return res.send(bytes);
  }catch(error){const status=[400,404,409,422].includes(error.statusCode)?error.statusCode:503;
    return res.status(status).json({success:false,error:status===503?'인보이스 원가 계산을 완료하지 못했습니다. 입력은 유지되며 입고는 등록하지 않았습니다.':error.message,persisted:false});}
 };
}
