// pages/api/products/search.js
// 품목 검색 API
// 수정이력: 2026-03-27 — TOP 제한 제거, 캐시 적용
// 수정이력: 2026-03-30 — 그룹 목록 전용 모드 추가 (groupsOnly=1), 그룹 선택 시 해당 품목만 로드

import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

// ── 서버 메모리 캐시
if (!global._prodCache) {
  global._prodCache = { data: null, updatedAt: null, ttl: 5 * 60 * 1000 };
}
if (!global._groupCache) {
  global._groupCache = { data: null, updatedAt: null, ttl: 10 * 60 * 1000 };
}

function isCacheValid(c) {
  return c.data && c.updatedAt && (Date.now() - c.updatedAt < c.ttl);
}

export default withAuth(async function handler(req, res) {
  const { q, flower, country, groupsOnly, refresh } = req.query;

  try {
    // ── 모드 1: 그룹 목록만 (groupsOnly=1)
    // 왼쪽 패널 초기 로드용 — 국가+꽃 조합만 반환 (빠름)
    if (groupsOnly === '1') {
      if (refresh === '1' || !isCacheValid(global._groupCache)) {
        const result = await query(
          `SELECT
            CounName AS country,
            FlowerName AS flower,
            ISNULL(CounName,'') + ISNULL(FlowerName,'') AS label,
            COUNT(*) AS prodCount
           FROM Product
           WHERE isDeleted = 0
           GROUP BY CounName, FlowerName
           ORDER BY CounName, FlowerName`
        );
        global._groupCache.data = result.recordset;
        global._groupCache.updatedAt = Date.now();
      }
      return res.status(200).json({
        success: true,
        groups: global._groupCache.data,
      });
    }

    // ── 모드 2: 특정 그룹 품목 조회 (country + flower 지정)
    // 그룹 클릭 시 해당 그룹만 직접 DB 쿼리 (전체 캐시 로드 없이 빠름)
    if (country && flower && !q) {
      const result = await query(
        `SELECT
          p.ProdKey, p.ProdCode, p.ProdName, p.DisplayName,
          p.FlowerName, p.CounName,
          ISNULL(p.CounName,'') + ISNULL(p.FlowerName,'') AS CountryFlower,
          p.Cost, p.OutUnit, p.EstUnit,
          ISNULL(p.BunchOf1Box,0)   AS BunchOf1Box,
          ISNULL(p.SteamOf1Bunch,0) AS SteamOf1Bunch,
          ISNULL(p.SteamOf1Box,0)   AS SteamOf1Box,
          ISNULL(p.Stock,0)         AS Stock,
          ISNULL(oc.orderCount, 0)  AS orderCount
         FROM Product p
         LEFT JOIN (
           SELECT ProdKey, COUNT(*) AS orderCount
           FROM OrderDetail WHERE isDeleted = 0
           GROUP BY ProdKey
         ) oc ON p.ProdKey = oc.ProdKey
         WHERE p.isDeleted = 0 AND p.CounName = @country AND p.FlowerName = @flower
         ORDER BY ISNULL(oc.orderCount,0) DESC, p.ProdName`,
        {
          country: { type: sql.NVarChar, value: country },
          flower:  { type: sql.NVarChar, value: flower },
        }
      );
      return res.status(200).json({ success: true, count: result.recordset.length, products: result.recordset });
    }

    // ── 모드 3: 검색어로 전체 검색 (q 있을 때)
    if (q && q.trim()) {
      // 캐시 없으면 로드
      if (refresh === '1' || !isCacheValid(global._prodCache)) {
        const result = await query(
          `SELECT
            p.ProdKey, p.ProdCode, p.ProdName, p.DisplayName,
            p.FlowerName, p.CounName,
            ISNULL(p.CounName,'') + ISNULL(p.FlowerName,'') AS CountryFlower,
            p.Cost, p.OutUnit, p.EstUnit,
            ISNULL(p.BunchOf1Box,0)   AS BunchOf1Box,
            ISNULL(p.SteamOf1Bunch,0) AS SteamOf1Bunch,
            ISNULL(p.SteamOf1Box,0)   AS SteamOf1Box,
            ISNULL(p.Stock,0)         AS Stock
           FROM Product p
           WHERE p.isDeleted = 0
           ORDER BY p.CounName, p.FlowerName, p.ProdName`
        );
        global._prodCache.data = result.recordset;
        global._prodCache.updatedAt = Date.now();
      }
      const keyword = q.toLowerCase();
      const products = global._prodCache.data.filter(p =>
        p.ProdName?.toLowerCase().includes(keyword) ||
        p.DisplayName?.toLowerCase().includes(keyword) ||
        p.ProdCode?.toLowerCase().includes(keyword) ||
        p.FlowerName?.toLowerCase().includes(keyword) ||
        p.CounName?.toLowerCase().includes(keyword)
      );
      return res.status(200).json({ success: true, count: products.length, products });
    }

    // ── 모드 4: 전체 조회 (q 없고 그룹 미지정 — 견적서 모달 등 드롭다운용)
    if (refresh === '1' || !isCacheValid(global._prodCache)) {
      const result = await query(
        `SELECT
          p.ProdKey, p.ProdCode, p.ProdName, p.DisplayName,
          p.FlowerName, p.CounName,
          ISNULL(p.CounName,'') + ISNULL(p.FlowerName,'') AS CountryFlower,
          p.Cost, p.OutUnit, p.EstUnit,
          ISNULL(p.BunchOf1Box,0)   AS BunchOf1Box,
          ISNULL(p.SteamOf1Bunch,0) AS SteamOf1Bunch,
          ISNULL(p.SteamOf1Box,0)   AS SteamOf1Box,
          ISNULL(p.Stock,0)         AS Stock
         FROM Product p
         WHERE p.isDeleted = 0
         ORDER BY p.CounName, p.FlowerName, p.ProdName`
      );
      global._prodCache.data = result.recordset;
      global._prodCache.updatedAt = Date.now();
    }
    return res.status(200).json({
      success: true,
      count: global._prodCache.data.length,
      products: global._prodCache.data,
    });

  } catch (err) {
    global._prodCache = { data: null, updatedAt: null, ttl: 5 * 60 * 1000 };
    global._groupCache = { data: null, updatedAt: null, ttl: 10 * 60 * 1000 };
    return res.status(500).json({ success: false, error: err.message });
  }
});
