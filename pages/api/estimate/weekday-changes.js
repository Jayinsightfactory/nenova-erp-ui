import { withAuth } from '../../../lib/auth';
import { query, sql } from '../../../lib/db';
import {
  readWeekdayChanges,
  readWeekdayOperation,
  weekdayDistributionErrorResponse,
} from '../../../lib/weekdayDistributionApply.js';

export function createWeekdayChangesHandler({ queryFn = query, types = sql } = {}) {
  return async function weekdayChangesHandler(req, res) {
    if (req.method !== 'GET') return res.status(405).end();
    try {
      if (String(req.query?.operationId || '').trim()) {
        const operation = await readWeekdayOperation(queryFn, types, req.query || {});
        return res.status(200).json({
          success: true,
          saved: Boolean(operation),
          operation: operation || null,
        });
      }
      const history = await readWeekdayChanges(queryFn, types, req.query || {});
      return res.status(200).json({
        success: true,
        changes: history.changes,
        limit: history.limit,
        truncated: history.truncated,
        scope: history.scope,
      });
    } catch (error) {
      const mapped = weekdayDistributionErrorResponse(error);
      return res.status(mapped.status).json(mapped.body);
    }
  };
}

export default withAuth(createWeekdayChangesHandler());
