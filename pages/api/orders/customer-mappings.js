import { withAuth } from '../../../lib/auth';
import { loadCustomerMappings, saveCustomerMapping, deleteCustomerMapping } from '../../../lib/customerMappings';

export default withAuth(function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ success: true, mappings: loadCustomerMappings(true) });
  }

  if (req.method === 'DELETE') {
    const key = (req.query.key || req.body?.key || '').toString();
    if (!key) return res.status(400).json({ success: false, error: 'key 필요' });
    const result = deleteCustomerMapping(key);
    if (!result.deleted) return res.status(404).json({ success: false, error: result.reason || '삭제 실패' });
    return res.status(200).json({ success: true, key: result.key });
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
