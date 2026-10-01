import { buildEstimateHtml } from './estimatePrintHtml.js';
import { normalizeWeekdayPrintRequest, validateWeekdayPrintDates } from './weekdayEstimatePrint.js';

// Pure request planning. A selected day is always its own read-only API scope.
export function buildWeekdayPrintRequests({ cycle, dates, mode, custKey }) {
  if(cycle?.calendarState!=='FOUND') throw new Error('출력할 전산 업무 주기를 확인하세요.');
  const scope=normalizeWeekdayPrintRequest({year:cycle.year,majorWeek:cycle.majorWeek,custKey,mode,dates});
  validateWeekdayPrintDates(scope,[{...cycle,offset:0}]);
  return mode==='dates' ? scope.dates.map(date=>({...scope,dates:[date]})) : [scope];
}

export function validateWeekdayPrintResponse(request, result) {
  const scope=result?.scope;
  if(result?.success!==true || result.readOnly!==true || result.draftIncluded!==false
    || Number(scope?.year)!==request.year || scope?.majorWeek!==request.majorWeek
    || scope?.orderYearWeek!==request.orderYearWeek || Number(scope?.custKey)!==request.custKey
    || scope?.mode!==request.mode || JSON.stringify(scope?.dates)!==JSON.stringify(request.dates)
    || Number(result?.customer?.CustKey)!==request.custKey || typeof result?.customer?.CustName!=='string'
    || !result.customer.CustName.trim() || !Array.isArray(result.items)) throw new Error('견적 응답의 거래처·연도·차수·날짜 범위가 요청과 다릅니다. 전체 출력 미리보기를 취소했습니다.');
  if(result.items.some(row=>!row || ['Quantity','Cost','Amount','Vat'].some(field=>typeof row[field]!=='number' || !Number.isFinite(row[field])))) throw new Error('견적 수량·금액 응답이 불완전합니다. 전체 출력 미리보기를 취소했습니다.');
  return result;
}

const labelFor=request=>`${request.majorWeek}차 ${request.mode==='major'?'전체 견적':request.dates.join(' · ')} · 전산 확정본`;

// Extract only our shared builder's controlled HTML, never server-provided markup.
function generatedParts(html) {
  const match=html.match(/^<!DOCTYPE html>\s*<html lang="ko"><head>([\s\S]*?)<\/head><body>([\s\S]*?)<\/body><\/html>$/);
  if(!match) throw new Error('공통 견적 HTML 구조를 확인할 수 없습니다.');
  return {head:match[1],body:match[2]};
}

export function buildWeekdayEstimatePrintBundle({ requests, results, printDate, logoDataUrl='' }) {
  if(!Array.isArray(requests) || !requests.length || requests.length>7 || !Array.isArray(results) || results.length!==requests.length) throw new Error('모든 선택 요일의 견적 응답을 확인해야 합니다.');
  const first=requests[0];
  for(const request of requests) {
    const canonical=normalizeWeekdayPrintRequest(request);
    if(request.year!==canonical.year || request.majorWeek!==canonical.majorWeek || request.orderYearWeek!==canonical.orderYearWeek
      || request.custKey!==canonical.custKey || JSON.stringify(request.dates)!==JSON.stringify(canonical.dates)) throw new Error('출력 요청 범위가 정규 전산 날짜와 다릅니다.');
  }
  if(requests.some(request=>request.year!==first.year || request.majorWeek!==first.majorWeek || request.custKey!==first.custKey
    || request.mode!==first.mode || request.orderYearWeek!==first.orderYearWeek
    || (request.mode==='dates' ? request.dates.length!==1 : requests.length!==1 || request.dates.length!==0))) throw new Error('요일별 견적 업무 범위가 다릅니다.');
  if(first.mode==='dates' && new Set(requests.map(request=>request.dates[0])).size!==requests.length) throw new Error('동일 날짜의 견적을 중복 생성하지 않습니다.');
  const checked=results.map((result,index)=>validateWeekdayPrintResponse(requests[index],result));
  if(checked.some(result=>result.customer.CustName!==checked[0].customer.CustName)) throw new Error('조회 도중 거래처 표시값이 변경됐습니다. 다시 조회하세요.');
  const emptyDates=[], documents=[];
  checked.forEach((result,index)=>{
    const request=requests[index];
    if(!result.items.length) {emptyDates.push(request.mode==='major'?'전체 차수':request.dates[0]);return;}
    documents.push({date:request.dates[0] || null,html:buildEstimateHtml({bigoLabel:labelFor(request),custName:result.customer.CustName,printDate,rows:result.items,logoDataUrl})});
  });
  const emptyMessage=emptyDates.length?`${emptyDates.join(' · ')}: 확정 견적 자료 없음 (해당 문서는 생성하지 않음)`:'';
  let html=documents[0]?.html || '';
  if(requests.length>1 && documents.length) {
    const parts=documents.map(document=>({...generatedParts(document.html),date:document.date}));
    const sections=parts.map(part=>`<section class="weekday-print-page" data-print-date="${part.date}">${part.body}</section>`).join('\n');
    html=`<!DOCTYPE html>\n<html lang="ko"><head>${parts[0].head}<style>
body { padding:0; }
.weekday-print-page { padding:10mm 15mm; }
@media print {
  body { padding:0; }
  .weekday-print-page { padding:10mm 15mm; break-before:page; page-break-before:always; }
  .weekday-print-page:first-child { break-before:auto; page-break-before:auto; }
}
</style></head><body>${sections}</body></html>`;
  }
  return {html,label:first.mode==='major'?labelFor(first):`${first.majorWeek}차 ${requests.flatMap(request=>request.dates).join(' · ')} · 전산 확정본`,
    count:checked.reduce((sum,result)=>sum+result.items.length,0),documentCount:documents.length,emptyDates,
    note:[...new Set(checked.map(result=>result.note).filter(Boolean)),emptyMessage].filter(Boolean).join(' · ')};
}
