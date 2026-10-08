import { withAuth } from '../../../lib/auth.js';
import { query, withTransaction } from '../../../lib/db.js';
import { acquireErpEditLease, advanceErpEditGuard, assertErpEditGuard,
  releaseErpEditLease } from '../../../lib/erpEditPresence.js';
import { assertDirectionalGateCapability, lockDirectionalGate } from '../../../lib/estimateDirectionalQuantity.js';
import { weekdayRollbackAcknowledgement } from '../../../lib/weekdayDistributionApply.js';
import { applyEarlyShipment, listEarlyShipmentStatus, previewEarlyShipment,
  reverseEarlyShipment } from '../../../lib/weekdayEarlyShipmentApply.js';

const runtimeDependencies={
  assertGateCapability:assertDirectionalGateCapability,
  lockGate:lockDirectionalGate,
  acquireEditLease:acquireErpEditLease,
  assertEditGuard:assertErpEditGuard,
  advanceEditGuard:advanceErpEditGuard,
  releaseEditLease:releaseErpEditLease,
};

function lookupScope(input={}) {
  const year=Number(input.year),majorWeek=String(input.majorWeek??'').padStart(2,'0'),custKey=Number(input.custKey);
  if (!Number.isSafeInteger(year)||year<2026||year>2200||!/^\d{2}$/.test(majorWeek)
    ||Number(majorWeek)<1||Number(majorWeek)>53||!Number.isSafeInteger(custKey)||custKey<1)
    throw Object.assign(new Error('year, majorWeek, custKey를 확인하세요.'),{code:'EARLY_INVALID_SCOPE',statusCode:400});
  return {year,majorWeek,custKey};
}

export function createWeekdayEarlyShipmentHandler({queryFn=query,transaction=withTransaction,
  dependencies=runtimeDependencies}={}) {
  return async function handler(req,res) {
    res.setHeader('Cache-Control','no-store');
    if (!['GET','POST'].includes(req.method)) {
      res.setHeader('Allow','GET, POST');
      return res.status(405).end();
    }
    try {
      if (req.method==='GET') return res.status(200).json(
        await listEarlyShipmentStatus(queryFn,lookupScope(req.query)));
      const action=String(req.body?.action??'').toUpperCase();
      if (action==='PREVIEW') return res.status(200).json(await previewEarlyShipment(queryFn,req.body));
      if (!['APPLY','REVERSE'].includes(action))
        return res.status(400).json({success:false,code:'EARLY_INVALID_ACTION',error:'action을 확인하세요.'});
      const result=await transaction(async tQ=>{
        try {
          return action==='APPLY'
            ? await applyEarlyShipment(tQ,req.body,req.user,dependencies)
            : await reverseEarlyShipment(tQ,req.body,req.user,dependencies);
        } catch (error) {
          if (error&&typeof error==='object') error.weekdayTransactionBodyFailed=true;
          throw error;
        }
      });
      return res.status(200).json(result);
    } catch (error) {
      const status=Number(error.statusCode||error.status)||500;
      return res.status(status).json({success:false,code:error.code||'EARLY_SHIPMENT_FAILED',
        error:error.message||'선출고 처리에 실패했습니다.',
        ...(error.negativeStock?{negativeStock:error.negativeStock}:{}),
        ...weekdayRollbackAcknowledgement(error)});
    }
  };
}

export default withAuth(createWeekdayEarlyShipmentHandler());
