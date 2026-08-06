// pages/api/raum/item-mapping.js — 라움 견적 품목 ↔ 전산 품목 매칭 관리
// GET  ?q=검색어        → 전산 품목 검색 (TOP 30)
// POST { name, prodKey } → 매칭 저장 (WebRaumItemMap — DB 라 배포에도 유지, 최우선 적용)
// POST { name, prodKey: null } → 매칭 해제
import { withAuth } from '../../../lib/auth';
import { query, sql } from '../../../lib/db';
import { saveRaumItemMap } from '../../../lib/raumPnl';
import { scoreMatch } from '../../../lib/displayName';
import { rankProductSearchOptions } from '../../../lib/productSearchRanking.js';
import { buildRaumMatchName } from '../../../lib/raumPnlImage';

export default withAuth(async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const q = String(req.query.q || '').trim();
      if (q.length < 1) return res.status(400).json({ success: false, error: '검색어 필요' });
      const term = q.replace(/[%_\[\]]/g, ' ').trim();
      const matchName = buildRaumMatchName(term);
      const tokens = [...new Set(`${term} ${matchName}`
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .split(/\s+/)
        .filter(token => token.length >= 2))].slice(0, 12);
      const searchClauses = tokens.map((_, i) => `(
        p.ProdName LIKE @q${i} OR ISNULL(p.DisplayName,'') LIKE @q${i}
        OR ISNULL(p.FlowerName,'') LIKE @q${i} OR ISNULL(p.CounName,'') LIKE @q${i}
      )`);
      const params = {};
      tokens.forEach((token, i) => { params[`q${i}`] = { type: sql.NVarChar, value: `%${token}%` }; });
      const r = await query(
        `SELECT TOP 300 p.ProdKey, p.ProdName, ISNULL(p.DisplayName,'') AS DisplayName,
                ISNULL(p.FlowerName,'') AS FlowerName, ISNULL(p.CounName,'') AS CounName,
                ISNULL(p.OutUnit,'') AS OutUnit, ISNULL(p.Cost,0) AS Cost,
                ISNULL(u.UsageCount,0) AS UsageCount,
                ISNULL(u.RecentUsageCount,0) AS RecentUsageCount
           FROM Product p
          LEFT JOIN (
            SELECT od.ProdKey,
                   COUNT_BIG(*) AS UsageCount,
                   SUM(CASE WHEN om.OrderDtm >= DATEADD(year,-2,GETDATE()) THEN 1 ELSE 0 END) AS RecentUsageCount
              FROM OrderDetail od
              LEFT JOIN OrderMaster om ON om.OrderMasterKey=od.OrderMasterKey
             WHERE ISNULL(od.isDeleted,0)=0 AND ISNULL(om.isDeleted,0)=0 AND od.ProdKey IS NOT NULL
             GROUP BY od.ProdKey
          ) u ON u.ProdKey=p.ProdKey
          WHERE p.isDeleted = 0
            AND (${searchClauses.length ? searchClauses.join(' OR ') : '1=0'})`,
        params
      );
      const products = (r.recordset || [])
        .map(product => ({
          ...product,
          MatchScore: Math.max(
            scoreMatch(term, product, ''),
            scoreMatch(matchName, product, ''),
          ),
        }));
      const ranked = rankProductSearchOptions(matchName || term, products, { limit: 50 });
      const scoreByKey = new Map(products.map(p => [Number(p.ProdKey), p.MatchScore]));
      const ordered = ranked.map(p => ({ ...p, MatchScore: scoreByKey.get(Number(p.ProdKey)) || 0 }));
      return res.status(200).json({ success: true, products: ordered });
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
