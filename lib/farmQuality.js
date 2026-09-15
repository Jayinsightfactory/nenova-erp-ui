export const QUALITY_STATUSES = { NEW:'요청 필요', WAITING:'미답변', ANSWERED:'답변 도착', OBSERVING:'개선 관찰 중', CLOSED:'개선 확인', RECURRED:'재발' };
export const QUALITY_KINDS = { COMMENT:'코멘트', REQUEST:'농장 요청 / 재요청', RESPONSE:'농장 답변', APPLY:'개선 적용', CLOSE:'개선 확인', RECUR:'재발 확인' };
export const QUALITY_SIGNAL_KINDS = {
 SAME_ITEM_WEEK:'동일 품목 반복',
 FARM_WEEK_CLUSTER:'농장 품목 집중',
 ITEM_PERSISTENT:'품목 불량 지속',
 FARM_RECURRING:'농장 불량 반복'
};
export const FARM_QUALITY_DELETE_ADMIN_IDS = Object.freeze(['nenovaSS3']);
export function canDeleteFarmQuality(user){return FARM_QUALITY_DELETE_ADMIN_IDS.includes(String(user?.userId||''));}
export function qualityScope(input) {
 const year=Number(input.year), from=Number(input.from??1), to=Number(input.to??53);
 if(!Number.isInteger(year)||year<2000||year>2100||!Number.isInteger(from)||!Number.isInteger(to)||from<1||to>53||from>to) throw new Error('연도와 차수 범위를 확인하세요.');
 return {year,from,to};
}
export function qualityWeek(value){const m=String(value??'').match(/^(\d{1,2})(?:-\d{1,2})?$/);return m&&Number(m[1])>=1&&Number(m[1])<=53?Number(m[1]):null;}
const matchText=value=>String(value??'').normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('ko-KR');
const rate=(bad,total)=>total>0?bad/total*100:null;
const sourceQuantity=row=>Number(row.OriginalQuantity??row.Quantity);
const sourceDeleted=row=>row?.IsDeleted===true||Number(row?.IsDeleted)===1;
const snapshotName=(value,fallback)=>String(value??'').normalize('NFKC').trim().replace(/\s+/g,' ')||fallback;

