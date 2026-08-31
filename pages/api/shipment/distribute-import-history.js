import { withAuth } from '../../../lib/auth.js';
import { listShipmentImportHistory } from '../../../lib/shipmentImportRollback.js';

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });
  try {
    const rows = await listShipmentImportHistory({ limit: req.query?.limit });
    return res.status(200).json({ success: true, rows });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, code: error.code, error: error.message });
  }
}

export default withAuth(handler);
