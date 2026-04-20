// pages/api/freight/category-override.js
// 운송기준원가 웹 전용 카테고리 오버라이드 API
// GET  → 전체 오버라이드 맵 반환
// POST → { prodKey, category, note } 저장 (category 가 빈 값이면 삭제)
import { withAuth } from '../../../lib/auth';
import { loadOverrides, saveOverride, removeOverride } from '../../../lib/categoryOverrides';

export default withAuth(async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ success: true, overrides: loadOverrides() });
  }
  if (req.method === 'POST') {
    const { prodKey, category, note } = req.body || {};
    if (!prodKey) return res.status(400).json({ success: false, error: 'prodKey 필요' });
    if (!category || String(category).trim() === '') {
      removeOverride(prodKey);
      return res.status(200).json({ success: true, removed: true });
    }
    saveOverride(prodKey, String(category).trim(), note || '');
    return res.status(200).json({ success: true });
  }
  return res.status(405).end();
});
