'use strict';
const {previewReports}=require('./mobileExecutiveReportPreview');
// Fictional periods only, never a claim about operational PeriodDay rows.
function monthlyDemoWeeks(year,reportId='weekly-profit') {
  if(String(year)!=='2026'||!['weekly-profit','raum-profit','shilla-profit'].includes(reportId))return [];
  return [
    ['2026-38','2026-09-17','2026-09-23'],
    ['2026-39','2026-09-24','2026-09-30'],
  ].map(([period,startDate,endDate])=>{
    const r=previewReports(period).find(row=>row.id===reportId);
    return {major:period.slice(5),period:{startDate,endDate},totals:{C:r.revenue,I:r.cost,J:r.profit,F:0}};
  });
}
module.exports={monthlyDemoWeeks};
