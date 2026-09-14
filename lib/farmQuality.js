export const QUALITY_STATUSES = { NEW:'요청 필요', WAITING:'미답변', ANSWERED:'답변 도착', OBSERVING:'개선 관찰 중', CLOSED:'개선 확인', RECURRED:'재발' };
export const QUALITY_KINDS = { COMMENT:'코멘트', REQUEST:'농장 요청 / 재요청', RESPONSE:'농장 답변', APPLY:'개선 적용', CLOSE:'개선 확인', RECUR:'재발 확인' };
export function qualityScope(input) {
 const year=Number(input.year), from=Number(input.from??1), to=Number(input.to??53);
 if(!Number.isInteger(year)||year<2000||year>2100||!Number.isInteger(from)||!Number.isInteger(to)||from<1||to>53||from>to) throw new Error('연도와 차수 범위를 확인하세요.');
 return {year,from,to};
}
export function qualityWeek(value){const m=String(value??'').match(/^(\d{1,2})(?:-\d{1,2})?$/);return m&&Number(m[1])>=1&&Number(m[1])<=53?Number(m[1]):null;}
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
  if(!groups.has(key))groups.set(key,{key,farmName:farm,prodKey:Number(r.ProdKey),productName:r.ProductName||r.ProdName||String(r.ProdKey),unit,quantity:0,weeks:{},sourceKey:r.DeductionKey});
  const g=groups.get(key);g.quantity+=quantity;g.weeks[week]=(g.weeks[week]||0)+quantity;
 }
 return {groups:[...groups.values()].sort((a,b)=>b.quantity-a.quantity),excluded};
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
