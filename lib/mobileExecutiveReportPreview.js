'use strict';
const {weeklyDemo}=require('./mobileWeeklyDemo');
// Design fixtures only. Never replace these with ERP data in the client bundle.
const PERIODS = [
  {id:'2026-39', label:'2026년 39차', range:'9월 21일 – 9월 27일'},
  {id:'2026-38', label:'2026년 38차', range:'9월 14일 – 9월 20일'},
  {id:'2025-39', label:'2025년 39차', range:'보관 자료 없음'},
];
function canPreview(query, user) {
  return query?.preview === '1' && typeof user?.userId === 'string' && !!user.userId.trim() && user.accountActive !== false;
}
function previewReports(period, expanded = false) {
  if (!['2026-39','2026-38'].includes(period)) return [];
  const base = [
    {id:'weekly-profit', title:'주차별 매출·이익', category:'매출·이익', description:'전체 매출과 비용, 이익을 한눈에', format:'보고서 · XLSX', badge:'수정본', revenue:124800000, cost:101000000, profit:23800000},
    {id:'raum-profit', title:'라움 순익계산서', category:'호텔', description:'라움 매입·매출 및 순이익 정리', format:'보고서 · XLSX', badge:'마감 완료', revenue:32400000, cost:26100000, profit:6300000},
    {id:'shilla-profit', title:'신라 순익계산서', category:'호텔', description:'신라 입고 손익과 순이익 정리', format:'보고서 · XLSX', badge:'마감 완료', revenue:21800000, cost:17400000, profit:4400000},
  ].map(row=>({...row,...(row.id==='weekly-profit'?weeklyDemo(period):{}), period, updated:period==='2026-39'?'09.28 10:30':'09.21 10:30', sample:true}));
  if (expanded) for (let i=4;i<=10;i++) base.push({id:`planned-${i}`,title:`추가 보고서 ${String(i).padStart(2,'0')}`,category:'기타',description:'추가될 보고서의 자리입니다.',format:i%2?'XLSX':'보고서',badge:'추가 예정',planned:true,period,sample:true});
  return base;
}
function filterReports(rows, category, search) {
  const token = String(search || '').trim().toLocaleLowerCase('ko-KR');
  return rows.filter(row=>(category==='전체'||row.category===category)&&`${row.title} ${row.description}`.toLocaleLowerCase('ko-KR').includes(token));
}
module.exports = {PERIODS,canPreview,previewReports,filterReports};
