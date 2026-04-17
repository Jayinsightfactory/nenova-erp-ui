// pages/api/orders/prod-units.js
// GET  → { [ProdKey]: '박스'|'단'|'송이' } (OrderDetail 이력 기반)
// PUT  → { prodKey, unit } → Product.OutUnit 저장 (사용자 수동 설정)

import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

export default withAuth(async function handler(req, res) {
  if (req.method === 'PUT') {
    const { prodKey, unit } = req.body;
    if (!prodKey || !['박스','단','송이'].includes(unit))
      return res.status(400).json({ success: false, error: 'prodKey, unit(박스|단|송이) 필요' });
    try {
      await query(
        `UPDATE Product SET OutUnit=@unit WHERE ProdKey=@pk`,
        { unit: { type: sql.NVarChar, value: unit }, pk: { type: sql.Int, value: parseInt(prodKey) } }
      );
      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }
  if (req.method !== 'GET') return res.status(405).end();
  try {
    const r = await query(
      `SELECT ProdKey,
        SUM(ISNULL(BoxQuantity,0))   AS TotalBox,
        SUM(ISNULL(BunchQuantity,0)) AS TotalBunch,
        SUM(ISNULL(SteamQuantity,0)) AS TotalSteam
       FROM OrderDetail
       WHERE isDeleted=0 AND ProdKey IS NOT NULL
       GROUP BY ProdKey`, {}
    );

    const map = {};
    for (const row of r.recordset) {
      const b = row.TotalBox, d = row.TotalBunch, s = row.TotalSteam;
      if (b === 0 && d === 0 && s === 0) continue;
      if (d >= b && d >= s)      map[row.ProdKey] = '단';
      else if (s >= b && s >= d) map[row.ProdKey] = '송이';
      else                       map[row.ProdKey] = '박스';
    }

    return res.status(200).json({ success: true, units: map });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