// This is intentionally broader than qualityGroups/qualitySignals.  Those
// projections retain their confirmed-and-complete eligibility rule, while the
// coverage view explains every selected-year source row that did not reach it.
export function qualitySourceCoverage(rows,scope){
 // `total` stays UI-friendly: it is the default visible list (in-range plus
 // malformed/unknown weeks).  The explicit source/active totals are the
 // conservation contract; do not use `total` as a raw-source denominator.
 const coverage={rows:[],total:0,defaultViewCount:0,sourceTotal:0,activeTotal:0,inRangeCount:0,eligibleCount:0,incompleteCount:0,deletedCount:0,outOfRangeCount:0,invalidWeekCount:0,outOfYearCount:0,duplicateCount:0};
 const seen=new Set();
 for(const [index,row] of (rows||[]).entries()){
  const numericSourceKey=Number(row?.DeductionKey);
  // DeductionKey is the source PK.  Keep malformed fixture input distinct so a
  // missing key cannot hide another source row while diagnosing coverage.
  // Match qualityGroups' scope order: a prior-year row that happens to reuse a
  // fixture key must not consume the selected-year source identity.
  if(Number(row?.OrderYear)!==scope.year){coverage.outOfYearCount++;continue;}
  const sourceIdentity=Number.isFinite(numericSourceKey)&&numericSourceKey>0?`key:${numericSourceKey}`:`invalid:${index}`;
  if(seen.has(sourceIdentity)){coverage.duplicateCount++;continue;}
  seen.add(sourceIdentity);
  coverage.sourceTotal++;
  const week=qualityWeek(row?.OrderWeek);
  const deleted=sourceDeleted(row);
  const quantity=sourceQuantity(row);
  if(deleted){coverage.deletedCount++;continue;}
  coverage.activeTotal++;
  let rangeStatus;
  if(week==null){rangeStatus='UNKNOWN_WEEK';coverage.invalidWeekCount++;}
  else if(week<scope.from||week>scope.to){rangeStatus='OUT_OF_RANGE';coverage.outOfRangeCount++;}
  else {rangeStatus='IN_RANGE';coverage.inRangeCount++;}
  const reasons=[];
  let eligible=false;
  if(rangeStatus==='OUT_OF_RANGE')reasons.push('선택 기간 밖');
  else {
   if(rangeStatus==='UNKNOWN_WEEK')reasons.push('차수 형식 확인 필요');
   if(!row?.ImportConfirmed)reasons.push('수입부 확인 미완료');
   if(!(Number(row?.ProdKey)>0))reasons.push('품목 미지정');
   if(!snapshotName(row?.FarmName,''))reasons.push('농장 미지정');
   if(!Number.isFinite(quantity)||quantity<=0)reasons.push('수량이 0 이하이거나 확인 필요');
   eligible=rangeStatus==='IN_RANGE'&&reasons.length===0;
   if(eligible)coverage.eligibleCount++;else coverage.incompleteCount++;
  }
  coverage.rows.push({
   sourceKey:Number.isFinite(numericSourceKey)?numericSourceKey:null,
   orderYear:Number(row?.OrderYear),
   orderWeek:snapshotName(row?.OrderWeek,'차수 미상'),
   prodKey:Number(row?.ProdKey)>0?Number(row.ProdKey):null,
   productName:snapshotName(row?.ProductName??row?.ProdName,Number(row?.ProdKey)>0?String(Number(row.ProdKey)):'품목 미지정'),
   farmName:snapshotName(row?.FarmName,'농장 미지정'),
   customerName:snapshotName(row?.CustName??row?.CustomerName,'업체 미지정'),
   quantity:Number.isFinite(quantity)?quantity:null,
   unit:snapshotName(row?.SourceUnit,'미지정'),
   rangeStatus,
   eligible,
   reasons,
  });
 }
 coverage.defaultViewCount=coverage.inRangeCount+coverage.invalidWeekCount;
 coverage.total=coverage.defaultViewCount;
 return coverage;
}
const occurrenceFacts=(rows,scope)=>{
 const facts=[],seen=new Set();
 for(const row of rows||[]){
  const week=qualityWeek(row.OrderWeek),sourceKey=Number(row.DeductionKey),prodKey=Number(row.ProdKey),farmName=String(row.FarmName||'').trim(),quantity=sourceQuantity(row);
  if(Number(row.OrderYear)!==scope.year||!week||week<scope.from||week>scope.to||seen.has(sourceKey))continue;
  seen.add(sourceKey);
  if(!row.ImportConfirmed||row.IsDeleted||!(prodKey>0)||!farmName||!Number.isFinite(quantity)||quantity<=0)continue;
  const unit=String(row.SourceUnit||'미지정').trim()||'미지정';
  facts.push({sourceKey,week,orderWeek:String(row.OrderWeek),prodKey,productName:row.ProductName||row.ProdName||String(prodKey),farmName,farmIdentity:Number(row.FarmKey)>0?`key:${Number(row.FarmKey)}`:`name:${matchText(farmName)}`,unit,unitIdentity:matchText(unit),quantity,customerIdentity:Number(row.CustKey)>0?`key:${Number(row.CustKey)}`:'',customerName:snapshotName(row.CustName??row.CustomerName,'업체 미지정')});
 }
 return facts;
};
const grouped=(facts,keyOf)=>{const map=new Map();for(const fact of facts){const key=JSON.stringify(keyOf(fact));if(!map.has(key))map.set(key,[]);map.get(key).push(fact);}return [...map.values()];};
const unique=values=>[...new Set(values)];
const signalCustomers=items=>grouped(items,item=>item.customerName).map(customerItems=>({customerName:customerItems[0].customerName,count:customerItems.length,quantity:customerItems.reduce((sum,item)=>sum+item.quantity,0),unit:customerItems[0].unit})).sort((a,b)=>b.count-a.count||b.quantity-a.quantity||a.customerName.localeCompare(b.customerName,'ko'));
const signalBreakdown=facts=>grouped(facts,f=>[f.week,f.prodKey]).map(items=>({week:items[0].week,orderWeeks:unique(items.map(i=>i.orderWeek)).sort(),prodKey:items[0].prodKey,productName:items[0].productName,count:items.length,quantity:items.reduce((sum,i)=>sum+i.quantity,0),unit:items[0].unit,customers:signalCustomers(items)})).sort((a,b)=>b.week-a.week||b.count-a.count||a.productName.localeCompare(b.productName,'ko'));
const recurring=weeks=>weeks.some((week,index)=>index>0&&week-weeks[index-1]===1)||weeks.some((week,index)=>index>=2&&week-weeks[index-2]<=3);
const signal=(kind,facts,extra={})=>{
 const weeks=unique(facts.map(f=>f.week)).sort((a,b)=>a-b),products=unique(facts.map(f=>f.prodKey));
 return {kind,kindLabel:QUALITY_SIGNAL_KINDS[kind],farmName:facts[0].farmName,productName:products.length===1?facts[0].productName:`${products.length}개 품목`,unit:facts[0].unit,sourceCount:facts.length,productCount:products.length,weekCount:weeks.length,quantity:facts.reduce((sum,f)=>sum+f.quantity,0),firstWeek:weeks[0],lastWeek:weeks.at(-1),weeks,sourceKey:facts[0].sourceKey,sourceKeys:unique(facts.map(f=>f.sourceKey)),breakdown:signalBreakdown(facts),...extra};
};
export function qualitySignals(rows,scope){
 const facts=occurrenceFacts(rows,scope),signals=[];
 for(const items of grouped(facts,f=>[f.week,f.farmIdentity,f.prodKey,f.unitIdentity])){
  if(unique(items.map(i=>i.customerIdentity).filter(Boolean)).length<2)continue;
  const value=signal('SAME_ITEM_WEEK',items,{prodKey:items[0].prodKey,productName:items[0].productName});
  value.key=`${scope.year}|${value.kind}|${value.lastWeek}|${items[0].farmIdentity}|${value.prodKey}|${items[0].unitIdentity}`;signals.push(value);
 }
 for(const items of grouped(facts,f=>[f.week,f.farmIdentity,f.unitIdentity])){
  if(unique(items.map(i=>i.prodKey)).length<2)continue;
  const value=signal('FARM_WEEK_CLUSTER',items);value.key=`${scope.year}|${value.kind}|${value.lastWeek}|${items[0].farmIdentity}|${items[0].unitIdentity}`;signals.push(value);
 }
 for(const items of grouped(facts,f=>[f.farmIdentity,f.prodKey,f.unitIdentity])){
  const weeks=unique(items.map(i=>i.week)).sort((a,b)=>a-b);if(weeks.length<2||!recurring(weeks))continue;
  const value=signal('ITEM_PERSISTENT',items,{prodKey:items[0].prodKey,productName:items[0].productName});value.key=`${scope.year}|${value.kind}|${items[0].farmIdentity}|${value.prodKey}|${items[0].unitIdentity}`;signals.push(value);
 }
 for(const items of grouped(facts,f=>[f.farmIdentity,f.unitIdentity])){
  const weeks=unique(items.map(i=>i.week)).sort((a,b)=>a-b);if(weeks.length<2||unique(items.map(i=>i.prodKey)).length<2||!recurring(weeks))continue;
  const value=signal('FARM_RECURRING',items);value.key=`${scope.year}|${value.kind}|${items[0].farmIdentity}|${items[0].unitIdentity}`;signals.push(value);
 }
 signals.sort((a,b)=>b.lastWeek-a.lastWeek||b.sourceCount-a.sourceCount||b.quantity-a.quantity||a.farmName.localeCompare(b.farmName,'ko'));
 return signals;
}
export function qualityGroups(rows, scope){
 const groups=new Map(), seen=new Set();let excluded=0;
 for(const r of rows){
  const week=qualityWeek(r.OrderWeek);
  if(Number(r.OrderYear)!==scope.year||!week||week<scope.from||week>scope.to||seen.has(r.DeductionKey))continue;
  seen.add(r.DeductionKey);
  if(!r.ImportConfirmed||r.IsDeleted||!(Number(r.ProdKey)>0)||!String(r.FarmName||'').trim()){excluded++;continue;}
  const unit=String(r.SourceUnit||'미지정').trim(), quantity=sourceQuantity(r);
  if(!Number.isFinite(quantity)||quantity<=0){excluded++;continue;}
  const farm=String(r.FarmName).trim(), key=JSON.stringify([farm,Number(r.ProdKey),unit]);
  if(!groups.has(key))groups.set(key,{key,farmName:farm,prodKey:Number(r.ProdKey),productName:r.ProductName||r.ProdName||String(r.ProdKey),unit,quantity:0,weeks:{},sourceKeysByWeek:{},sourceKey:r.DeductionKey});
  const g=groups.get(key);g.quantity+=quantity;g.weeks[week]=(g.weeks[week]||0)+quantity;
  (g.sourceKeysByWeek[week]??=[]).push(Number(r.DeductionKey));
 }
 return {groups:[...groups.values()].sort((a,b)=>b.quantity-a.quantity),excluded};
}
export function qualityAnalytics(groups,incomingRows,scope){
 const farmIncoming=new Map(),productIncoming=new Map(),farmBad=new Map(),farmMeta=new Map();
 for(const row of incomingRows||[]){
  const week=qualityWeek(row.OrderWeek),farm=String(row.FarmName||'').trim(),unit=String(row.SourceUnit||'미지정').trim(),prodKey=Number(row.ProdKey),quantity=Number(row.IncomingQuantity);
  if(Number(row.OrderYear)!==scope.year||!week||week<scope.from||week>scope.to||!farm||!(prodKey>0)||!(quantity>0))continue;
  const farmKey=JSON.stringify([matchText(farm),matchText(unit),week]);
  const productKey=JSON.stringify([matchText(farm),prodKey,matchText(unit),week]);
  farmIncoming.set(farmKey,(farmIncoming.get(farmKey)||0)+quantity);
  productIncoming.set(productKey,(productIncoming.get(productKey)||0)+quantity);
 }
 for(const g of groups||[]){
  const farmUnit=JSON.stringify([matchText(g.farmName),matchText(g.unit)]);farmMeta.set(farmUnit,{farmName:g.farmName,unit:g.unit});
  for(const [rawWeek,rawQuantity] of Object.entries(g.weeks||{})){
   const week=Number(rawWeek),quantity=Number(rawQuantity)||0,key=JSON.stringify([matchText(g.farmName),matchText(g.unit),week]);
   farmBad.set(key,(farmBad.get(key)||0)+quantity);
  }
 }
 const farmTrends=[];
 for(const [farmUnit,meta] of farmMeta){
  const points=[];
  for(let week=scope.from;week<=scope.to;week++){
   const key=JSON.stringify([matchText(meta.farmName),matchText(meta.unit),week]);
   const defectQuantity=farmBad.get(key)||0,incomingQuantity=farmIncoming.get(key)||0;
   if(defectQuantity>0||incomingQuantity>0)points.push({week,defectQuantity,incomingQuantity,defectRate:rate(defectQuantity,incomingQuantity)});
  }
  const totalDefect=points.reduce((sum,p)=>sum+p.defectQuantity,0),totalIncoming=points.reduce((sum,p)=>sum+p.incomingQuantity,0);
  farmTrends.push({...meta,totalDefect,totalIncoming,defectRate:rate(totalDefect,totalIncoming),points});
 }
 farmTrends.sort((a,b)=>(b.defectRate??-1)-(a.defectRate??-1)||b.totalDefect-a.totalDefect||a.farmName.localeCompare(b.farmName,'ko'));
 const issueCandidates=[];
 for(const g of groups||[])for(const [rawWeek,rawQuantity] of Object.entries(g.weeks||{})){
  const week=Number(rawWeek),defectQuantity=Number(rawQuantity)||0;
  if(!(defectQuantity>0))continue;
  const key=JSON.stringify([matchText(g.farmName),Number(g.prodKey),matchText(g.unit),week]),incomingQuantity=productIncoming.get(key)||0;
  issueCandidates.push({key:`${g.key}:${week}`,farmName:g.farmName,prodKey:g.prodKey,productName:g.productName,unit:g.unit,week,defectQuantity,incomingQuantity,defectRate:rate(defectQuantity,incomingQuantity),sourceKey:g.sourceKeysByWeek?.[week]?.[0]??g.sourceKey,sourceKeys:g.sourceKeysByWeek?.[week]||[g.sourceKey]});
 }
 issueCandidates.sort((a,b)=>b.week-a.week||(b.defectRate??-1)-(a.defectRate??-1)||b.defectQuantity-a.defectQuantity||a.productName.localeCompare(b.productName,'ko'));
 return {farmTrends,issueCandidates};
}
export function qualityStatus(item, today=new Date().toISOString().slice(0,10)) {return item.Status==='WAITING'&&item.DueDate&&String(item.DueDate).slice(0,10)<today?'OVERDUE':item.Status;}
export function transitionQuality(current,kind,incoming){
 if(!QUALITY_KINDS[kind])throw new Error('작업 종류를 확인하세요.');
 if(kind==='COMMENT')return current;
 if(!incoming)throw new Error('농장 요청·답변 및 개선 상태 기록은 수입부 권한이 필요합니다.');
 if(kind==='REQUEST')return 'WAITING';
 if(kind==='RESPONSE'){if(current!=='WAITING')throw new Error('답변 대기 중인 요청에 답변을 기록하세요.');return 'ANSWERED';}
 if(kind==='APPLY'){if(current!=='ANSWERED')throw new Error('농장 답변 확인 후 적용 차수를 지정하세요.');return 'OBSERVING';}
 if(kind==='CLOSE'){if(current!=='OBSERVING')throw new Error('개선 관찰 후 확인을 완료하세요.');return 'CLOSED';}
 if(kind==='RECUR'){if(!['OBSERVING','CLOSED','ANSWERED'].includes(current))throw new Error('개선 답변 이후 재발을 기록하세요.');return 'RECURRED';}
 return current;
}
