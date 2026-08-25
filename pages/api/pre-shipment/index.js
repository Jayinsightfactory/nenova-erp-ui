import { withAuth } from '../../../lib/auth.js';
import { addManualPreShipmentItem, addPreShipmentSchedule, loadPreShipmentPlans, matchPreShipmentItem, savePreShipmentAllocation, savePreShipmentSchedule, searchPreShipmentProducts } from '../../../lib/preShipment.js';

export default withAuth(async function handler(req, res) {
  try {
    if (req.method === 'GET') return res.status(200).json({ success: true, ...(await loadPreShipmentPlans(req.query.planKey)) });
    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
    const action = String(req.body?.action || '');
    if (action === 'save-cell') {
      await savePreShipmentAllocation({ ...req.body, user: req.user });
      return res.status(200).json({ success: true });
    }
    if (action === 'save-schedule') {
      await savePreShipmentSchedule({ ...req.body, user: req.user });
      return res.status(200).json({ success: true });
    }
    if (action === 'add-schedule') {
      return res.status(200).json({ success: true, schedule: await addPreShipmentSchedule({ ...req.body, user: req.user }) });
    }
    if (action === 'add-item') {
      return res.status(200).json({ success: true, item: await addManualPreShipmentItem({ ...req.body, user: req.user }) });
    }
    if (action === 'search-products') {
      return res.status(200).json({ success: true, products: await searchPreShipmentProducts(req.body?.query) });
    }
    if (action === 'match-item') {
      return res.status(200).json({ success: true, item: await matchPreShipmentItem({ ...req.body, user: req.user }) });
    }
    return res.status(400).json({ success: false, error: '지원하지 않는 action입니다.' });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ success: false, code: error.code, error: error.message });
  }
});

