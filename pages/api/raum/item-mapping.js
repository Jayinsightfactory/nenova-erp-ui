// pages/api/raum/item-mapping.js — 라움 견적 품목 ↔ 전산 품목 매칭 관리
// GET  ?q=검색어        → 전산 품목 검색 (TOP 30)
// POST { name, prodKey } → 매칭 저장 (WebRaumItemMap — DB 라 배포에도 유지, 최우선 적용)
// POST { name, prodKey: null } → 매칭 해제
import { withAuth } from '../../../lib/auth';
import { query, sql } from '../../../lib/db';
import { saveRaumItemMap } from '../../../lib/raumPnl';

export default withAuth(async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const q = String(req.query.q || '').trim();
      if (q.length < 1) return res.status(400).json({ success: false, error: '검색어 필요' });
      const term = q.replace(/[%_\[\]]/g, ' ').trim();
      const like = `%${term}%`;
      const starts = `${term}%`;
      const r = await query(
        `SELECT TOP 50 p.ProdKey, p.ProdName, ISNULL(p.DisplayName,'') AS DisplayName,
                ISNULL(p.FlowerName,'') AS FlowerName, ISNULL(p.CounName,'') AS CounName,
                ISNULL(p.OutUnit,'') AS OutUnit, ISNULL(p.Cost,0) AS Cost,
                CASE WHEN p.ProdName = @term OR ISNULL(p.DisplayName,'') = @term THEN 0
                     WHEN p.ProdName LIKE @starts OR ISNULL(p.DisplayName,'') LIKE @starts THEN 1
                     WHEN p.ProdName LIKE @like OR ISNULL(p.DisplayName,'') LIKE @like THEN 2
                     ELSE 3 END AS MatchRank
           FROM Product p
          WHERE p.isDeleted = 0
            AND (p.ProdName LIKE @q OR ISNULL(p.DisplayName,'') LIKE @q
              OR ISNULL(p.FlowerName,'') LIKE @q OR ISNULL(p.CounName,'') LIKE @q)
          ORDER BY MatchRank, p.ProdName`,
        {
          term: { type: sql.NVarChar, value: term },
          starts: { type: sql.NVarChar, value: starts },
          like: { type: sql.NVarChar, value: like },
          q: { type: sql.NVarChar, value: like },
        }
      );
      return res.status(200).json({ success: true, products: r.recordset || [] });
    }

    if (req.method === 'POST') {
      const { name, prodKey } = req.body || {};
      if (!name) return res.status(400).json({ success: false, error: 'name 필요' });
      const actor = req.user?.userName || req.user?.userId || 'user';
      const result = await saveRaumItemMap(name, prodKey ?? null, actor);
      return res.status(200).json({ success: true, ...result });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});
