// pages/api/orders/import-units.js
// GET → 품목명별 학습 단위 catalog
// POST { inputName, unit } → 단위 저장 (엑셀·수동 공통)

import { withAuth } from '../../../lib/auth';
import { loadImportUnits, saveImportUnit, normalizeImportUnit } from '../../../lib/orderImportUnits';

export default withAuth(function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ success: true, units: loadImportUnits() });
  }

  if (req.method === 'POST') {
    const { inputName, unit, source } = req.body || {};
    if (!inputName || !unit) {
      return res.status(400).json({ success: false, error: 'inputName, unit 필요' });
    }
    const result = saveImportUnit(inputName, unit, { source: source || 'manual' });
    if (!result.saved) {
      return res.status(400).json({ success: false, error: result.reason || '저장 실패' });
    }
    return res.status(200).json({
      success: true,
      key: result.key,
      unit: result.unit,
      normalized: normalizeImportUnit(unit),
    });
  }

  return res.status(405).end();
});
