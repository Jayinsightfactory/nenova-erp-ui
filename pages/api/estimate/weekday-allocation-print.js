import { withAuth } from '../../../lib/auth.js';
import { withTransaction,sql } from '../../../lib/db.js';
import { normalizeWeekdayPrintRequest,readWeekdayAllocationPrintInTransaction } from '../../../lib/weekdayAllocationPrint.js';
import {weekdayPrintNotes} from '../../../lib/weekdayPrintNoteService.js';

export function createWeekdayAllocationPrintHandler({transaction=withTransaction,types=sql,notes=weekdayPrintNotes}={}) {
  return async function handler(req,res) {
    if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).end();}
    let scope;
    try {
      if(req.body?.source!=='ALLOCATION')throw new Error('저장 분배 기준 출력 방식을 확인하세요.');
      scope=normalizeWeekdayPrintRequest(req.body);
    }catch(error){return res.status(400).json({success:false,error:error.message,readOnly:true});}
    try {
      const result=await transaction(tQuery=>readWeekdayAllocationPrintInTransaction(scope,tQuery,types));
      const printNotes=await notes.list(scope,result.items);
      res.setHeader('Cache-Control','no-store');
      return res.status(200).json({success:true,readOnly:true,draftIncluded:false,source:'ALLOCATION',scope,...result,printNotes,
        note:scope.mode==='major'?'저장 분배 기준 견적 · 확정 여부 무관 · 모든 등록 차감 포함':'선택일 저장 분배 기준 견적 · 확정 여부 무관 · 해당 날짜 등록 차감만 포함'});
    }catch(error){
      if(error.status===409||error.status===404)return res.status(error.status).json({success:false,readOnly:true,source:'ALLOCATION',error:error.message});
      console.error('[weekday-allocation-print]',{code:error.code||'ALLOCATION_PRINT_FAILED'});
      return res.status(500).json({success:false,readOnly:true,error:'저장 분배 출력 자료를 조회하지 못했습니다.'});
    }
  };
}
export default withAuth(createWeekdayAllocationPrintHandler());
