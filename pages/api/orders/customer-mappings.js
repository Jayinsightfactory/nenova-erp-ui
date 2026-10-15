import { withAuth } from '../../../lib/auth';
import { query, sql } from '../../../lib/db';
import { loadCustomerMappings, saveCustomerMapping, deleteCustomerMapping } from '../../../lib/customerMappings';
import { hydrateCustomerMappings, readActiveCustomerNames } from '../../../lib/pasteMappingNames';

export default withAuth(async function handler(req, res) {
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const mappings = await loadCustomerMappings(true);
      const customers = await readActiveCustomerNames(query, sql, mappings);
      return res.status(200).json({ success: true, mappings: hydrateCustomerMappings(mappings, customers) });
    } catch (error) {
      console.error('[customer-mappings] current names read failed:', error);
      return res.status(500).json({ success: false, error: '현재 업체명 조회에 실패했습니다.' });
    }
  }

  if (req.method === 'DELETE') {
    const key = (req.query.key || req.body?.key || '').toString();
    if (!key) return res.status(400).json({ success: false, error: 'key 필요' });
    const result = await deleteCustomerMapping(key);
    if (!result.deleted) return res.status(404).json({ success: false, error: result.reason || '삭제 실패' });
    return res.status(200).json({ success: true, key: result.key });
  }

  if (req.method === 'POST') {
    const { inputToken, custKey, custName, custArea } = req.body || {};
    if (!inputToken || !custKey) {
      return res.status(400).json({ success: false, error: 'inputToken, custKey 필요' });
    }
    const result = await saveCustomerMapping(inputToken, { custKey, custName, custArea });
    if (!result.saved) return res.status(500).json({ success: false, error: result.reason });
    return res.status(200).json({ success: true, key: result.key });
  }

  return res.status(405).end();
});
