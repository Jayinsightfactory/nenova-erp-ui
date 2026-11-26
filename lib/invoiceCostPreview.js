import { createHash } from 'node:crypto';
import { normalizeInvoiceDraft } from './invoiceReceiptDocuments.js';
import { validateInvoiceReceiptLines } from './invoiceReceiptValidation.js';
import { INVOICE_COST_FORMULAS, previewInvoiceCost } from './invoiceReceiptCost.js';
import { createInvoicePreviewCostWorkbook } from './invoiceReceiptCostExport.js';
import { auInvoiceTariffDefault } from './auInvoiceTariffDefaults.js';
import { AU_ORIGINAL_SOURCE, calculateAuOriginalCustoms } from './auOriginalCostInputs.js';
import { nlComparisonForExport } from './nlCostCustomerComparison.js';
import { isCloudInvoice, matchCloudCategory } from './chinaCloudCost.js';
import { BUNCH_ST_NL, NL_MASTER_IDX, familyNL, mapProductNL, packingSourceKey } from './importPacking.js';
import { isNlInvoiceOwnCode, normalizeNlInvoiceCustomerCode } from './nlInvoiceCustomerCode.js';
import { nlInvoiceTariffRate } from './nlInvoiceTariffReference.js';

const countries={AU:'호주',CN:'중국',CO:'콜롬비아',EC:'에콰도르',NL:'네덜란드',TH:'태국',US:'미국',VN:'베트남',NZ:'뉴질랜드'};
// These checks protect native header persistence, which this calculation never performs.
const nativeHeaderOnly=new Set(['FARM_REQUIRED','INVOICE_YEAR_REQUIRED','AWB_INVALID','METADATA_PRECISION_INVALID','FREIGHT_CURRENCY_REQUIRED']);
const qtyFields=['boxQuantity','bunchQuantity','stemQuantity','unitPrice','lineAmount'];
const round6=v=>Math.round(v*1e6)/1e6;
function fail(message,statusCode=422){throw Object.assign(new Error(message),{statusCode});}

function nlDraftBunchRatio(rawName, prodName, dbRatio) {
  const fam = familyNL(rawName) || familyNL(prodName);
  return BUNCH_ST_NL[fam] || (Number(dbRatio) > 0 ? Number(dbRatio) : 1);
}

function consolidateNlDraftLines(docLines, validatedLines, products) {
  const productByKey = new Map(products.map(p => [p.ProdKey, p]));
  const qtyByUnit = (row, unit) => unit === '단' ? row.bunchQuantity : unit === '박스' ? row.boxQuantity : row.stemQuantity;
  const entries = docLines.map((docLine, idx) => {
    const valLine = validatedLines[idx];
    const product = productByKey.get(valLine.prodKey);
    const rawDesc = docLine.sourceEvidence?.nlRawDescription || docLine.originalName || '';
    const code = normalizeNlInvoiceCustomerCode(docLine.sourceEvidence?.invoiceCustomerCode ?? docLine.cl);
    const block = !code ? 'UNKNOWN' : isNlInvoiceOwnCode(code) ? 'OWN' : 'OTHER';
    const sortName = mapProductNL(rawDesc);
    const displayName = product?.ProdName || sortName || docLine.originalName;
    return { docLine, valLine, product, rawDesc, code, block, sortName, displayName };
  });
  const consolidateBlock = list => {
    const byKey = new Map();
    for (const item of list) {
      const key = JSON.stringify([
        packingSourceKey(item.rawDesc), item.valLine.prodKey,
        item.valLine.unitPrice, item.docLine.priceUnit, item.docLine.currency,
      ]);
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(item);
    }
    const groups = [...byKey.values()].map(members => {
      const first = members[0];
      const sumField = field => members.every(m => typeof m.valLine[field] === 'number' && Number.isFinite(m.valLine[field]))
        ? round6(members.reduce((sum, m) => sum + m.valLine[field], 0)) : null;
      const boxQuantity = sumField('boxQuantity');
      const bunchQuantity = sumField('bunchQuantity');
      const stemQuantity = sumField('stemQuantity');
      const lineAmount = round6(members.reduce((sum, m) => sum + m.valLine.lineAmount, 0));
      const steamOf1Bunch = bunchQuantity > 0 && stemQuantity != null
        ? round6(stemQuantity / bunchQuantity) : first.valLine.steamOf1Bunch;
      const steamOf1Box = boxQuantity > 0 && stemQuantity != null
        ? round6(stemQuantity / boxQuantity) : first.valLine.steamOf1Box;
      const sourceEvidence = {
        ...first.docLine.sourceEvidence,
        nlRawDescription: first.rawDesc,
        ...(first.code ? { invoiceCustomerCode: first.code } : { invoiceCustomerCode: '' }),
        ...(members.length > 1 ? { mergedLineIds: members.map(m => m.docLine.lineId) } : {}),
      };
      const mergedDocLine = {
        ...first.docLine,
        originalName: first.displayName,
        boxQuantity,
        bunchQuantity,
        stemQuantity,
        lineAmount,
        sourceEvidence,
      };
      const counts = { boxQuantity, bunchQuantity, stemQuantity };
      const mergedValLine = {
        ...first.valLine,
        originalName: first.displayName,
        boxQuantity,
        bunchQuantity,
        stemQuantity,
        lineAmount,
        outQuantity: qtyByUnit(counts, first.valLine.outUnit),
        estQuantity: qtyByUnit(counts, first.valLine.estUnit),
        steamOf1Bunch,
        steamOf1Box,
        sourceEvidence,
      };
      return { sortName: first.sortName, displayName: first.displayName, docLine: mergedDocLine, valLine: mergedValLine };
    });
    groups.sort((a, b) => {
      const ia = NL_MASTER_IDX[a.sortName] ?? NL_MASTER_IDX[a.displayName] ?? 9999;
      const ib = NL_MASTER_IDX[b.sortName] ?? NL_MASTER_IDX[b.displayName] ?? 9999;
      if (ia !== ib) return ia - ib;
      return a.sortName.localeCompare(b.sortName);
    });
    return groups;
  };
  const ordered = [
    ...consolidateBlock(entries.filter(e => e.block === 'OWN')),
    ...consolidateBlock(entries.filter(e => e.block === 'OTHER')),
    ...consolidateBlock(entries.filter(e => e.block === 'UNKNOWN')),
  ];
  return {
    lines: ordered.map((g, idx) => ({ ...g.docLine, lineNo: idx + 1 })),
    receiptLines: ordered.map((g, idx) => ({ ...g.valLine, lineNo: idx + 1 })),
  };
}

