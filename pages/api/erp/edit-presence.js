import { withAuth } from '../../../lib/auth.js';
import { query, withTransaction } from '../../../lib/db.js';
import { withActionLog } from '../../../lib/withActionLog.js';
import {
  acquireErpEditLease,
  editErrorResponse,
  editPresencePayload,
  getErpEditStatus,
  refreshErpEditLease,
  releaseErpEditLease,
  renewThenReadErpEditStatus,
} from '../../../lib/erpEditPresence.js';

async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  try {
    if (req.method === 'GET') {
      const status = await getErpEditStatus(query, req.query, {
        userId: req.user?.userId,
        clientId: req.query?.clientId,
      });
      return res.status(200).json({ success: true, ...editPresencePayload(status, {
        userId: req.user?.userId,
        clientId: req.query?.clientId,
      }) });
    }
    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'method not allowed' });
    const body = req.body || {};
    const action = String(body.action || '').toLowerCase();
    if (action === 'heartbeat') {
      const status = await renewThenReadErpEditStatus(
        { withTransaction, query },
        body,
        req.user,
        body.editGuard || body,
      );
      return res.status(200).json({ success: true, ...editPresencePayload(status, {
        userId: req.user?.userId,
        clientId: body.editGuard?.clientId || body.clientId,
      }) });
    }
    if (action === 'refresh') {
      const refreshed = await withTransaction((tQ) => refreshErpEditLease(tQ, body, req.user, body.editGuard || body));
      return res.status(200).json({ success: true, ...editPresencePayload(refreshed, {
        userId: req.user?.userId,
        clientId: body.editGuard?.clientId || body.clientId,
      }) });
    }
    const result = await withTransaction(async (tQ) => {
      if (action === 'acquire') return acquireErpEditLease(tQ, body, req.user, { ...body, forceTakeover: false, takeover: false });
      if (action === 'takeover') return acquireErpEditLease(tQ, body, req.user, { ...body, forceTakeover: false, takeover: true });
      if (action === 'force-takeover') return acquireErpEditLease(tQ, body, req.user, { ...body, forceTakeover: true });
      if (action === 'release') return releaseErpEditLease(tQ, body, req.user, body.editGuard || body);
      const error = new Error('action은 acquire, takeover, force-takeover, heartbeat, release, refresh 중 하나여야 합니다.');
      error.code = 'ERP_EDIT_ACTION_INVALID';
      error.statusCode = 400;
      throw error;
    });
    return res.status(200).json({ success: true, ...editPresencePayload(result, {
      userId: req.user?.userId,
      clientId: body.editGuard?.clientId || body.clientId,
    }) });
  } catch (error) {
    const response = editErrorResponse(error);
    return res.status(response.statusCode).json(response.body);
  }
}

const auditedTakeover = withActionLog(handler, {
  actionType: 'ERP_EDIT_TAKEOVER', affectedTable: 'WebErpEditLease', riskLevel: 'HIGH',
});
export default withAuth((req, res) => req.method === 'POST' && String(req.body?.action || '').toLowerCase() === 'force-takeover'
  ? auditedTakeover(req, res) : handler(req, res));
