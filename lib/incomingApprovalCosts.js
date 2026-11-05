import { createHash, randomUUID } from 'node:crypto';
import { getInvoiceDocument, insertLines, businessKeyHash } from './invoiceReceiptDocuments.js';
import { INVOICE_COST_FORMULAS, buildReceiptLines, validateLiveReceiptDetails, previewInvoiceCost, saveInvoiceCostRevision, readInvoiceCosts } from './invoiceReceiptCost.js';
import { computeFreightCost } from './freightCalc.js';

const p=(type,value)=>({type,value}), rr=result=>{if(!Array.isArray(result?.recordset))throw error('READ_FAILED','연결 원가 자료를 완전히 읽지 못했습니다.');return result.recordset;};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const error=(code,message)=>Object.assign(new Error(message),{code:`APPROVAL_COST_${code}`,statusCode:409});
const json=value=>typeof value==='string'?JSON.parse(value):value;
const num=value=>{if(value===null||value===undefined||typeof value==='boolean'||typeof value==='object'||String(value).trim()===''||!Number.isFinite(Number(value))||Number(value)<0||Number(value)>1e10)throw error('NUMBER','원가 매칭 수량은 0 이상의 숫자여야 합니다.');return Number(value);};
const close=(a,b)=>Math.abs(Number(a)-Number(b))<0.000001;
function stableId(value){const h=hash(value);return `${h.slice(0,8)}-${h.slice(8,12)}-8${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;}
const productKey=d=>Number(d.ProdKey??d.prodKey);
const quantityField=mode=>mode==='EXISTING_NL'?'SteamQuantity':['EXISTING_CN','EXISTING_TH'].includes(mode)?'BunchQuantity':'OutQuantity';
const sqlMax=types=>typeof types.NVarChar==='function'?types.NVarChar(types.MAX):types.NVarChar;

/** Locks and returns existing financial evidence. No schema creation and no writes. */
export async function readIncomingApprovalCosts(q,types,warehouseKey,locked=false){
 const hint=locked?'WITH (UPDLOCK,HOLDLOCK)':'',params={wk:p(types.Int,warehouseKey)};
 const freightHeaders=rr(await q(`SELECT * FROM dbo.FreightCost ${hint} WHERE WarehouseKey=@wk AND isDeleted=0 ORDER BY FreightKey`,params));
 const freightDetails=rr(await q(`SELECT d.* FROM dbo.FreightCostDetail d ${hint} JOIN dbo.FreightCost f ${hint} ON f.FreightKey=d.FreightKey WHERE f.WarehouseKey=@wk AND f.isDeleted=0 ORDER BY d.FreightKey,d.SortOrder,d.DetailKey`,params));
 const linked=rr(await q(`SELECT DISTINCT DocumentId FROM dbo.WebInvoiceOperation ${hint} WHERE WarehouseKey=@wk AND Status=N'COMMITTED' ORDER BY DocumentId`,params));
 const invoices=[];
 for(const link of linked){
  const dp={id:p(types.UniqueIdentifier,link.DocumentId)};
  await q(`SELECT DocumentId,Revision FROM dbo.WebInvoiceDocument ${hint} WHERE DocumentId=@id`,dp);
  if(locked)await q(`SELECT LineId FROM dbo.WebInvoiceLine ${hint} WHERE DocumentId=@id`,dp);
  const document=await getInvoiceDocument({queryFn:q,types,documentId:String(link.DocumentId)});
  const operations=document.operations.filter(o=>o.status==='COMMITTED'&&o.documentRevision===document.revision&&o.warehouseKey===Number(warehouseKey));
  if(operations.length!==1)throw error('LINEAGE','현재 문서 버전의 확정 입고 연결이 하나여야 합니다. 문서 변경 이력을 확인하세요.');
  const operation=operations[0],costRevisions=rr(await q(`SELECT * FROM dbo.WebInvoiceCostRevision ${hint} WHERE DocumentId=@id AND Status=N'APPROVED' ORDER BY Basis,RevisionNo`,dp));
  const costLines=rr(await q(`SELECT l.* FROM dbo.WebInvoiceCostLine l ${hint} JOIN dbo.WebInvoiceCostRevision r ${hint} ON r.CostRevisionId=l.CostRevisionId WHERE r.DocumentId=@id AND r.Status=N'APPROVED' ORDER BY l.CostRevisionId,l.LineId`,dp));
  const receiptLines=buildReceiptLines(document,operation);
  const live=await validateLiveReceiptDetails({queryFn:q,types,operation,receiptLines,locked});
  if(!live.matches)throw error('SOURCE_STALE','연결된 인보이스의 입고 스냅샷이 현재 원장과 다릅니다.');
  if(costRevisions.some(r=>Number(r.DocumentRevision)!==document.revision||String(r.OperationId).toLowerCase()!==operation.operationId))throw error('REVISION_STALE','승인 원가의 문서·입고 연결 버전이 현재 문서와 다릅니다.');
  invoices.push({document,operation,receiptLines,costRevisions,costLines});
 }
 if(freightHeaders.length>1)throw error('FREIGHT_DUPLICATE','활성 운송원가가 여러 개입니다.');
 return {warehouseKey:Number(warehouseKey),freightHeaders,freightDetails,invoices};
}

/** Build invoice source-line lineage; splitting/merging never guesses a source line. */
export function planApprovalInvoiceLines({invoice,after,products,lineMappings,receiptMappings=[],farmOnly=false}){
 const {document,operation}=invoice,oldLines=new Map(document.lines.map(l=>[l.lineId,l])),oldMap=new Map(operation.result.lineMappings.map(m=>[String(m.lineId).toLowerCase(),m]));
 if(farmOnly)return {lines:document.lines.map(l=>({...l})),mappings:operation.result.lineMappings.map(m=>({...m})),origins:Object.fromEntries(document.lines.map(l=>[l.lineId,l.lineId])),linkMode:operation.result.linkMode??null,action:operation.action,excludedDetailKeys:operation.result.excludedDetailKeys??[]};
 if(!Array.isArray(lineMappings)||!lineMappings.length)throw error('LINE_MATCH_REQUIRED','인보이스 원문 행과 수정 입고 행의 수량 매칭이 필요합니다.');
 const counts=new Map(),sums=new Map(),used=new Set(),lines=[],mappings=[],origins={};
 const mode=operation.result.linkMode??null,field=quantityField(mode),oldExcluded=new Set((operation.result.excludedDetailKeys??[]).map(Number));
 const excludedTargetIndices=receiptMappings.filter(m=>m.targetRowIndex!==null&&m.targetRowIndex!==undefined&&oldExcluded.has(Number(m.sourceWdetailKey))).map(m=>Number(m.targetRowIndex));
 for(const [i,m] of lineMappings.entries()){
  const sourceId=String(m.sourceLineId??'').toLowerCase(),source=oldLines.get(sourceId),sourceMapping=oldMap.get(sourceId);
  if(!source||!sourceMapping)throw error('LINE_SOURCE','현재 인보이스에 없는 원문 행입니다.');
  const quantity=num(m.quantity),cancel=m.targetRowIndex===null;
  if(cancel&&quantity!==0)throw error('CANCEL_QUANTITY','삭제한 원문 행은 수량 0으로 매칭하세요.');
  if(!cancel&&(typeof m.targetRowIndex==='boolean'||m.targetRowIndex===undefined||String(m.targetRowIndex).trim()===''))throw error('TARGET','수정 입고 행을 정확히 선택하세요.');
  const index=cancel?null:Number(m.targetRowIndex),target=cancel?null:after[index];
  if(!cancel&&(!Number.isInteger(index)||index<0||!target))throw error('TARGET','수정 입고 행을 정확히 선택하세요.');
  const total=target?num(target[field]):0;if(!cancel&&total<=0&&quantity>0)throw error('TARGET_QUANTITY','0 수량 입고에 양수 원가를 배정할 수 없습니다.');
  const ratio=total>0?quantity/total:0,seq=counts.get(sourceId)??0;counts.set(sourceId,seq+1);used.add(sourceId);
  const lineId=seq===0?sourceId:stableId([document.documentId,document.revision+1,sourceId,i,index]);
  const prod=target?products.find(p=>productKey(p)===Number(target.ProdKey)):products.find(p=>productKey(p)===Number(source.prodKey));
  if(!prod)throw error('PRODUCT','매칭 품목을 찾을 수 없습니다.');
  const v=key=>target?Number(target[key]??0)*ratio:0;
  const line={...source,lineId,lineNo:lines.length+1,prodKey:target?Number(target.ProdKey):Number(source.prodKey),boxQuantity:v('BoxQuantity'),bunchQuantity:v('BunchQuantity'),stemQuantity:v('SteamQuantity'),unitPrice:target?target.UPrice:source.unitPrice,lineAmount:v('TPrice'),reviewed:{...source.reviewed,incomingCorrection:true,sourceLineId:sourceId}};
  const mapping={lineId,wdetailKey:cancel?Number(sourceMapping.wdetailKey):null,targetRowIndex:index,prodKey:line.prodKey,unit:prod.OutUnit,outQuantity:v('OutQuantity'),boxQuantity:line.boxQuantity,bunchQuantity:line.bunchQuantity,stemQuantity:line.stemQuantity,unitPrice:line.unitPrice,lineAmount:line.lineAmount};
  lines.push(line);mappings.push(mapping);origins[lineId]=sourceId;if(!cancel)sums.set(index,(sums.get(index)??0)+quantity);
 }
 if(used.size!==oldLines.size)throw error('LINE_INCOMPLETE','기존 인보이스 모든 행을 매칭하거나 수량 0으로 취소해야 합니다.');
 for(const [index,target] of after.entries())if(excludedTargetIndices.includes(index)){if(sums.has(index))throw error('EXCLUDED_LINE','기존 원가 제외 행에는 상품 원문을 매칭할 수 없습니다.');}else if(Number(target[field])>0&&!close(sums.get(index)??0,target[field]))throw error('LINE_TOTAL',`수정 입고 ${index+1}행의 원가 매칭 수량 합계가 다릅니다.`);
 if(!mode&&new Set(mappings.filter(m=>m.targetRowIndex!==null).map(m=>m.targetRowIndex)).size!==mappings.filter(m=>m.targetRowIndex!==null).length)throw error('LINE_DUPLICATE','이 인보이스 형식은 입고 한 행당 원문 한 행으로 연결해야 합니다.');
 return {lines,mappings,origins,linkMode:mode,action:mode?'LINK_EXISTING_COST':'UPDATE_RECEIPT',excludedDetailKeys:[...oldExcluded],excludedTargetIndices};
}

function freightDefaultInput(header){return {basis:header.WeightBasis,master:{warehouseKey:header.WarehouseKey,exchangeRate:header.ExchangeRate,gw:header.GrossWeight,cw:header.ChargeableWeight,rateUSD:header.FreightRateUSD,docFeeUSD:header.DocFeeUSD,invoiceUSD:header.InvoiceTotalUSD},customs:{bakSangRate:header.BakSangRate,handlingFee:header.HandlingFee,quarantinePerItem:header.QuarantinePerItem,domesticFreight:header.DomesticFreight,deductFee:header.DeductFee,extraFee:header.ExtraFee}};}
export function planApprovalFreight({header,details,after,products,receiptMappings=[],input={},farmName,orderWeek,farmOnly=false}){
 if(farmOnly)return {header,details,farmOnly:true,farmName,beforeTotal:details.reduce((s,d)=>s+Number(d.ArrivalPerStem??0)*Number(d.SteamQty??0),0)};
 const saved=freightDefaultInput(header),master={...saved.master,...input.master,orderWeek},customs={...saved.customs,...input.customs},basis=input.basis??saved.basis;
 if(!['GW','CBM'].includes(basis))throw error('FREIGHT_BASIS','운송원가 배분 기준을 선택하세요.');
 for(const key of ['exchangeRate','gw','cw','rateUSD'])if(!(num(master[key])>0))throw error('FREIGHT_INPUT',`${key} 값을 확인하세요.`);
 for(const key of Object.keys(saved.customs))num(customs[key]);num(master.docFeeUSD);
 const productMeta={},flowerMeta={},rows=[];
 for(const [index,d] of after.entries()){
  if(!Number(d.OutQuantity)&&!Number(d.SteamQuantity)&&!Number(d.BunchQuantity)&&!Number(d.BoxQuantity))continue;
  const product=products.find(p=>productKey(p)===Number(d.ProdKey));if(!product)throw error('PRODUCT','운송원가 품목을 찾을 수 없습니다.');
  const sourceKeys=receiptMappings.filter(m=>m.targetRowIndex!==null&&m.targetRowIndex!==undefined&&Number(m.targetRowIndex)===index).map(m=>Number(m.sourceWdetailKey));
  const sources=details.filter(r=>sourceKeys.includes(Number(r.WarehouseDetailKey))),same=sources.length===1&&Number(sources[0].ProdKey)===Number(d.ProdKey)?sources[0]:null;
  const explicit=(input.rows??[]).find(r=>Number(r.targetRowIndex)===index);
  if(!same&&!explicit)throw error('FREIGHT_ROW_REVIEW',`수정 입고 ${index+1}행의 무게·관세·판매단가를 확인하세요.`);
  const values={boxWeight:same?.BoxWeightUsed,boxCBM:same?.BoxCBMUsed,stemsPerBox:same?.StemsPerBoxUsed,stemsPerBunch:same?.StemsPerBunch,salePriceKRW:same?.SalePriceKRW,tariffRate:same?.TariffRate,...explicit};
  for(const key of ['boxWeight','boxCBM','stemsPerBox','stemsPerBunch','salePriceKRW','tariffRate'])num(values[key]);
  productMeta[d.ProdKey]={boxWeight:values.boxWeight,boxCBM:values.boxCBM,tariffRate:values.tariffRate};
  const flower=product.FlowerName??same?.FlowerName??'';
  if(flowerMeta[flower]&&!close(flowerMeta[flower].stemsPerBox,values.stemsPerBox))throw error('FREIGHT_FLOWER_INPUT','같은 품종의 박스당 송이수 입력이 서로 다릅니다.');
  flowerMeta[flower]={stemsPerBox:values.stemsPerBox};
  rows.push({targetRowIndex:index,warehouseDetailKey:null,prodKey:Number(d.ProdKey),prodName:product.ProdName,flowerName:product.FlowerName??same?.FlowerName??'',counName:product.CounName,farmName,boxQty:Number(d.BoxQuantity),rawBoxQty:Number(d.BoxQuantity),bunchQty:Number(d.BunchQuantity),steamQty:Number(d.SteamQuantity),fobUSD:Number(d.UPrice),totalPriceUSD:Number(d.TPrice),outUnit:product.OutUnit,stemsPerBunch:values.stemsPerBunch,salePriceKRW:values.salePriceKRW,tariffRate:values.tariffRate});
 }
 master.invoiceUSD=after.reduce((s,d)=>s+Number(d.TPrice??0),0);master.itemCount=new Set(rows.map(r=>r.flowerName).filter(Boolean)).size;
 const calc=computeFreightCost({master,basis,customs,details:rows,productMeta,flowerMeta});
 if(calc.warnings.some(w=>w.level==='error'))throw error('FREIGHT_CALC',calc.warnings.filter(w=>w.level==='error').map(w=>w.msg).join(' '));
 return {header,details,master,customs,basis,calc,targets:rows.map(r=>r.targetRowIndex),farmOnly:false,beforeTotal:details.reduce((s,d)=>s+Number(d.ArrivalPerStem??0)*Number(d.SteamQty??0),0)};
}

export async function prepareIncomingApprovalCosts({costFacts,receiptPlan,receiptMappings=[],matching={},products,beforeReceipt}){
 const invoicePlans=[],freightPlans=[],issues=[],farmOnly=!receiptPlan.detailsChanged,financial=matching.financial??{},inputs=financial.costInputs??[];
 const attempt=fn=>{try{return fn();}catch(e){issues.push({code:e.code??'APPROVAL_COST_INVALID',message:e.message});return null;}};
 if((costFacts.invoices.length||costFacts.freightHeaders.length)&&(!(financial.acknowledged||financial.prepared)||!String(financial.reason??'').trim()))issues.push({code:'APPROVAL_COST_REVIEW_REQUIRED',message:'연결 원가의 변경 내역과 정정 사유를 확인하세요.'});
 if(financial.prepared&&receiptPlan.detailsChanged&&receiptPlan.after.some((a,i)=>!receiptPlan.before.some(b=>receiptMappings.some(m=>m.targetRowIndex===i&&m.sourceWdetailKey===b.WdetailKey)&&b.ProdKey===a.ProdKey)))issues.push({code:'APPROVAL_COST_NEW_PRODUCT',message:'추가·변경 품목의 원가 근거를 확인하세요. 다른 품목의 단가·중량은 자동 적용하지 않습니다.'});
 for(const invoice of costFacts.invoices){const plan=attempt(()=>{
  const source=inputs.find(x=>x.kind==='INVOICE'&&String(x.sourceKey).toLowerCase()===invoice.document.documentId);
  if(!farmOnly&&(!source||Number(source.expectedRevision)!==invoice.document.revision))throw error('REVIEW_VERSION','현재 인보이스 버전의 원가 매칭을 검토하세요.');
  const linePlan=planApprovalInvoiceLines({invoice,after:receiptPlan.after,products,lineMappings:source?.lineMappings,receiptMappings,farmOnly});
  const actual=invoice.costRevisions.find(r=>r.Basis==='ACTUAL');
  if(invoice.costRevisions.length&&!actual)throw error('ACTUAL_REQUIRED','비교 원가만 있고 실제 승인 원가가 없습니다.');
  let input=source?.input??(actual?json(actual.InputSnapshotJson).input:null),preview=null;
  if(actual&&!farmOnly){if(!input)throw error('INPUT_REQUIRED','기존 원가 입력을 검토하세요.');input={...input,lineInputs:linePlan.lines.map(l=>{const x=(input.lineInputs??[]).find(x=>String(x.lineId).toLowerCase()===l.lineId)??(input.lineInputs??[]).find(x=>String(x.lineId).toLowerCase()===linePlan.origins[l.lineId]);return x?{...x,lineId:l.lineId}:null;}).filter(Boolean)};
   preview=previewInvoiceCost({...invoice.document,costInput:input},linePlan.lines.map(l=>{const m=linePlan.mappings.find(m=>m.lineId===l.lineId);return {...l,outQuantity:m.outQuantity,outUnit:m.unit};}));if(preview.status!=='APPROVED')throw error('INPUT_REVIEW',preview.issues.map(i=>i.message).join(' '));}
  return {...invoice,...linePlan,input,preview,farmOnly};
 });if(plan)invoicePlans.push(plan);}
 for(const header of costFacts.freightHeaders){const plan=attempt(()=>{const source=inputs.find(x=>x.kind==='FREIGHT'&&Number(x.sourceKey)===Number(header.FreightKey));if(!farmOnly&&(!source||Number(source.expectedRevision)!==Number(header.FreightKey)))throw error('FREIGHT_REVIEW_VERSION','현재 운송원가 버전의 변경 내역을 확인하세요.');return planApprovalFreight({header,details:costFacts.freightDetails.filter(d=>d.FreightKey===header.FreightKey),after:receiptPlan.after,products,receiptMappings,input:source?.input,farmName:receiptPlan.farmName??matching.farmName??beforeReceipt.header.FarmName,orderWeek:beforeReceipt.header.OrderWeek,farmOnly});});if(plan)freightPlans.push(plan);}
 return {issues,invoicePlans,freightPlans,farmOnly,financial,summary:{invoices:invoicePlans.map(i=>({documentId:i.document.documentId,beforeRevision:i.document.revision,afterRevision:i.document.revision+1,beforeTotal:i.costLines.filter(l=>i.costRevisions.some(r=>String(r.CostRevisionId)===String(l.CostRevisionId)&&r.Basis==='ACTUAL')).reduce((s,l)=>s+Number(l.TotalCost??0),0),afterTotal:i.preview?.totals?.totalCostKRW??(farmOnly?i.costLines.filter(l=>i.costRevisions.some(r=>String(r.CostRevisionId)===String(l.CostRevisionId)&&r.Basis==='ACTUAL')).reduce((s,l)=>s+Number(l.TotalCost??0),0):null),preserveEconomics:farmOnly})),freight:freightPlans.map(f=>({freightKey:f.header.FreightKey,beforeTotal:f.beforeTotal,afterTotal:f.calc?f.calc.rows.reduce((s,r)=>{const d=storageFreightRow({ArrivalPerStem:r.arrivalPerStem,SteamQty:r.steamQty});return s+d.ArrivalPerStem*d.SteamQty;},0):f.beforeTotal}))}};
}

export function suggestedIncomingApprovalCostInputs({costFacts,receiptPlan,receiptMappings=[]}){
 const inputs=[];
 for(const invoice of costFacts.invoices){const actual=invoice.costRevisions.find(r=>r.Basis==='ACTUAL'),field=quantityField(invoice.operation.result.linkMode);
  const savedInput=actual?json(actual.InputSnapshotJson).input:null,profile=INVOICE_COST_FORMULAS[savedInput?.formulaId];
  const input=savedInput?{...savedInput,...(profile?.country==='TH'?{groupBoxBasis:savedInput.groupBoxBasis??'RECEIPT_LINES',packingBoxTotal:savedInput.packingBoxTotal??null,lossTreatmentConfirmed:savedInput.lossTreatmentConfirmed===true}:{}),lineInputs:invoice.document.lines.map(line=>{const saved=savedInput.lineInputs?.find(x=>String(x.lineId).toLowerCase()===line.lineId)??{};return {lineId:line.lineId,...Object.fromEntries((profile?.lineInputFields??[]).map(key=>[key,saved[key]??null])),...saved};})}:null;
  const inputSchema=profile?{formulaLabel:profile.label,lineFields:profile.lineInputFields??[],groupFields:profile.costGroupFields??[],groupIds:profile.groupIds??[],topLevelFields:profile.requiredTopLevelInputs??[],labels:{groupId:'포장 그룹',tariffRate:'관세율',stemsPerBunch:'단당 송이수',bunchesPerBox:'박스당 단수',grossWeightKg:'실중량(kg)',volumeWeightKg:'부피중량(kg)',allocationShare:'행 배분비율',quantity:'그룹 송이수',boxQuantity:'그룹 박스수',packingBoxTotal:'전체 패킹 박스수',lossTreatmentConfirmed:'검역 손실 처리 확인',customsTotalKRW:'통관비 합계(원)',otherCostPerUnitKRW:'단위당 기타 원가(원)'},groupLabels:{ROSE:'장미',CARNATION:'카네이션',ALSTROMERIA:'알스트로메리아',RUSCUS:'루스커스',HYDRANGEA:'수국',ANTHURIUM:'안스리움',OTHERS:'기타',LOOSE_BLOOMS:'낱송이'}}:null;
  inputs.push({kind:'INVOICE',sourceKey:invoice.document.documentId,expectedRevision:invoice.document.revision,input,inputSchema,
   lineMappings:invoice.document.lines.map(line=>{const old=invoice.operation.result.lineMappings.find(m=>String(m.lineId).toLowerCase()===line.lineId),targets=receiptMappings.filter(m=>Number(m.sourceWdetailKey)===Number(old?.wdetailKey));const targetIndex=targets.length===1?(targets[0].targetRowIndex==null?-1:Number(targets[0].targetRowIndex)):receiptPlan.after.findIndex(d=>Number(d.ProdKey)===Number(line.prodKey));return {sourceLineId:line.lineId,targetRowIndex:targetIndex>=0?targetIndex:null,quantity:targetIndex<0?0:Number(invoice.receiptLines.find(l=>l.lineId===line.lineId)?.[field==='SteamQuantity'?'stemQuantity':field==='BunchQuantity'?'bunchQuantity':'outQuantity']??0),sourceLabel:line.originalName,sourceProdKey:line.prodKey,quantityUnit:field==='SteamQuantity'?'송이':field==='BunchQuantity'?'단':old?.unit};})});
 }
 for(const header of costFacts.freightHeaders){const base=freightDefaultInput(header);inputs.push({kind:'FREIGHT',sourceKey:header.FreightKey,expectedRevision:header.FreightKey,input:{...base,rows:receiptPlan.after.map((d,index)=>{const sourceKeys=receiptMappings.filter(m=>m.targetRowIndex!=null&&Number(m.targetRowIndex)===index).map(m=>Number(m.sourceWdetailKey)),r=costFacts.freightDetails.find(r=>sourceKeys.includes(Number(r.WarehouseDetailKey)))??costFacts.freightDetails.find(r=>Number(r.ProdKey)===Number(d.ProdKey));return {targetRowIndex:index,boxWeight:r?.BoxWeightUsed??null,boxCBM:r?.BoxCBMUsed??null,stemsPerBox:r?.StemsPerBoxUsed??null,stemsPerBunch:r?.StemsPerBunch??null,salePriceKRW:r?.SalePriceKRW??null,tariffRate:r?.TariffRate??null};})}});}
 return inputs;
}

const freightHeaderFields=['WarehouseKey','WeightBasis','ExchangeRate','GrossWeight','ChargeableWeight','FreightRateUSD','DocFeeUSD','InvoiceTotalUSD','BakSangRate','HandlingFee','QuarantinePerItem','DomesticFreight','DeductFee','ExtraFee'];
const freightDetailFields=['WarehouseDetailKey','ProdKey','ProdName','FlowerName','FarmName','SteamQty','FOBUSD','BoxQty','BoxWeightUsed','BoxCBMUsed','StemsPerBoxUsed','StemsPerBunch','SalePriceKRW','TariffRate','FreightPerStemUSD','CNF_USD','CNF_KRW','TariffKRW','CustomsPerStem','ArrivalPerStem','ArrivalPerBunch','SalePriceExVAT','ProfitPerBunch','ProfitRate','TotalSaleKRW','TotalProfitKRW','SortOrder'];
const freightCalcKeys=['warehouseDetailKey','prodKey','prodName','flowerName','farmName','steamQty','fobUSD','boxQty','boxWeightUsed','boxCBMUsed','stemsPerBoxUsed','stemsPerBunch','salePriceKRW','tariffRate','freightPerStemUSD','cnfUSD','cnfKRW','tariffKRW','customsPerStem','arrivalPerStem','arrivalPerBunch','salePriceExVAT','profitPerBunch','profitRate','totalSaleKRW','totalProfitKRW','sortOrder'];
const textFields=new Set(['WeightBasis','CurrencyCode','CurrencyValidationStatus','ProdName','FlowerName','FarmName']);
const intFields=new Set(['WarehouseKey','WarehouseDetailKey','ProdKey','SortOrder']);
const freightScale={ExchangeRate:4,GrossWeight:2,ChargeableWeight:2,FreightRateUSD:4,DocFeeUSD:2,InvoiceTotalUSD:2,BakSangRate:2,HandlingFee:2,QuarantinePerItem:2,DomesticFreight:2,DeductFee:2,ExtraFee:2,SteamQty:2,FOBUSD:4,BoxQty:2,BoxWeightUsed:3,BoxCBMUsed:3,StemsPerBoxUsed:2,StemsPerBunch:2,SalePriceKRW:2,TariffRate:4,FreightPerStemUSD:6,CNF_USD:6,CNF_KRW:4,TariffKRW:2,CustomsPerStem:4,ArrivalPerStem:4,ArrivalPerBunch:2,SalePriceExVAT:2,ProfitPerBunch:2,ProfitRate:6,TotalSaleKRW:2,TotalProfitKRW:2};
function storageFreightRow(record){return Object.fromEntries(Object.entries(record).map(([key,value])=>{if(value==null||freightScale[key]==null)return[key,value];const n=Number(value),scale=10**freightScale[key];if(!Number.isFinite(n))throw error('FREIGHT_NUMBER','운송원가 계산 결과에 유효하지 않은 금액이 있습니다.');return[key,Math.sign(n)*Math.round(Math.abs(n)*scale+Number.EPSILON)/scale];}));}
function freightParams(types,record,fields){return Object.fromEntries(fields.map(k=>[k,p(textFields.has(k)?types.NVarChar:intFields.has(k)?types.Int:types.Float,record[k]??null)]));}

async function writeFreight({q,types,plan,afterReceipt,actor}){
 const h=plan.header,updated=plan.farmOnly?{...h}:{...h,WeightBasis:plan.basis,ExchangeRate:plan.master.exchangeRate,GrossWeight:plan.master.gw,ChargeableWeight:plan.master.cw,FreightRateUSD:plan.master.rateUSD,DocFeeUSD:plan.master.docFeeUSD,InvoiceTotalUSD:plan.master.invoiceUSD,BakSangRate:plan.customs.bakSangRate,HandlingFee:plan.customs.handlingFee,QuarantinePerItem:plan.customs.quarantinePerItem,DomesticFreight:plan.customs.domesticFreight,DeductFee:plan.customs.deductFee,ExtraFee:plan.customs.extraFee};
 const base={actor:p(types.NVarChar,actor),old:p(types.Int,h.FreightKey),wk:p(types.Int,h.WarehouseKey)};
 await q(`UPDATE dbo.FreightCost SET isDeleted=1,UpdateID=@actor,UpdateDtm=GETDATE() WHERE FreightKey=@old AND WarehouseKey=@wk AND isDeleted=0; IF @@ROWCOUNT<>1 THROW 51140,'INCOMING_FREIGHT_STALE',1;`,base);
 const result=rr(await q(`INSERT dbo.FreightCost(${freightHeaderFields.join(',')},CreateID,CreateDtm,isDeleted) OUTPUT INSERTED.FreightKey VALUES(${freightHeaderFields.map(k=>'@'+k).join(',')},@actor,GETDATE(),0)`,{...base,...freightParams(types,storageFreightRow(updated),freightHeaderFields)}));const freightKey=result[0]?.FreightKey;if(!freightKey)throw error('FREIGHT_SAVE','운송원가 저장 결과가 없습니다.');
 const details=plan.farmOnly?plan.details.map(d=>({...d,FarmName:afterReceipt.header.FarmName})):plan.calc.rows.map((r,index)=>{const d=Object.fromEntries(freightDetailFields.map((k,i)=>[k,r[freightCalcKeys[i]]??null]));d.SortOrder=index;d.WarehouseDetailKey=afterReceipt.targetDetails[plan.targets[index]]?.WdetailKey;d.FarmName=afterReceipt.header.FarmName;if(!d.WarehouseDetailKey)throw error('DETAIL_KEY','운송원가 입고 연결키가 없습니다.');return storageFreightRow(d);});
 for(const d of details)await q(`INSERT dbo.FreightCostDetail(FreightKey,${freightDetailFields.join(',')}) VALUES(@fk,${freightDetailFields.map(k=>'@'+k).join(',')})`,{fk:p(types.Int,freightKey),...freightParams(types,d,freightDetailFields)});
 const saved=rr(await q(`SELECT ${freightDetailFields.join(',')} FROM dbo.FreightCostDetail WHERE FreightKey=@fk ORDER BY SortOrder,DetailKey`,{fk:p(types.Int,freightKey)}));
 const canonical=rows=>rows.map(r=>freightDetailFields.map(k=>r[k]??null));if(hash(canonical(saved))!==hash(canonical(details)))throw error('FREIGHT_READBACK','운송원가 저장 검산이 일치하지 않습니다.');
 return {kind:'FREIGHT',beforeKey:h.FreightKey,afterKey:freightKey,beforeTotal:plan.beforeTotal,afterTotal:details.reduce((s,d)=>s+Number(d.ArrivalPerStem??0)*Number(d.SteamQty??0),0),rows:details};
}

async function cloneInvoiceCosts({q,types,plan,document,operation,receiptSnapshot,actor,requestId}){
 const results=[];
 for(const old of plan.costRevisions){
  const id=randomUUID(),snapshot={...json(old.InputSnapshotJson),receiptDigest:operation.result.receiptDigest,receiptSnapshot,saveFingerprint:hash([requestId,old.CostRevisionId,operation.result.receiptDigest]),incomingCorrection:{requestId,priorCostRevisionId:String(old.CostRevisionId)}};
  const cp={id:p(types.UniqueIdentifier,id),old:p(types.UniqueIdentifier,old.CostRevisionId),op:p(types.UniqueIdentifier,operation.operationId),revision:p(types.Int,document.revision),snapshot:p(sqlMax(types),JSON.stringify(snapshot)),actor:p(types.NVarChar,actor)};
  await q(`INSERT dbo.WebInvoiceCostRevision(CostRevisionId,DocumentId,DocumentRevision,OperationId,WarehouseKey,RevisionNo,Basis,Status,Currency,FormulaId,FormulaVersion,FormulaSourceHash,InputSnapshotJson,ApprovedBy,ApprovedAt,CreatedBy,CreatedAt)
   SELECT @id,DocumentId,@revision,@op,WarehouseKey,1,Basis,N'APPROVED',Currency,FormulaId,FormulaVersion,FormulaSourceHash,@snapshot,@actor,SYSUTCDATETIME(),@actor,SYSUTCDATETIME() FROM dbo.WebInvoiceCostRevision WHERE CostRevisionId=@old;
   IF @@ROWCOUNT<>1 THROW 51140,'INCOMING_COST_SOURCE_MISSING',1;`,cp);
  await q(`INSERT dbo.WebInvoiceCostLine(CostRevisionId,LineId,DocumentId,DocumentRevision,OperationId,WarehouseKey,WdetailKey,ProdKey,Unit,Quantity,CostPerUnit,TotalCost,ComponentAmountsJson)
   SELECT @id,LineId,DocumentId,@revision,@op,WarehouseKey,WdetailKey,ProdKey,Unit,Quantity,CostPerUnit,TotalCost,ComponentAmountsJson FROM dbo.WebInvoiceCostLine WHERE CostRevisionId=@old`,cp);
  results.push(id);
 }
 return results;
}

async function writeInvoice({q,types,plan,afterReceipt,actor,requestId,reason}){
 const oldDoc=plan.document,revision=oldDoc.revision+1,operationId=randomUUID();
 const farmRows=rr(await q('SELECT FarmKey FROM dbo.Farm WHERE FarmName=@farm AND isDeleted=0',{farm:p(types.NVarChar,afterReceipt.header.FarmName)}));if(farmRows.length!==1)throw error('FARM','수정 농장이 유일하지 않습니다.');
 const doc={...oldDoc,revision,farmKey:farmRows[0].FarmKey,reviewedMetadata:{...oldDoc.reviewedMetadata,farmName:afterReceipt.header.FarmName,incomingCorrection:{requestId,priorRevision:oldDoc.revision}}};
 const mappings=plan.mappings.map(m=>{const {targetRowIndex,...values}=m;return {...values,wdetailKey:targetRowIndex==null?m.wdetailKey:afterReceipt.targetDetails[targetRowIndex]?.WdetailKey};});
 if(mappings.some(m=>!m.wdetailKey))throw error('DETAIL_KEY','인보이스 입고 연결키가 없습니다.');
 const lines=plan.lines.map(l=>({...l}));
 const mapped=new Set(mappings.map(m=>Number(m.wdetailKey))),unmapped=afterReceipt.details.filter(d=>!mapped.has(Number(d.WdetailKey)));
 const excludedKeys=new Set([...(plan.excludedDetailKeys??[]),...(plan.excludedTargetIndices??[]).map(i=>afterReceipt.targetDetails[i]?.WdetailKey)].map(Number));
 if(unmapped.some(d=>!excludedKeys.has(Number(d.WdetailKey))&&(Number(d.OutQuantity)!==0||Number(d.TPrice)!==0)))throw error('UNMAPPED_DETAIL','원가에 연결되지 않은 양수 입고 행이 남아 있습니다.');
 // Non-grouped receipts require one line per physical historical row as well.
 if(!plan.linkMode)for(const d of unmapped){const oldMapping=plan.operation.result.lineMappings.find(m=>Number(m.wdetailKey)===Number(d.WdetailKey)),source=oldDoc.lines.find(l=>l.lineId===String(oldMapping?.lineId).toLowerCase());if(!source)throw error('ARCHIVE_LINE','보존 입고 행의 원문 연결을 찾을 수 없습니다.');const lineId=stableId([oldDoc.documentId,revision,'zero',d.WdetailKey]);lines.push({...source,lineId,lineNo:lines.length+1,boxQuantity:0,bunchQuantity:0,stemQuantity:0,lineAmount:0});mappings.push({lineId,wdetailKey:d.WdetailKey,prodKey:d.ProdKey,unit:oldMapping.unit,outQuantity:0,boxQuantity:0,bunchQuantity:0,stemQuantity:0,unitPrice:d.UPrice,lineAmount:0});}
 const result={...plan.operation.result,operationId,revision,documentId:doc.documentId,warehouseKey:afterReceipt.header.WarehouseKey,lineMappings:mappings,receiptSnapshot:{header:afterReceipt.header,details:afterReceipt.details},receiptDigest:hash({header:afterReceipt.header,details:afterReceipt.details}),costStatus:plan.costRevisions.length?'APPROVED':'PENDING',incomingCorrection:{requestId,priorOperationId:plan.operation.operationId}};
 if(plan.linkMode){result.linkMode=plan.linkMode;result.excludedDetailKeys=unmapped.map(d=>d.WdetailKey);}
 const operation={...plan.operation,operationId,documentRevision:revision,action:plan.action,result};
 const document={...doc,lines,operations:[operation]};
 const live=await validateLiveReceiptDetails({queryFn:q,types,operation,receiptLines:buildReceiptLines(document,operation),locked:true});if(!live.matches)throw error('LINEAGE_READBACK','정정 인보이스와 입고 수량·금액 연결이 일치하지 않습니다.');
 const bh=businessKeyHash(doc),params={id:p(types.UniqueIdentifier,doc.documentId),revision:p(types.Int,revision),old:p(types.Int,oldDoc.revision),farm:p(types.Int,doc.farmKey),hash:p(types.Binary(32),bh),meta:p(sqlMax(types),JSON.stringify(doc.reviewedMetadata)),actor:p(types.NVarChar,actor),cost:p(types.NVarChar,result.costStatus),op:p(types.UniqueIdentifier,operationId),part:p(types.UniqueIdentifier,plan.operation.receiptPartId),requestHash:p(types.Binary(32),Buffer.from(hash([requestId,oldDoc.documentId,revision]),'hex')),action:p(types.NVarChar,plan.action),wk:p(types.Int,afterReceipt.header.WarehouseKey),result:p(sqlMax(types),JSON.stringify(result)),reason:p(types.NVarChar,reason),before:p(sqlMax(types),JSON.stringify({document:{documentId:oldDoc.documentId,revision:oldDoc.revision,farmKey:oldDoc.farmKey,reviewedMetadata:oldDoc.reviewedMetadata,lines:oldDoc.lines},operation:plan.operation}))};
 await q(`IF @hash IS NOT NULL AND EXISTS(SELECT 1 FROM dbo.WebInvoiceDocument WITH (UPDLOCK,HOLDLOCK) WHERE BusinessKeyHash=@hash AND DocumentId<>@id) THROW 51140,'INCOMING_INVOICE_IDENTITY_CONFLICT',1;
  UPDATE dbo.WebInvoiceDocument SET Revision=@revision,FarmKey=@farm,BusinessKeyHash=@hash,ReviewedMetadataJson=@meta,ReceiptStatus=N'COMMITTED',CostStatus=@cost,UpdatedBy=@actor,UpdatedAt=SYSUTCDATETIME() WHERE DocumentId=@id AND Revision=@old;
  IF @@ROWCOUNT<>1 THROW 51140,'INCOMING_INVOICE_STALE',1;`,params);
 await insertLines(q,types,doc.documentId,revision,lines.map(l=>({...l,sourceEvidenceJson:JSON.stringify(l.sourceEvidence??{}),reviewedJson:JSON.stringify(l.reviewed??{})})));
 await q(`INSERT dbo.WebInvoiceOperation(OperationId,DocumentId,DocumentRevision,ReceiptPartId,RequestHash,Action,Status,WarehouseKey,ResultJson,Actor,CreatedAt,CompletedAt)
  VALUES(@op,@id,@revision,@part,@requestHash,@action,N'COMMITTED',@wk,@result,@actor,SYSUTCDATETIME(),SYSUTCDATETIME());
  UPDATE dbo.WebInvoiceCostRevision SET Status=N'STALE' WHERE DocumentId=@id AND Status=N'APPROVED';
  INSERT dbo.WebInvoiceHistory(DocumentId,Revision,OperationId,Action,BeforeJson,AfterJson,Reason,Actor,CreatedAt)
  VALUES(@id,@revision,@op,N'APPROVE_INCOMING_CORRECTION',@before,@result,@reason,@actor,SYSUTCDATETIME());`,params);
 let costResult=null;
 if(plan.costRevisions.length){
  if(plan.farmOnly)await cloneInvoiceCosts({q,types,plan,document,operation,receiptSnapshot:live.snapshot,actor,requestId});
  else await saveInvoiceCostRevision({withTransactionFn:fn=>fn(q),types,documentId:doc.documentId,revision,actor,input:plan.input,reason});
  costResult=await readInvoiceCosts({queryFn:q,types,warehouseKey:afterReceipt.header.WarehouseKey});
  if(!costResult.currentActual||costResult.currentActual.documentRevision!==revision)throw error('INVOICE_READBACK','정정 승인 원가가 현재 입고와 연결되지 않았습니다.');
  const expected=plan.farmOnly?plan.costLines.filter(l=>plan.costRevisions.some(r=>String(r.CostRevisionId)===String(l.CostRevisionId)&&r.Basis==='ACTUAL')).reduce((s,l)=>s+Number(l.TotalCost??0),0):plan.preview.totals.totalCostKRW;
  if(!close(costResult.currentActual.totalCostKRW,expected))throw error('INVOICE_TOTAL','승인 원가 총액 검산이 일치하지 않습니다.');
 }
 return {kind:'INVOICE',documentId:doc.documentId,beforeRevision:oldDoc.revision,afterRevision:revision,operationId,beforeOperationId:plan.operation.operationId,totalCost:costResult?.currentActual?.totalCostKRW??null,lines:costResult?.currentActual?.lines??[],farmOnly:plan.farmOnly};
}

/** Caller owns the single receipt/distribution/stock/financial transaction. */
export async function writeIncomingApprovalCosts({q,types,plan,beforeReceipt,afterReceipt,actor,requestId}){
 if(plan.issues.length)throw error('REVIEW_REQUIRED',plan.issues.map(i=>i.message).join(' '));
 const evidence=[];
 for(const invoice of plan.invoicePlans)evidence.push(await writeInvoice({q,types,plan:invoice,afterReceipt,actor,requestId,reason:plan.financial.reason}));
 for(const freight of plan.freightPlans)evidence.push(await writeFreight({q,types,plan:freight,afterReceipt,actor}));
 return {evidence,beforeWarehouseKey:beforeReceipt.header.WarehouseKey,warehouseKey:afterReceipt.header.WarehouseKey};
}