export async function prepareInvoiceCostPreview({queryFn,types,request}) {
  const draft=normalizeInvoiceDraft(request.document);
  const rawLines=draft.lines.map(line=>({...line,...Object.fromEntries(qtyFields.map(k=>[k,line[k]==null?null:Number(line[k])]))}));
  const keys=[...new Set(rawLines.map(l=>l.prodKey).filter(Number.isInteger))].sort((a,b)=>a-b);
  const params=Object.fromEntries(keys.map((key,i)=>[`p${i}`,{type:types.Int,value:key}]));
  const products=(await queryFn(`/* invoice-cost:upload-preview-products */ SELECT ProdKey,ProdName,CounName,CountryFlower,
    OutUnit,EstUnit,SteamOf1Box,SteamOf1Bunch,BunchOf1Box,isDeleted FROM dbo.Product
    WHERE ProdKey IN (${keys.length?keys.map((_,i)=>`@p${i}`).join(','):'NULL'}) ORDER BY ProdKey`,params)).recordset;
  if(!Array.isArray(products))fail('전산 품목을 조회하지 못했습니다. 다시 시도하세요.',503);
  const isNl = draft.reviewedMetadata?.country === 'NL';
  const lines = isNl ? rawLines.map(line => {
    if (line.bunchQuantity != null || typeof line.stemQuantity !== 'number' || !Number.isFinite(line.stemQuantity) || line.stemQuantity < 0) return line;
    const p = products.find(item => item.ProdKey === line.prodKey);
    const ratio = nlDraftBunchRatio(line.sourceEvidence?.nlRawDescription || line.originalName, p?.ProdName, p?.SteamOf1Bunch);
    return {
      ...line,
      bunchQuantity: round6(line.stemQuantity / ratio),
      sourceEvidence: { ...line.sourceEvidence, packing: { ...line.sourceEvidence?.packing, stemsPerBunch: ratio } },
    };
  }) : rawLines;
  const document={...draft,lines,revision:request.document.revision??draft.expectedRevision??0,
    receiptStatus:'INVOICE_PREVIEW',costStatus:'PREVIEW_ONLY',operations:[],warehouseKey:null};
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
  if (isNl && !issues.length && validation.lines.length > 0) {
    const consolidated = consolidateNlDraftLines(document.lines, validation.lines, products);
    document.lines = consolidated.lines;
    document.receiptLines = consolidated.receiptLines;
  } else {
    document.receiptLines = validation.lines;
  }
  const activeLines = document.receiptLines;
  const meta=document.reviewedMetadata, saved=meta.invoiceCostInput||{}, byId=new Map((saved.lineInputs||[]).map(l=>[l.lineId,l]));
  const tariffDefaults=Object.fromEntries(activeLines.map(l=>[l.lineId,auInvoiceTariffDefault(document,products.find(p=>p.ProdKey===l.prodKey))]).filter(([,v])=>v));
  document.reviewedMetadata={...meta,tariffDefaults,invoiceCostInput:{formulaEffectiveDate:meta.inputDate,exchangeRateDate:meta.inputDate,
    exchangeRateType:'MANUAL',allocationScope:'SINGLE_INVOICE',allocationShareNumerator:1,allocationShareDenominator:1,
    costSourceId:`인보이스 ${document.invoiceNo}`, ...saved,
    lineInputs:activeLines.map(l=>({lineId:l.lineId,...(tariffDefaults[l.lineId]?{tariffRate:tariffDefaults[l.lineId].tariffRate}:{}),
      ...(isNl ? { tariffRate: nlInvoiceTariffRate(l.sourceEvidence?.nlRawDescription || l.originalName, l.originName || '') } : {}),
      ...(isCloudInvoice(document)?{categoryCode:matchCloudCategory(`${l.originalName||''} ${products.find(p=>p.ProdKey===l.prodKey)?.ProdName||''}`)}:{}),
      stemsPerBunch:l.bunchQuantity>0&&l.stemQuantity!=null?l.stemQuantity/l.bunchQuantity:null,
      bunchesPerBox:l.boxQuantity>0&&l.bunchQuantity!=null?l.bunchQuantity/l.boxQuantity:null,...byId.get(l.lineId)}))}};
  const baselineDigest=createHash('sha256').update(JSON.stringify({document,products})).digest('hex');
  return {document,issues,baselineDigest};
}
export function calculateInvoiceCostPreview(prepared,request){
  if(request.baselineDigest!==prepared.baselineDigest)fail('인보이스 입력이나 전산 품목 기준이 변경되었습니다. 인보이스 원가 준비를 다시 실행하세요.',409);
  if(prepared.issues.length)fail(prepared.issues.map(i=>i.message).join('\n'));
  const input={...request.input}, formula=INVOICE_COST_FORMULAS[input.formulaId],document=prepared.document;
  if(!formula||formula.country!==document.reviewedMetadata.country||formula.transportMode!==document.reviewedMetadata.transportMode)
    fail('인보이스 국가·운송 방식과 원가 공식이 일치하지 않습니다.');
  if(input.formulaId==='AU_CNF_BUNCH_V1' && input.auOriginalMode==='FORMULA'){
    const calculated=calculateAuOriginalCustoms(input.auOriginal);
    if(calculated.total===null)fail('호주 원본 통관비 계산에 필요한 GW·품목수·비용 입력을 확인하세요. 빈 값은 0으로 처리하지 않습니다.');
    input.customsTotalKRW=calculated.total;
    input.expenseBasis='ESTIMATED'; input.estimateSource=AU_ORIGINAL_SOURCE;
  }
  const preview=previewInvoiceCost({...document,costInput:input},document.receiptLines);
  return {document,input,preview:{...preview,note:'인보이스 수량 기준 미승인 계산본입니다. 입고·재고·승인 원가는 변경하지 않습니다.'}};
}
export function createInvoiceCostPreviewHandler({queryFn,types,authorize,generate=createInvoicePreviewCostWorkbook,preserveHistory=async bytes=>bytes}){
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
    result.nlComparison=await nlComparisonForExport({...result,queryFn,types});
    const bytes=await generate(result);
    const latest=await prepareInvoiceCostPreview({queryFn,types,request:req.body});
    if(latest.baselineDigest!==prepared.baselineDigest)fail('엑셀 생성 중 품목 기준이 변경되었습니다. 다시 준비하세요.',409);
    if(result.nlComparison){const after=await nlComparisonForExport({...result,queryFn,types});
      if(after.digest!==result.nlComparison.digest)fail('엑셀 생성 중 주광 주문·입고가 변경되었습니다. 다시 준비하세요.',409);}
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition',`attachment; filename="invoice-cost-${result.document.orderYear}-${result.document.orderWeek}.xlsx"`);
    return res.send(await preserveHistory(bytes,result,req.user));
  }catch(error){const status=[400,404,409,422].includes(error.statusCode)?error.statusCode:503;
    return res.status(status).json({success:false,error:status===503?'인보이스 원가 계산을 완료하지 못했습니다. 입력은 유지되며 입고는 등록하지 않았습니다.':error.message,persisted:false});}
 };
}
