// pages/api/raum/item-mapping.js — 라움 견적 품목 ↔ 전산 품목 매칭 관리
// GET  ?q=검색어        → 전산 품목 검색 (TOP 30)
// POST { name, prodKey } → 매칭 저장 (WebRaumItemMap — DB 라 배포에도 유지, 최우선 적용)
// POST { name, prodKey: null } → 매칭 해제
import { withAuth } from '../../../lib/auth';
import { query, sql } from '../../../lib/db';
import { saveRaumItemMap } from '../../../lib/raumPnl';
import { scoreMatch } from '../../../lib/displayName';
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
                ISNULL(p.OutUnit,'') AS OutUnit, ISNULL(p.Cost,0) AS Cost
           FROM Product p
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
        }))
        .sort((a, b) => b.MatchScore - a.MatchScore || String(a.ProdName).localeCompare(String(b.ProdName)))
        .slice(0, 50);
      return res.status(200).json({ success: true, products });
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
