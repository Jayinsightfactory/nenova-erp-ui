// ecount 스키마 현황(읽기 전용). GET. 데이터셋별 배치/행 수·최신 기간·대조 뷰 요약.
import { withAuth } from '../../../lib/auth.js';
import { denyIfNotMgmtAdmin } from '../../../lib/mgmt/access.js';
import { query, sql } from '../../../lib/db.js';

const VIEW_SUMMARY = {
  cmp_sales_daily: `SELECT COUNT(*) AS total, SUM(CASE WHEN ABS(Diff) > 1 THEN 1 ELSE 0 END) AS diffCnt, SUM(ABS(Diff)) AS diffAmt,
      SUM(CASE WHEN MatchState = N'ecount_only' THEN 1 ELSE 0 END) AS ecountOnly, SUM(CASE WHEN MatchState = N'ours_only' THEN 1 ELSE 0 END) AS oursOnly FROM ecount.cmp_sales_daily`,
  cmp_sales_week: `SELECT COUNT(*) AS total, SUM(CASE WHEN ABS(Diff) > 1 THEN 1 ELSE 0 END) AS diffCnt, SUM(CASE WHEN ABS(Diff) <= 1 THEN 1 ELSE 0 END) AS zeroDiffCnt, SUM(ABS(Diff)) AS diffAmt,
      SUM(CASE WHEN MatchState = N'ecount_only' THEN 1 ELSE 0 END) AS ecountOnly, SUM(CASE WHEN MatchState = N'ours_only' THEN 1 ELSE 0 END) AS oursOnly FROM ecount.cmp_sales_week`,
  cmp_ar_balance: `SELECT COUNT(*) AS total, SUM(CASE WHEN ABS(Diff) > 1 THEN 1 ELSE 0 END) AS diffCnt, SUM(ABS(Diff)) AS diffAmt,
      SUM(CASE WHEN MatchState = N'ecount_only' THEN 1 ELSE 0 END) AS ecountOnly, SUM(CASE WHEN MatchState = N'ours_only' THEN 1 ELSE 0 END) AS oursOnly FROM ecount.cmp_ar_balance`,
  cmp_customer_master: `SELECT COUNT(*) AS total, SUM(CASE WHEN Matched = 0 THEN 1 ELSE 0 END) AS diffCnt, CAST(100.0 * SUM(Matched) / NULLIF(COUNT(*), 0) AS DECIMAL(5,1)) AS matchPct FROM ecount.cmp_customer_master`,
  cmp_product_master: `SELECT COUNT(*) AS total, SUM(CASE WHEN Matched = 0 THEN 1 ELSE 0 END) AS diffCnt, CAST(100.0 * SUM(Matched) / NULLIF(COUNT(*), 0) AS DECIMAL(5,1)) AS matchPct FROM ecount.cmp_product_master`,
};

export default withAuth(async function handler(req, res) {
  if (denyIfNotMgmtAdmin(req, res)) return;
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }
  try {
    const exists = await query(`SELECT OBJECT_ID(N'ecount.LoadBatch', N'U') AS id`);
    if (!exists.recordset[0].id) return res.status(200).json({ success: true, initialized: false, datasets: [], views: {} });
    const ds = await query(
      `SELECT d.PrgId, d.MenuName, d.Category, COUNT(b.BatchKey) AS batches, ISNULL(SUM(b.InsertCnt), 0) AS rowsInserted,
              ISNULL(SUM(b.DedupCnt), 0) AS rowsDeduped, MIN(b.PeriodFrom) AS periodFrom, MAX(b.PeriodTo) AS periodTo, MAX(b.LoadedAt) AS lastLoadedAt
       FROM ecount.Dataset d LEFT JOIN ecount.LoadBatch b ON b.PrgId = d.PrgId
       WHERE d.IsActive = 1 GROUP BY d.PrgId, d.MenuName, d.Category ORDER BY d.PrgId`,
    );
    const views = {};
    for (const [name, q] of Object.entries(VIEW_SUMMARY)) {
      const ok = await query(`SELECT OBJECT_ID(@v, N'V') AS id`, { v: { type: sql.NVarChar, value: `ecount.${name}` } });
      if (!ok.recordset[0].id) { views[name] = null; continue; }
      try { views[name] = (await query(q)).recordset[0]; } catch (e) { views[name] = { error: e.message }; }
    }
    return res.status(200).json({ success: true, initialized: true, datasets: ds.recordset, views });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
