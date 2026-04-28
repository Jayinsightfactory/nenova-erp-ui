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
    const { inputToken, prodKey, prodName, displayName, flowerName, counName, force } = req.body;
    if (!inputToken || !prodKey) {
      return res.status(400).json({ success: false, error: 'inputToken, prodKey 필요' });
    }
    const result = saveMapping(
      inputToken,
      { prodKey: parseInt(prodKey), prodName, displayName, flowerName, counName },
      { force: !!force }
    );
    if (!result.saved && result.reason === 'fallback-suspect') {
      // 사용자에게 경고 + force 재시도 안내. 409 Conflict.
      return res.status(409).json({
        success: false,
        error: result.warning,
        reason: 'fallback-suspect',
        sampleKeys: result.sampleKeys,
        hint: 'force=true 로 재요청하면 강제 저장됩니다.',
      });
    }
    if (!result.saved) {
      return res.status(500).json({ success: false, error: result.reason });
    }
    return res.status(200).json({ success: true, key: result.key });
  }

  return res.status(405).end();
});
