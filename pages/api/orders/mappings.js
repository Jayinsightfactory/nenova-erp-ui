// pages/api/orders/mappings.js
// GET  → 전체 매핑 반환
// POST { inputToken, prodKey, prodName, displayName, flowerName, counName } → 매핑 저장

import { withAuth } from '../../../lib/auth';
import { loadMappings, saveMapping, deleteMapping, normalizeToken } from '../../../lib/parseMappings';
import {
  deleteCustomerProductMapping,
  mergeCustomerProductMappings,
  saveCustomerProductMapping,
} from '../../../lib/orderImportCustomerProductMappings';

export default withAuth(function handler(req, res) {
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'no-store');
    const custKey = Number(req.query.custKey || 0);
    const globalMappings = loadMappings(true);
    return res.status(200).json({
      success: true,
      mappings: custKey > 0
        ? mergeCustomerProductMappings(globalMappings, custKey, true)
        : globalMappings,
      scope: custKey > 0 ? 'customer+global' : 'global',
    });
  }

  if (req.method === 'DELETE') {
    const key = (req.query.key || req.body?.key || '').toString();
    if (!key) return res.status(400).json({ success: false, error: 'key 필요' });
    const custKey = Number(req.query.custKey || req.body?.custKey || 0);
    const result = custKey > 0
      ? deleteCustomerProductMapping(custKey, key)
      : deleteMapping(key);
    if (!result.deleted) return res.status(404).json({ success: false, error: result.reason || '삭제 실패' });
    return res.status(200).json({ success: true, key: result.key });
  }

  if (req.method === 'POST') {
    const { inputToken, prodKey, prodName, displayName, flowerName, counName, unit, force, manual, custKey, custName } = req.body;
    if (!inputToken || !prodKey) {
      return res.status(400).json({ success: false, error: 'inputToken, prodKey 필요' });
    }
    const prodInfo = { prodKey: parseInt(prodKey), prodName, displayName, flowerName, counName, manual: manual === true };
    if (unit) prodInfo.unit = unit;
    const normalizedCustKey = Number(custKey || 0);
    // Background learning must never replace an explicit correction with a stale result.
    const previous = normalizedCustKey > 0 ? null : loadMappings(true)[normalizeToken(inputToken)];
    if (manual !== true && previous?.manual === true) {
      if (Number(previous.prodKey) !== Number(prodInfo.prodKey)) return res.status(409).json({ success: false, error: '새 수동 매칭이 있어 이전 분석의 자동 학습을 보류했습니다. 매칭 현황에서 확인하세요.' });
      prodInfo.manual = true;
    }
    const result = normalizedCustKey > 0
      ? saveCustomerProductMapping(normalizedCustKey, inputToken, prodInfo, { custName })
      : saveMapping(inputToken, prodInfo, { force: !!force });
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
    return res.status(200).json({ success: true, key: result.key, custKey: result.custKey || null });
  }

  return res.status(405).end();
});
