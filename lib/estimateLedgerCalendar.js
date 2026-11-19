export const ledgerActions={CREATE:'신고 등록',REGISTER_ESTIMATE:'견적 등록',ESTIMATE_UNLINK:'견적 연결 해제',MANAGE_EDIT:'신고 수정',MANUAL_COMPLETE:'수동 완료',CARRYOVER_APPLY:'이월 적용',SUPPORT_HOLD:'보류',SUPPORT_RESUME:'보류 해제'};
export const salesLabels={REG_CONFIRM:'판매등록확정',TUE_FINAL:'최종분배 스냅샷',WED_CHECK:'분배 점검 스냅샷',TUE_CLOSE:'판매등록 마감 스냅샷',CLOSE_CHECK:'마감 점검 스냅샷',CHANGE:'변경 감지 스냅샷',MANUAL:'수동 스냅샷'};
// SQL datetime is a recorded local wall time, not a browser-timezone conversion.
export function recordedDate(value) {
 const s=String(value??''),m=/^(\d{4})-(\d{2})-(\d{2})(?:[T ]|$)/.exec(s);
 if(!m)return null;
 const y=Number(m[1]),month=Number(m[2]),d=Number(m[3]);
 if(y<1900||month<1||month>12||d<1||d>new Date(Date.UTC(y,month,0)).getUTCDate())return null;
 return {day:s.slice(0,10),month:s.slice(0,7),time:s.length>=19?s.slice(11,19):''};
}
export function calendarEvents(data) {
 const events=(data.history||[]).map(h=>({key:`h${h.HistoryKey}`,at:h.ChangedAt,title:ledgerActions[h.ActionType]||h.ActionType,kind:'신고 이력',ref:`이력 #${h.HistoryKey}`,snapshot:h.after||h.before}));
 events.push({key:'current',at:data.source?.UpdatedAt,title:'현재 저장 신고',kind:'현재 값',ref:'최종 수정 기록',snapshot:{orderYear:data.source?.OrderYear,orderWeek:data.source?.OrderWeek,appliedOrderYear:data.source?.AppliedOrderYear,appliedOrderWeek:data.source?.AppliedOrderWeek}});
 for(const s of data.sales?.rows||[])events.push({key:`s${s.SnapshotKey}`,at:s.TakenAt,title:salesLabels[s.SnapshotType]||`판매 이력 ${s.SnapshotType}`,kind:'해당 차수 전체',ref:`${s.OrderYear}년 ${s.OrderWeek}차 · #${s.SnapshotKey}`});
 for(const e of data.downloads?.rows||[]){const upload=e.kind==='UPLOAD_CONFIRMED';events.push({key:`d${e.id}`,at:e.at,title:upload?'업로드일 확인 기록':'견적 엑셀 다운로드 요청',kind:'해당 업체·품목 포함',ref:`${e.year}년 ${e.week}차 · ${upload?`직원 확인 업로드일 ${e.uploadedOn}`:e.fileName||'파일명 미기록'}`});if(upload&&e.uploadedOn)events.push({key:`u${e.id}`,at:e.uploadedOn,title:'이카운트 업로드일 (직원 확인)',kind:'담당자 확인값',ref:`확인 기록 ${e.at}`});}
 return events.map(e=>({...e,date:recordedDate(e.at)})).sort((a,b)=>String(a.at??'').localeCompare(String(b.at??'')));
}
export function calendarWeeks(month) {
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month||''))return [];
 const [y,m]=month.split('-').map(Number),offset=new Date(Date.UTC(y,m-1,1)).getUTCDay(),days=new Date(Date.UTC(y,m,0)).getUTCDate();
 return Array.from({length:Math.ceil((offset+days)/7)},(_,w)=>Array.from({length:7},(_,d)=>{const n=w*7+d-offset+1;return n<1||n>days?null:`${month}-${String(n).padStart(2,'0')}`;}));
}
