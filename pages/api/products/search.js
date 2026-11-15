// pages/api/products/search.js
// 품목 검색 API
// 수정이력: 2026-03-27 — TOP 제한 제거, 캐시 적용
// 수정이력: 2026-03-30 — 그룹 목록 전용 모드 추가 (groupsOnly=1), 그룹 선택 시 해당 품목만 로드

import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { rankProductSearchOptions } from '../../../lib/productSearchRanking.js';
import { buildProductMappingStats } from '../../../lib/orderImportMatch.js';
import { MAPPING_STORE_KEYS, readMappingSnapshot } from '../../../lib/mappingDbStore.js';
import { scoreNaturalLanguageProducts } from '../../../lib/naturalLanguageProductMatching.js';
import { cachedRows } from '../../../lib/searchCatalogCache.js';

// ── 서버 메모리 캐시
if (!global._prodCache) {
  global._prodCache = { data: null, updatedAt: null, ttl: 5 * 60 * 1000 };
}
if (!global._groupCache) {
  global._groupCache = { data: null, updatedAt: null, ttl: 10 * 60 * 1000 };
}


async function loadAllProducts() {
  const result = await query(
    `SELECT
      p.ProdKey, p.ProdCode, p.ProdName, p.DisplayName,
      p.FlowerName, p.CounName,
      COALESCE(NULLIF(LTRIM(RTRIM(p.CountryFlower)),''), ISNULL(p.CounName,'') + ISNULL(p.FlowerName,'')) AS CountryFlower,
      p.Cost, p.OutUnit, p.EstUnit,
      ISNULL(p.BunchOf1Box,0)   AS BunchOf1Box,
      ISNULL(p.SteamOf1Bunch,0) AS SteamOf1Bunch,
      ISNULL(p.SteamOf1Box,0)   AS SteamOf1Box,
      ISNULL(p.Stock,0)         AS Stock,
      ISNULL(pu.UsageCount,0)  AS UsageCount,
      ISNULL(pu.RecentUsageCount,0) AS RecentUsageCount,
      ISNULL(pu.UsageCount,0)  AS orderCount
     FROM Product p
     LEFT JOIN (
       SELECT od.ProdKey,
              COUNT_BIG(*) AS UsageCount,
              SUM(CASE WHEN om.OrderDtm >= DATEADD(year,-2,GETDATE()) THEN 1 ELSE 0 END) AS RecentUsageCount
         FROM OrderDetail od
         LEFT JOIN OrderMaster om ON om.OrderMasterKey=od.OrderMasterKey
        WHERE ISNULL(od.isDeleted,0)=0 AND ISNULL(om.isDeleted,0)=0 AND od.ProdKey IS NOT NULL
        GROUP BY od.ProdKey
     ) pu ON pu.ProdKey=p.ProdKey
     WHERE p.isDeleted = 0
     ORDER BY p.CounName, p.FlowerName, p.ProdName`
  );
  return result.recordset;
}

let lastMapping;
const mappingStats = new WeakMap();
const catalogs = new WeakMap();
async function catalogWithMappings(rows) {
  const snapshot = await readMappingSnapshot(MAPPING_STORE_KEYS.products, lastMapping);
  lastMapping = snapshot;
  const cached = catalogs.get(rows);
  if (cached?.snapshot === snapshot) return cached;
  let stats = mappingStats.get(snapshot);
  if (!stats) {
    stats = buildProductMappingStats(snapshot.document);
    mappingStats.set(snapshot, stats);
  }
  const products = rows.map(product => {
    const item = stats.get(Number(product.ProdKey));
    return { ...product, MappingCount: Number(item?.count || 0), MappingAliases: item?.aliases || [] };
  });
  const catalog = { snapshot, products, searches: new Map() };
  catalogs.set(rows, catalog);
  return catalog;
}

function rankAllProductRows(catalog) {
  return catalog.ranked ??= rankProductSearchOptions('', catalog.products, { limit: catalog.products.length || 200 });
}

