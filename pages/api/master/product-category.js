// pages/api/master/product-category.js
// Product.FlowerName 만 빠르게 업데이트 (운송기준원가 화면에서 카테고리 오버라이드 저장용)
import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { prodKey, flowerName } = req.body;
  if (!prodKey) return res.status(400).json({ success: false, error: 'prodKey 필요' });
  try {
    await query(
      `UPDATE Product SET FlowerName=@flower WHERE ProdKey=@pk`,
      {
        pk:     { type: sql.Int,      value: parseInt(prodKey) },
        flower: { type: sql.NVarChar, value: flowerName || '' },
      }
    );
    return res.status(200).json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});
