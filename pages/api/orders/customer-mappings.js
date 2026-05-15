import { withAuth } from '../../../lib/auth';
import { loadCustomerMappings, saveCustomerMapping } from '../../../lib/customerMappings';

export default withAuth(function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ success: true, mappings: loadCustomerMappings(true) });
  }

  if (req.method === 'POST') {
    const { inputToken, custKey, custName, custArea } = req.body || {};
    if (!inputToken || !custKey) {
      return res.status(400).json({ success: false, error: 'inputToken, custKey 필요' });
    }
    const result = saveCustomerMapping(inputToken, { custKey, custName, custArea });
    if (!result.saved) return res.status(500).json({ success: false, error: result.reason });
    return res.status(200).json({ success: true, key: result.key });
  }

  return res.status(405).end();
});
