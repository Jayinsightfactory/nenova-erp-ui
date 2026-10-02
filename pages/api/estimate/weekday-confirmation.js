import { query,sql } from '../../../lib/db.js';
import { withAuth } from '../../../lib/auth.js';
import { normalizeWeekdayConfirmationScope,buildWeekdayConfirmationSummary,WEEKDAY_CONFIRMATION_SQL } from '../../../lib/weekdayConfirmation.js';

export default withAuth(async function handler(req,res) {
  if(req.method!=='GET') {res.setHeader('Allow','GET');return res.status(405).end();}
  let scope;
  try {scope=normalizeWeekdayConfirmationScope(req.query);} catch(error) {return res.status(400).json({success:false,error:error.message});}
  try {
    const result=await query(WEEKDAY_CONFIRMATION_SQL,{
      year:{type:sql.NVarChar(4),value:String(scope.year)},
      weekPrefix:{type:sql.NVarChar(5),value:`${scope.majorWeek}-%`},
    });
    const summary=buildWeekdayConfirmationSummary(scope,result.recordset);
    res.setHeader('Cache-Control','no-store');
    return res.status(200).json({success:true,readOnly:true,summary,
      note:'메인차수 모든 세부차수·전체 거래처 양수 상세의 저장 isFix 현황. 연결 경고는 별도이며 저장·재고·인쇄 가능 판정이 아닙니다. 최초 기준과 별개이며 자동 확정하지 않습니다.'});
  } catch(error) {
    console.error('[weekday-confirmation]',error);
    return res.status(500).json({success:false,error:'ERP 품종별 확정 현황을 조회하지 못했습니다.'});
  }
});
