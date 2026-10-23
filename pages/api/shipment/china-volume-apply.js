import { withAuth } from '../../../lib/auth';
import { withActionLog } from '../../../lib/withActionLog';
import { applyDutchVolume } from './dutch-volume-apply';

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };
export const applyChinaVolume = (body, user, deps = {}) => applyDutchVolume(body, user, { ...deps, country: '중국' });

export default withAuth(withActionLog(async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false });
  try { return res.status(200).json(await applyChinaVolume(req.body, req.user)); }
  catch (error) { return res.status(error.statusCode || 409).json({ success: false, code: error.code, error: error.message, qtyWarnings: error.qtyWarnings }); }
}, { actionType: 'CHINA_VOLUME_APPLY', affectedTable: 'OrderMaster/OrderDetail/ShipmentMaster/ShipmentDetail/ShipmentDate', riskLevel: 'HIGH' }));
