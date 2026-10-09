import { withAuth } from '../../../lib/auth';
import { withTransaction, sql } from '../../../lib/db';
import {
  acquireErpEditLease,
  advanceErpEditGuard,
  assertErpEditGuard,
  releaseErpEditLease,
} from '../../../lib/erpEditPresence.js';
import {
  assertDirectionalGateCapability,
  lockDirectionalGate,
} from '../../../lib/estimateDirectionalQuantity.js';
import {
  executeWeekdayDistributionApply,
  weekdayDistributionErrorResponse,
} from '../../../lib/weekdayDistributionApply.js';

const runtimeDependencies = {
  confirmationLifecycle: true,
  assertGateCapability: assertDirectionalGateCapability,
  lockGate: lockDirectionalGate,
  acquireEditLease: acquireErpEditLease,
  assertEditGuard: assertErpEditGuard,
  advanceEditGuard: advanceErpEditGuard,
  releaseEditLease: releaseErpEditLease,
};

export function createWeekdayApplyHandler({
  transaction = withTransaction,
  types = sql,
  dependencies = runtimeDependencies,
} = {}) {
  return async function weekdayApplyHandler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();
    try {
      const result = await transaction(async (tQ) => {
        try {
          return await executeWeekdayDistributionApply(
            tQ,
            types,
            req.body,
            req.user,
            dependencies,
          );
        } catch (error) {
          // withTransaction only reaches the outer rejection after its
          // rollback path.  Mark callback failures so deterministic SQL/core
          // errors can be distinguished from connect/commit ambiguity.
          if (error && typeof error === 'object') error.weekdayTransactionBodyFailed = true;
          throw error;
        }
      });
      return res.status(200).json(result);
    } catch (error) {
      const mapped = weekdayDistributionErrorResponse(error);
      console.error('[weekday-apply]', { operationId: req.body?.operationId || null,
        code: error.code || 'INTERNAL_ERROR', stage: error.failureStage || 'TRANSACTION',
        rolledBack: mapped.body.rolledBack === true });
      return res.status(mapped.status).json(mapped.body);
    }
  };
}

export default withAuth(createWeekdayApplyHandler());
