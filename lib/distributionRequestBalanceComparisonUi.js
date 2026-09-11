const EVIDENCE_STATUSES=new Set(['CONSISTENT','PARTIAL','MISMATCH','UNCONFIRMED','AMBIGUOUS']);
const SNAPSHOT_STATUSES=new Set(['AVAILABLE','UNKNOWN','AMBIGUOUS']);

function finiteOrNull(value) {
  return typeof value==='number'&&Number.isFinite(value)?value:null;
}

function numberOrNull(value) {
  return value===null||finiteOrNull(value)!==null;
}

function isValidBalanceComparison(value) {
  if(value===undefined)return true;
  if(!value||typeof value!=='object'||!Array.isArray(value.products))return false;
  return value.products.every(product=>product&&Number.isInteger(product.prodKey)&&product.prodKey>0&&typeof product.prodName==='string'&&typeof product.unit==='string'&&EVIDENCE_STATUSES.has(product.evidenceStatus)&&SNAPSHOT_STATUSES.has(product.snapshotStatus)&&Array.isArray(product.sourceIdentities)&&product.sourceIdentities.every(identity=>typeof identity==='string')&&numberOrNull(product.requestedSignedDelta)&&numberOrNull(product.observedSignedDelta)&&numberOrNull(product.actualDistributionTotal)&&numberOrNull(product.storedStockSnapshot)&&(product.requests===undefined||Array.isArray(product.requests)&&product.requests.every(request=>request&&Object.prototype.hasOwnProperty.call(request,'requestId')&&(typeof request.requestId==='string'||request.requestId===null)&&(typeof request.sourceIdentity==='string'||request.sourceIdentity===null)&&(Number.isInteger(request.custKey)&&request.custKey>0||request.custKey===null)&&request.prodKey===product.prodKey&&numberOrNull(request.requestedSignedDelta)&&numberOrNull(request.observedSignedDelta)&&EVIDENCE_STATUSES.has(request.evidenceStatus)&&Array.isArray(request.reasonCodes)&&request.reasonCodes.every(code=>typeof code==='string'))));
}

function isException(product) {
  return product?.evidenceStatus!=='CONSISTENT'||product?.snapshotStatus!=='AVAILABLE'||finiteOrNull(product?.actualDistributionTotal)===null||(product?.reasonCodes||[]).includes('INVALID_DISTRIBUTION_TOTAL');
}

function comparisonForIdentity(comparison,identity,{includeConsistent=false}={}) {
  const requests=Array.isArray(comparison?.products)?comparison.products.flatMap(product=>(product.requests||[]).filter(request=>request.sourceIdentity===identity).map(request=>({...product,...request,snapshotStatus:product.snapshotStatus,storedStockSnapshot:product.storedStockSnapshot,actualDistributionTotal:product.actualDistributionTotal,expectedBalanceImpact:finiteOrNull(request.requestedSignedDelta)===null?null:-request.requestedSignedDelta,snapshotSource:product.snapshotSource,productReasonCodes:product.reasonCodes}))):[];
  const visible=includeConsistent?requests:requests.filter(isException);
  return {visible,hiddenConsistentCount:requests.length-visible.length,totalCount:requests.length};
}

function shouldHideConsistentIdentity(comparison,identity,liveItem) {
  if(liveItem?.status==='AMBIGUOUS')return false;
  const requests=comparisonForIdentity(comparison,identity,{includeConsistent:true});
  const liveRequests=Array.isArray(liveItem?.requests)?liveItem.requests:[];
  const liveIds=liveRequests.map(request=>typeof request?.id==='string'&&request.id?request.id:null);
  const comparisonIds=requests.visible.map(request=>typeof request.requestId==='string'&&request.requestId?request.requestId:null);
  if(!requests.totalCount||liveIds.length!==requests.totalCount||liveIds.some(id=>id===null)||comparisonIds.some(id=>id===null)||new Set(liveIds).size!==liveIds.length||new Set(comparisonIds).size!==comparisonIds.length)return false;
  const comparisonIdSet=new Set(comparisonIds);
  return liveIds.every(id=>comparisonIdSet.has(id))&&requests.visible.every(request=>!isException(request));
}

function signedDelta(value) {
  const number=finiteOrNull(value);
  if(number===null)return '미확인';
  return `${number>0?'+':''}${number}`;
}

function differenceDelta(product) {
  const requested=finiteOrNull(product?.requestedSignedDelta),observed=finiteOrNull(product?.observedSignedDelta);
  return requested===null||observed===null?null:requested-observed;
}

function evidenceLabel(status) {
  return {CONSISTENT:'근거 일치',PARTIAL:'일부 이력',MISMATCH:'변화량 불일치',UNCONFIRMED:'분배 이력 미확인',AMBIGUOUS:'확인 필요'}[status]||'확인 필요';
}

function reasonLabel(code) {
  const key=String(code||'').split(':')[0];
  return {PARSER_AMBIGUOUS:'원문 해석 확인 필요',REQUEST_SCOPE_MISMATCH:'요청 기간 확인 필요',REQUEST_IDENTITY_UNKNOWN:'고객·품목 확인 필요',REQUEST_QUANTITY_UNKNOWN:'요청 수량 확인 필요',UNIT_UNKNOWN:'단위 확인 필요',AMBIGUOUS_DISTRIBUTION_UNIT:'분배 단위 확인 필요',AMBIGUOUS_STOCK_MASTER_SCOPE:'같은 차수 재고 원장 중복 확인',SOURCE_TIME_APPROXIMATE:'원문 시각 확인 필요',SOURCE_TIME_MISSING:'원문 시각 확인 필요',DATA_TRUNCATED:'조회 범위가 잘려 근거 확인 필요',MULTI_DATE_SHIPMENT:'여러 출고일 이력 확인 필요',DUPLICATE_REQUEST_ID:'중복 요청 식별값 확인 필요',MULTIPLE_SHIPMENT_EVENTS:'여러 출고 이력 확인 필요',NO_SHIPMENT_HISTORY:'분배 이력 미확인',COMPETING_SHIPMENT_EVENT:'다른 요청과 겹친 출고 이력 확인 필요',PARTIAL_SHIPMENT_HISTORY:'일부 분배 이력만 확인됨',SHIPMENT_DELTA_MISMATCH:'요청과 분배 변화량이 다름',STOCK_SNAPSHOT_MISSING:'전산 저장 잔량 미확인',DUPLICATE_STOCK_SNAPSHOT:'전산 저장 잔량이 여러 건입니다',INVALID_STOCK_SNAPSHOT:'전산 저장 잔량 확인 필요',INVALID_DISTRIBUTION_TOTAL:'전체 품목 분배 합계 확인 필요'}[key]||'근거 확인 필요';
}

module.exports={comparisonForIdentity,differenceDelta,evidenceLabel,isException,isValidBalanceComparison,reasonLabel,signedDelta,shouldHideConsistentIdentity};
