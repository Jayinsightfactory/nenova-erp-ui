import { withAuth } from '../../../lib/auth.js';
import { getShipmentImportAuditRows, listShipmentImportHistory } from '../../../lib/shipmentImportRollback.js';

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });
  try {
    if (req.query?.auditKey) {
      const rows = await getShipmentImportAuditRows({ auditKey: req.query.auditKey, prodKey: req.query.prodKey });
      return res.status(200).json({ success: true, auditKey: Number(req.query.auditKey), rows });
    }
    const rows = await listShipmentImportHistory({ limit: req.query?.limit });
    return res.status(200).json({ success: true, rows });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, code: error.code, error: error.message });
  }
}

export default withAuth(handler);
