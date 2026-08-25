import { withAuth } from '../../../../lib/auth';
import { requireMoyiDriveAdmin, writePermissionAudit } from '../../../../lib/moyiDriveAdmin';
import { loadMoyiDrivePreview } from '../../../../lib/moyiDriveGateway';

async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).end();
  }
  if (!requireMoyiDriveAdmin(req, res)) {
    writePermissionAudit({ actorId: req.user?.userId, action: 'file-preview', outcome: 'denied', reason: 'admin-only' });
    return;
  }
  const fileId = Array.isArray(req.query?.fileId) ? '' : String(req.query?.fileId || '');
  const result = await loadMoyiDrivePreview(req, fileId);
  writePermissionAudit({
    actorId: req.user?.userId,
    action: 'file-preview',
    outcome: result.status === 200 ? 'allowed' : 'denied',
    reason: result.status === 200 ? 'short-lived-preview' : `upstream-${result.status}`,
    targetType: 'file',
    targetId: fileId,
  });
  if (result.status !== 200) return res.status(result.status).end();
  res.setHeader('Content-Type', result.contentType);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  return res.status(200).send(result.bytes);
}

export const config = { api: { responseLimit: '50mb' } };

export default withAuth(handler);
