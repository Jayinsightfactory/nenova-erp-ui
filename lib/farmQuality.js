export const QUALITY_STATUSES = { NEW:'요청 필요', WAITING:'미답변', ANSWERED:'답변 도착', OBSERVING:'개선 관찰 중', CLOSED:'개선 확인', RECURRED:'재발' };
export const QUALITY_KINDS = { COMMENT:'코멘트', REQUEST:'농장 요청 / 재요청', RESPONSE:'농장 답변', APPLY:'개선 적용', CLOSE:'개선 확인', RECUR:'재발 확인' };
export function qualityScope(input) {
 const year=Number(input.year), from=Number(input.from??1), to=Number(input.to??53);
 if(!Number.isInteger(year)||year<2000||year>2100||!Number.isInteger(from)||!Number.isInteger(to)||from<1||to>53||from>to) throw new Error('연도와 차수 범위를 확인하세요.');
 return {year,from,to};
}
export function qualityWeek(value){const m=String(value??'').match(/^(\d{1,2})(?:-\d{1,2})?$/);return m&&Number(m[1])>=1&&Number(m[1])<=53?Number(m[1]):null;}
const matchText=value=>String(value??'').normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('ko-KR');
const rate=(bad,total)=>total>0?bad/total*100:null;
export function qualityGroups(rows, scope){
 const groups=new Map(), seen=new Set();let excluded=0;
 for(const r of rows){
  const week=qualityWeek(r.OrderWeek);
  if(Number(r.OrderYear)!==scope.year||!week||week<scope.from||week>scope.to||seen.has(r.DeductionKey))continue;
  seen.add(r.DeductionKey);
  if(!r.ImportConfirmed||r.IsDeleted||!(Number(r.ProdKey)>0)||!String(r.FarmName||'').trim()){excluded++;continue;}
  const unit=String(r.SourceUnit||'미지정').trim(), quantity=Number(r.OriginalQuantity??r.Quantity);
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
