import { createHash } from 'node:crypto';
import { getInvoiceDocument } from './invoiceReceiptDocuments.js';
import { readVerifiedInvoiceReceiptLines } from './invoiceReceiptCost.js';
import { calculateSharedAwbCost } from './invoiceSharedAwbCost.js';
import { createSharedAwbCostWorkbook } from './invoiceReceiptCostExport.js';
import {coReceiptCostPrice} from './coOriginalCostInputs.js';

const key = value => typeof value === 'string' ? value.replace(/[\s-]/g,'') : '';
const fail = (message,statusCode=422) => { throw Object.assign(new Error(message),{statusCode}); };
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const unit = value => ({'송이':'STEM','단':'BUNCH','박스':'BOX',STEM:'STEM',STEMS:'STEM',BUNCH:'BUNCH',BUNCHES:'BUNCH',BOX:'BOX',BOXES:'BOX'})[String(value??'').trim().toUpperCase()] || '';

export async function prepareSharedAwb({queryFn,types,request,readDocument=getInvoiceDocument,readReceipt=readVerifiedInvoiceReceiptLines}) {
  const {orderYear,orderWeek}=request || {}, awb=key(request?.awb);
  if(typeof orderYear!=='string'||!/^\d{4}$/.test(orderYear)||typeof orderWeek!=='string'||!/^\d{2}-\d{2}$/.test(orderWeek)||!/^\d{11}$/.test(awb))
    fail('연도·세부차수·공동 AWB 번호를 확인하세요.',400);
  const type=(name,...args)=>typeof types[name]==='function'?types[name](...args):types[name];
  const found=await queryFn(`/* invoice-cost:shared-awb-members */ SELECT DocumentId FROM dbo.WebInvoiceDocument
    WHERE OrderYear=@orderYear AND OrderWeek=@orderWeek
    AND REPLACE(REPLACE(JSON_VALUE(ReviewedMetadataJson,'$.awb'),'-',''),' ','')=@awb
    ORDER BY DocumentId`,{orderYear:{type:type('Char',4),value:orderYear},orderWeek:{type:type('Char',5),value:orderWeek},awb:{type:type('VarChar',11),value:awb}});
  if(!Array.isArray(found.recordset)||!found.recordset.length||found.recordset.length>100)fail('같은 AWB의 저장 송장 1~100개가 필요합니다.');
  const members=[],documents=[],receiptLines=[],warehouseKeys=new Set();
  if(request.lineInputs!=null&&!Array.isArray(request.lineInputs))fail('행별 품종 입력 형식을 확인하세요.');
  const requestedLines=request.lineInputs||[];
  if(new Set(requestedLines.map(row=>row?.lineId)).size!==requestedLines.length)fail('행별 품종 입력이 중복되었습니다.');
  for(const record of found.recordset) {
    const doc=await readDocument({queryFn,types,documentId:String(record.DocumentId).toLowerCase()});
    if(!doc||doc.orderYear!==orderYear||doc.orderWeek!==orderWeek||key(doc.reviewedMetadata?.awb)!==awb)fail('공동 AWB 문서가 변경되었습니다. 다시 조회하세요.',409);
    const verified=await readReceipt({queryFn,types,document:doc});
    if(warehouseKeys.has(verified.operation.warehouseKey))fail('한 입고가 여러 송장에 중복 연결되어 있습니다.');
    warehouseKeys.add(verified.operation.warehouseKey);
    const currencies=[...new Set(verified.lines.map(line=>line.currency))];
    if(currencies.length!==1||currencies[0]!=='USD'||doc.reviewedMetadata.country!=='CO'||doc.reviewedMetadata.transportMode!=='AIR')fail('콜롬비아 항공 USD 송장 전체만 함께 계산할 수 있습니다.');
    const settings=new Map((request.lineInputs||[]).map(row=>[row.lineId,row]));
    const saved=new Map((doc.reviewedMetadata.invoiceCostInput?.lineInputs||[]).map(row=>[row.lineId,row]));
    const lineInputs=verified.lines.map(line=>({lineId:line.lineId,tariffRate:0,
      stemsPerBunch:line.bunchQuantity>0?Number(line.stemQuantity)/Number(line.bunchQuantity):null,
      bunchesPerBox:line.boxQuantity>0?Number(line.bunchQuantity)/Number(line.boxQuantity):null,
      groupId:saved.get(line.lineId)?.groupId||'',...settings.get(line.lineId)}));
    members.push({documentId:doc.documentId,revision:doc.revision,sourceHash:doc.sourceHash,orderYear,orderWeek,awb,currency:'USD',country:'CO',
      farmName:doc.reviewedMetadata.farmName,invoiceNo:doc.invoiceNo,lineInputs,
      rows:verified.lines.map(line=>{
        // Native stock may be BOX while the invoice price is per STEM. Costing
        // uses verified receipt stems directly, never invents a bunch count.
        if(unit(line.priceUnit)!=='STEM')fail('공동 콜롬비아 원가의 송이 단가 기준을 확인하세요.');
        return {...coReceiptCostPrice(line),receiptQuantity:line.outQuantity,receiptUnit:unit(line.outUnit),
          actualQuantity:line.stemQuantity,unit:'STEM'};
      })});
    documents.push(doc);receiptLines.push(...verified.lines);
  }
  const manifest={orderYear,orderWeek,awb,currency:'USD',members:members.map(({documentId,revision,sourceHash})=>({documentId,revision,sourceHash}))};
  const knownLines=new Set(receiptLines.map(line=>line.lineId));
  if(requestedLines.some(row=>!knownLines.has(row?.lineId)))fail('다른 공동 AWB의 행별 품종 입력이 포함되어 있습니다.');
  // Do not let edited cost/group inputs change the source snapshot digest.
  const baselineDigest=digest({manifest,documents,receiptLines});
  return {manifest,members,documents,receiptLines,baselineDigest};
}

