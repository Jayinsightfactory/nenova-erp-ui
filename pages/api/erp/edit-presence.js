import { withAuth } from '../../../lib/auth.js';
import { query, withTransaction } from '../../../lib/db.js';
import {
  acquireErpEditLease,
  editErrorResponse,
  editPresencePayload,
  getErpEditStatus,
  heartbeatErpEditLease,
  refreshErpEditLease,
  releaseErpEditLease,
} from '../../../lib/erpEditPresence.js';

export default withAuth(async function handler(req, res) {
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
    if (action === 'refresh') {
      const refreshed = await withTransaction((tQ) => refreshErpEditLease(tQ, body, req.user, body.editGuard || body));
      return res.status(200).json({ success: true, ...editPresencePayload(refreshed, {
        userId: req.user?.userId,
        clientId: body.editGuard?.clientId || body.clientId,
      }) });
    }
    const result = await withTransaction(async (tQ) => {
      if (action === 'acquire') return acquireErpEditLease(tQ, body, req.user, body);
      if (action === 'takeover') return acquireErpEditLease(tQ, body, req.user, { ...body, takeover: true });
      if (action === 'heartbeat') return heartbeatErpEditLease(tQ, body, req.user, body.editGuard || body);
      if (action === 'release') return releaseErpEditLease(tQ, body, req.user, body.editGuard || body);
      const error = new Error('action은 acquire, takeover, heartbeat, release, refresh 중 하나여야 합니다.');
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
});
