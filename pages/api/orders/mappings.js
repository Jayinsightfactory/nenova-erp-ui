// pages/api/orders/mappings.js
// GET  → 전체 매핑 반환
// POST { inputToken, prodKey, prodName, displayName, flowerName, counName } → 매핑 저장

import { withAuth } from '../../../lib/auth';
import { loadMappings, saveMapping, normalizeToken } from '../../../lib/parseMappings';

export default withAuth(function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ success: true, mappings: loadMappings() });
  }

  if (req.method === 'POST') {
    const { inputToken, prodKey, prodName, displayName, flowerName, counName } = req.body;
    if (!inputToken || !prodKey) {
      return res.status(400).json({ success: false, error: 'inputToken, prodKey 필요' });
    }
    saveMapping(inputToken, { prodKey: parseInt(prodKey), prodName, displayName, flowerName, counName });
    return res.status(200).json({ success: true, key: normalizeToken(inputToken) });
  }

  return res.status(405).end();
});
