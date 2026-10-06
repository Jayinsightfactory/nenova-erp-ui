import { withTransaction,sql } from '../../../lib/db.js';
import { withAuth } from '../../../lib/auth.js';
import { normalizeWeekdayPrintRequest,readWeekdayPrintInTransaction } from '../../../lib/weekdayEstimatePrint.js';

export default withAuth(async function handler(req,res) {
  if(req.method!=='POST') { res.setHeader('Allow','POST'); return res.status(405).end(); }
  let scope;
  try {scope=normalizeWeekdayPrintRequest(req.body);} catch(error) {return res.status(400).json({success:false,error:error.message});}
  try {
    // All reads, including the EXE quote, share one serializable read transaction.
    // This prevents a shipment becoming unfixed/changed after preflight but before print.
    const printed=await withTransaction(tQuery=>readWeekdayPrintInTransaction(scope,tQuery,sql));
    res.setHeader('Cache-Control','no-store');
    return res.status(200).json({success:true,readOnly:true,scope,customer:printed.customer,items:printed.items,
      note:scope.mode==='major'?'대차수 전체 확정 견적 · 날짜 범위 밖 출고와 모든 등록 차감 포함':'선택 실제 날짜의 확정 견적 · 해당 날짜에 등록된 차감만 포함 · 날짜 미배정 차감은 대차수 전체에서 확인',draftIncluded:false});
  } catch(error) {
    if(error.status===409 || error.status===404) return res.status(error.status).json({success:false,error:error.message,
      ...(error.eligibility?{unfixedCount:error.eligibility.unfixedCount,invalidCount:error.eligibility.invalidCount,
        printReadiness:{scope:'ALL_CUSTOMERS_MAJOR_WEEK',positiveCount:error.eligibility.positiveCount,
          unfixedCount:error.eligibility.unfixedCount,invalidCount:error.eligibility.invalidCount,
          reasons:error.eligibility.reasons}}:{}),readOnly:true});
    console.error('[weekday-print]',error);
    return res.status(500).json({success:false,error:'견적 출력 자료를 조회하지 못했습니다.'});
  }
});