export function createSharedAwbHandler({queryFn,types,authorize,prepare=prepareSharedAwb,generate=createSharedAwbCostWorkbook}) {
  return async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({success:false,error:'POST 요청만 지원합니다.'});}
    if(!authorize(req.user))return res.status(403).json({success:false,error:'수입부 업무 권한이 필요합니다.'});
    try {
      const request=req.body;
      if(!['prepare','preview','download'].includes(request?.action))fail('준비·계산·다운로드만 지원합니다.',400);
      const prepared=await prepare({queryFn,types,request});
      if(request.action==='prepare')return res.json({success:true,persisted:false,manifest:prepared.manifest,baselineDigest:prepared.baselineDigest,
        members:prepared.members.map(member=>({...member,rows:member.rows.map(({lineId,originalName,stemQuantity,boxQuantity,lineAmount})=>({lineId,originalName,stemQuantity,boxQuantity,lineAmount}))}))});
      if(request.baselineDigest!==prepared.baselineDigest)fail('입고나 송장 목록이 변경되었습니다. 공동 AWB를 다시 조회하세요.',409);
      if(request.completeManifestConfirmed!==true)fail('공동 AWB 전체 농장의 송장 목록을 확인하세요.');
      const result=calculateSharedAwbCost({manifest:prepared.manifest,members:prepared.members,input:request.input});
      if(request.action==='preview')return res.json({success:true,persisted:false,result});
      if(result.status!=='CALCULATED')fail(result.issues.map(issue=>issue.message).join('\n'));
      const first=prepared.documents[0];
      const document={...first,receiptStatus:'SHARED_AWB_PREVIEW',costStatus:'PREVIEW_ONLY',invoiceNo:`AWB ${prepared.manifest.awb}`,
        reviewedMetadata:{...first.reviewedMetadata,country:'CO',transportMode:'AIR',gw:Number(request.input.gw),cw:Number(request.input.cw),farmName:`공동 AWB ${prepared.members.length}개 농장`},receiptLines:prepared.receiptLines};
      const input={...result.appliedInput,nativeCurrency:'USD',exchangeRateKRW:request.input.exchangeRate,
        exchangeRateType:request.input.exchangeRateType||'MANUAL',formulaEffectiveDate:first.reviewedMetadata.inputDate,
        costSourceId:`SHARED_AWB:${prepared.manifest.orderYear}:${prepared.manifest.orderWeek}:${prepared.manifest.awb}`,
        costGroups:result.costGroups,lineInputs:result.lineInputs};
      const bytes=await generate({document,input,result});
      const after=await prepare({queryFn,types,request});
      if(after.baselineDigest!==prepared.baselineDigest)fail('다운로드 생성 중 입고나 송장 목록이 변경되었습니다. 다시 조회하세요.',409);
      res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition',`attachment; filename="shared-awb-${prepared.manifest.orderYear}-${prepared.manifest.orderWeek}-${prepared.manifest.awb}.xlsx"`);
      return res.send(bytes);
    }catch(error){const status=[400,409,422].includes(error.statusCode)?error.statusCode:503;
      return res.status(status).json({success:false,persisted:false,error:status===503?'공동 AWB 조회·계산을 완료하지 못했습니다. 입고·원가는 변경하지 않았습니다.':error.message});}
  };
}
