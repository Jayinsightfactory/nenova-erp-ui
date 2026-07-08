import { withAuth } from '../../../lib/auth';
import { withActionLog } from '../../../lib/withActionLog';
import { applyImportRows } from '../../../lib/shipmentImport';

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
  try {
    const result = await applyImportRows({
      rawWeek: req.body?.week,
      rawYear: req.body?.year,
      rows: req.body?.rows,
      user: req.user,
      ackQtyWarnings: !!req.body?.ackQtyWarnings,
      shipmentOnly: !!req.body?.shipmentOnly,
    });
    return res.status(200).json(result);
  } catch (e) {
    if (e.code === 'QTY_WARNING') {
      return res.status(409).json({
        success: false,
        error: e.message,
        code: e.code,
        qtyWarnings: e.qtyWarnings,
      });
    }
    return res.status(500).json({ success: false, error: e.message });
  }
}

export default withAuth(withActionLog(handler, {
  actionType: 'SHIPMENT_IMPORT_APPLY',
  affectedTable: 'OrderMaster/OrderDetail/ShipmentMaster/ShipmentDetail/ShipmentDate',
  riskLevel: 'HIGH',
}));