function searchProducts(keyword, catalog) {
  if (catalog.searches.has(keyword)) return catalog.searches.get(keyword);
  const result = scoreNaturalLanguageProducts(keyword, catalog.products, { limit: 500 });
  const rankedProducts = [...result.candidates, ...result.alternateCountry].map((item) => ({
    ...item.source,
    MatchScore: Math.round(item.score * 100), MatchConfidence: item.confidence,
    MatchConfidenceBand: item.band, MatchAutoSelectAllowed: item.autoSelect,
    MatchReasons: item.reasons, MatchConflicts: item.conflicts,
    MatchModelVersion: item.modelVersion,
    AlternateCountry: item.conflicts.country,
  }));
  const response = { success: true, count: rankedProducts.length, products: rankedProducts, productMatch: { emptyReason: result.emptyReason, normalized: result.query, modelVersion: result.modelVersion } };
  if (catalog.searches.size >= 12) catalog.searches.delete(catalog.searches.keys().next().value);
  catalog.searches.set(keyword, response);
  return response;
}

export default withAuth(async function handler(req, res) {
  const { q, flower, country, groupsOnly, refresh } = req.query;

  try {
    // ── 모드 1: 그룹 목록만 (groupsOnly=1)
    // 왼쪽 패널 초기 로드용 — 국가+꽃 조합만 반환 (빠름)
    if (groupsOnly === '1') {
      const groups = await cachedRows(global._groupCache, refresh === '1', async () => {
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
        return result.recordset;
      });
      return res.status(200).json({
        success: true,
        groups,
      });
    }

    // ── 모드 2: 특정 그룹 품목 조회 (country + flower 지정)
    // 그룹 클릭 시 해당 그룹만 직접 DB 쿼리 (전체 캐시 로드 없이 빠름)
    if (country && flower && !q) {
      const result = await query(
        `SELECT
          p.ProdKey, p.ProdCode, p.ProdName, p.DisplayName,
          p.FlowerName, p.CounName,
          COALESCE(NULLIF(LTRIM(RTRIM(p.CountryFlower)),''), ISNULL(p.CounName,'') + ISNULL(p.FlowerName,'')) AS CountryFlower,
          p.Cost, p.OutUnit, p.EstUnit,
          ISNULL(p.BunchOf1Box,0)   AS BunchOf1Box,
          ISNULL(p.SteamOf1Bunch,0) AS SteamOf1Bunch,
          ISNULL(p.SteamOf1Box,0)   AS SteamOf1Box,
          ISNULL(p.Stock,0)         AS Stock,
          ISNULL(pu.UsageCount,0) AS UsageCount,
          ISNULL(pu.RecentUsageCount,0) AS RecentUsageCount,
          ISNULL(pu.UsageCount,0) AS orderCount
         FROM Product p
         LEFT JOIN (
           SELECT od.ProdKey,
                  COUNT_BIG(*) AS UsageCount,
                  SUM(CASE WHEN om.OrderDtm >= DATEADD(year,-2,GETDATE()) THEN 1 ELSE 0 END) AS RecentUsageCount
             FROM OrderDetail od
             LEFT JOIN OrderMaster om ON om.OrderMasterKey=od.OrderMasterKey
            WHERE ISNULL(od.isDeleted,0)=0 AND ISNULL(om.isDeleted,0)=0 AND od.ProdKey IS NOT NULL
            GROUP BY od.ProdKey
         ) pu ON p.ProdKey = pu.ProdKey
         WHERE p.isDeleted = 0 AND p.CounName = @country AND p.FlowerName = @flower
         ORDER BY ISNULL(pu.UsageCount,0) DESC, ISNULL(pu.RecentUsageCount,0) DESC, p.ProdName`,
        {
          country: { type: sql.NVarChar, value: country },
          flower:  { type: sql.NVarChar, value: flower },
        }
      );
      const products = rankAllProductRows(await catalogWithMappings(result.recordset));
      return res.status(200).json({ success: true, count: products.length, products });
    }

    const rows = await cachedRows(global._prodCache, refresh === '1', loadAllProducts);
    const catalog = await catalogWithMappings(rows);
    if (q && q.trim()) return res.status(200).json(searchProducts(q.trim(), catalog));
    const products = rankAllProductRows(catalog);
    return res.status(200).json({
      success: true,
      count: products.length,
      products,
    });

  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
