// pages/api/freight/category-override.js
// 운송기준원가 웹 전용 카테고리 오버라이드 API
// GET   → 전체 오버라이드 + Product join 정보
// POST  → { prodKey, category, note } 저장 (category 빈 값이면 삭제)
// DELETE → ?prodKey=... 로 단건 삭제
import { withAuth } from '../../../lib/auth';
import { query, sql } from '../../../lib/db';
import { loadOverrides, saveOverride, removeOverride } from '../../../lib/categoryOverrides';

export default withAuth(async function handler(req, res) {
  if (req.method === 'GET') {
    const overrides = loadOverrides(true);
    const prodKeys = Object.keys(overrides).map(k => parseInt(k)).filter(Boolean);
    let products = [];
    if (prodKeys.length > 0) {
      const r = await query(
        `SELECT ProdKey, ProdName, DisplayName, FlowerName AS DbFlowerName, CounName
         FROM Product WHERE ProdKey IN (${prodKeys.join(',')}) AND isDeleted=0`
      );
      products = r.recordset;
    }
    const prodMap = Object.fromEntries(products.map(p => [p.ProdKey, p]));
    const list = prodKeys.map(k => ({
      prodKey: k,
      prodName:   prodMap[k]?.ProdName    || '(삭제된 품목)',
      displayName:prodMap[k]?.DisplayName || null,
      dbFlowerName: prodMap[k]?.DbFlowerName || null,
      counName:   prodMap[k]?.CounName    || null,
      category:   overrides[k]?.category || '',
      note:       overrides[k]?.note || '',
      savedAt:    overrides[k]?.savedAt || null,
    })).sort((a, b) => (a.category || '').localeCompare(b.category || '') || (a.prodName || '').localeCompare(b.prodName || ''));
    return res.status(200).json({ success: true, overrides, list });
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
  if (req.method === 'DELETE') {
    const { prodKey } = req.query || {};
    if (!prodKey) return res.status(400).json({ success: false, error: 'prodKey 필요' });
    removeOverride(parseInt(prodKey));
    return res.status(200).json({ success: true });
  }
  return res.status(405).end();
});
