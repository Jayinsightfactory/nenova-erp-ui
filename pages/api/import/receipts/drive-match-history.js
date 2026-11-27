import { withAuth } from '../../../../lib/auth';
import { query, sql } from '../../../../lib/db';
import { canManageInvoiceReceipt } from '../../../../lib/invoiceReceiptAccess';
import { loadDriveMatchHistory } from '../../../../lib/driveMatchHistory';

// 업무드라이브 원가자료 + 최근 입고 농장별 품목 이력 조회(읽기 전용 · 5분 메모리 TTL 캐시).
const CACHE_TTL_MS = 5 * 60 * 1000;
const historyCache = new Map();

export default withAuth(async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ success: false, error: '조회만 가능합니다.' }); }
  if (!canManageInvoiceReceipt(req.user)) return res.status(403).json({ success: false, error: '수입부 업무 권한이 필요합니다.' });
  const country = String(req.query.country || '').toUpperCase();
  const includeWarehouse = req.query.includeWarehouse === '1';
  const cacheKey = `${country}:${includeWarehouse ? '1' : '0'}`;
  const cached = historyCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return res.status(200).json({ success: true, ...cached.data, cached: true });
  }
  try {
    const data = await loadDriveMatchHistory({ queryFn: query, types: sql, country, includeWarehouse });
    if (historyCache.size > 32) historyCache.clear();
    historyCache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    return res.status(200).json({ success: true, ...data });
  }
  catch (error) { return res.status(error.statusCode === 400 ? 400 : 503).json({ success: false, error: error.statusCode === 400 ? error.message : '과거 매칭 이력을 조회하지 못했습니다. 후보는 이름 비교만으로 표시합니다.' }); }
});
