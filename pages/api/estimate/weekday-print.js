import { query,sql } from '../../../lib/db.js';
import { withAuth } from '../../../lib/auth.js';
import { buildShippingCycles } from '../../../lib/weekdayEstimateCycle.js';
import { normalizeWeekdayPrintRequest,validateWeekdayPrintDates,mapWeekdayPrintRow } from '../../../lib/weekdayEstimatePrint.js';
import { sqlEstimateGetPrintDetail } from '../../../lib/exeEstimateViewSql.js';

export default withAuth(async function handler(req,res) {
  if(req.method!=='POST') { res.setHeader('Allow','POST'); return res.status(405).end(); }
  let scope;
  try {scope=normalizeWeekdayPrintRequest(req.body);} catch(error) {return res.status(400).json({success:false,error:error.message});}
  try {
    if(scope.mode==='dates') {
      const calendar=await query(`WITH anchor AS (SELECT BaseYmd FROM PeriodDay WHERE OrderYearWeek=@yearWeek AND WeekDay=5)
        SELECT pd.OrderYearWeek,pd.WeekDay,CONVERT(nvarchar(23),pd.BaseYmd,121) BaseYmd FROM PeriodDay pd
        WHERE EXISTS(SELECT 1 FROM anchor a WHERE pd.BaseYmd>=DATEADD(day,-7,a.BaseYmd) AND pd.BaseYmd<DATEADD(day,14,a.BaseYmd))`,
        {yearWeek:{type:sql.NVarChar(6),value:scope.orderYearWeek}});
      try {validateWeekdayPrintDates(scope,buildShippingCycles(calendar.recordset,scope));}
      catch(error) {return res.status(409).json({success:false,error:error.message});}
    }
    const customer=await query('SELECT CustKey,CustName FROM Customer WHERE CustKey=@custKey AND ISNULL(isDeleted,0)=0',
      {custKey:{type:sql.Int,value:scope.custKey}});
    if(customer.recordset.length!==1) return res.status(404).json({success:false,error:'활성 거래처를 찾을 수 없습니다.'});
    const params={year:{type:sql.Int,value:scope.year},orderYearWeek:{type:sql.NVarChar(6),value:scope.orderYearWeek},custKey:{type:sql.Int,value:scope.custKey}};
    scope.dates.forEach((date,i)=>{params[`printDate${i}`]={type:sql.NVarChar(10),value:date};});
    const result=await query(sqlEstimateGetPrintDetail({orderYearWeek:scope.orderYearWeek,custKey:scope.custKey,weekDayIn:'1,2,3,4,5,6,7',dateFilterCount:scope.dates.length,enforceYear:true}),params);
    res.setHeader('Cache-Control','no-store');
    return res.status(200).json({success:true,readOnly:true,scope,customer:customer.recordset[0],items:result.recordset.map(mapWeekdayPrintRow),
      note:scope.mode==='major'?'대차수 전체 확정 견적 · 날짜 범위 밖 출고와 모든 등록 차감 포함':'선택 실제 날짜의 확정 견적 · 해당 날짜에 등록된 차감만 포함 · 날짜 미배정 차감은 대차수 전체에서 확인',draftIncluded:false});
  } catch(error) { console.error('[weekday-print]',error); return res.status(500).json({success:false,error:'견적 출력 자료를 조회하지 못했습니다.'}); }
});
