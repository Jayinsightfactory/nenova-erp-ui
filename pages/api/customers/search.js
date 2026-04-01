// pages/api/customers/search.js
// 거래처 검색 API — 서버 메모리 캐시 적용
// 수정이력: 2026-03-27 — TOP 제한 개선
// 수정이력: 2026-03-27 — 서버 메모리 캐시 적용 (10분 유지)

import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

// ── 서버 메모리 캐시
if (!global._custCache) {
  global._custCache = {
    data: null,
    updatedAt: null,
    ttl: 10 * 60 * 1000, // 10분 (거래처는 품목보다 변경 빈도 낮음)
  };
}

const cache = global._custCache;

function isCacheValid() {
  return cache.data && cache.updatedAt && (Date.now() - cache.updatedAt < cache.ttl);
}

async function fetchAllCustomers() {
  const result = await query(
    `SELECT
      CustKey, CustCode, CustName, CustArea, Manager,
      Tel, Mobile, BaseOutDay, OrderCode
     FROM Customer
     WHERE isDeleted = 0
     ORDER BY CustArea, CustName`
  );
  return result.recordset;
}

export default withAuth(async function handler(req, res) {
  const { q, refresh } = req.query;

  try {
    // 캐시 갱신
    if (refresh === '1' || !isCacheValid()) {
      cache.data = await fetchAllCustomers();
      cache.updatedAt = Date.now();
    }

    let customers = cache.data;

    // 검색어로 필터링 (캐시 데이터에서)
    if (q && q.trim()) {
      const keyword = q.toLowerCase();
      customers = customers.filter(c =>
        c.CustName?.toLowerCase().includes(keyword) ||
        c.CustCode?.toLowerCase().includes(keyword) ||
        c.Manager?.toLowerCase().includes(keyword) ||
        c.OrderCode?.toLowerCase().includes(keyword)
      );
      // 검색어 있을 때는 상위 50개만
      customers = customers.slice(0, 50);
    }

    return res.status(200).json({
      success: true,
      count: customers.length,
      cached: isCacheValid(),
      customers,
    });
  } catch (err) {
    cache.data = null;
    cache.updatedAt = null;
    return res.status(500).json({ success: false, error: err.message });
  }
});
