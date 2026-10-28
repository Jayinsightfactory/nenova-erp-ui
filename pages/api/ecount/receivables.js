// ECOUNT 채권 요약은 스냅샷을 읽고, 매출 평균은 확정 출고 원장에서 읽기 전용으로 계산한다.
import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { isLedgerAdmin } from '../../../lib/ecountCustomerLedgerPolicy.cjs';
import { averageSalesWindow, attachCustomerAverages } from '../../../lib/ecountReceivablesPolicy.cjs';

const agingNum = (value) => { const match = String(value || '').match(/-?\d+/); return match ? Number(match[0]) : 0; };
const BUCKETS = [
  { key: 'b1', label: '1개월 이하', min: -999, max: 1, color: '#16a34a' },
  { key: 'b2', label: '2~3개월', min: 2, max: 3, color: '#ca8a04' },
  { key: 'b3', label: '4~6개월', min: 4, max: 6, color: '#ea580c' },
  { key: 'b4', label: '7~12개월', min: 7, max: 12, color: '#dc2626' },
  { key: 'b5', label: '13개월 이상', min: 13, max: 9999, color: '#7f1d1d' },
];
const bucketOf = (months) => BUCKETS.find((bucket) => months >= bucket.min && months <= bucket.max) || BUCKETS[0];
const roundWon = (value) => Math.round(Number(value || 0));

async function loadCustomers() {
  const result = await query(`
    SELECT c.CustKey, c.CustName, CASE WHEN ISNULL(c.isDeleted,0)=0 THEN 1 ELSE 0 END AS active,
           owner.UserID AS managerUserId, owner.UserName AS managerUserName, owner.matches AS managerMatchCount
      FROM dbo.Customer c
      CROSS APPLY (
        SELECT COUNT(*) AS matches, MIN(u.UserID) AS UserID, MIN(u.UserName) AS UserName
        FROM dbo.UserInfo u
        WHERE ISNULL(u.isDeleted,0)=0 AND NULLIF(LTRIM(RTRIM(c.Manager)),'') IS NOT NULL
          AND (LTRIM(RTRIM(c.Manager))=u.UserID OR LTRIM(RTRIM(c.Manager))=u.UserName)
      ) owner`);
  return result?.recordset || [];
}

async function loadAverageMetrics(window) {
  const result = await query(`
    WITH customerSales AS (
      SELECT sm.CustKey, TRY_CONVERT(INT, sm.OrderYear) AS OrderYear,
             TRY_CONVERT(INT, LEFT(sm.OrderWeek, CHARINDEX(N'-', sm.OrderWeek + N'-') - 1)) AS MajorWeek,
             SUM(ISNULL(sd.Amount, 0) + ISNULL(sd.Vat, 0)) AS cycleSales
      FROM dbo.ShipmentMaster sm
      JOIN dbo.ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
      JOIN dbo.Customer c ON c.CustKey=sm.CustKey AND ISNULL(c.isDeleted,0)=0
      JOIN dbo.Product p ON p.ProdKey=sd.ProdKey AND ISNULL(p.isDeleted,0)=0
      WHERE ISNULL(sm.isDeleted,0)=0 AND ISNULL(sd.isFix,0)=1
        AND sd.ShipmentDtm >= @from AND sd.ShipmentDtm < @to
      GROUP BY sm.CustKey, TRY_CONVERT(INT, sm.OrderYear),
               TRY_CONVERT(INT, LEFT(sm.OrderWeek, CHARINDEX(N'-', sm.OrderWeek + N'-') - 1))
    ), totals AS (
      SELECT CustKey, SUM(cycleSales) AS totalSales
      FROM customerSales GROUP BY CustKey
    ), cycles AS (
      SELECT CustKey, COUNT(*) AS cycleCount, SUM(cycleSales) AS cycleSales
      FROM customerSales
      WHERE OrderYear IS NOT NULL AND MajorWeek BETWEEN 1 AND 53 AND cycleSales <> 0
      GROUP BY CustKey
    )
    SELECT t.CustKey, t.totalSales / 12.0 AS avgSalesMonthly,
           CASE WHEN ISNULL(c.cycleCount,0)=0 THEN NULL ELSE c.cycleSales / c.cycleCount END AS avgSalesCycle,
           ISNULL(c.cycleCount,0) AS cycleCount
    FROM totals t LEFT JOIN cycles c ON c.CustKey=t.CustKey`, {
    from: { type: sql.Date, value: window.from },
    to: { type: sql.Date, value: window.to },
  });
  return result?.recordset || [];
}

export default withAuth(async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') return res.status(405).end();
  if (!req.user?.userId) return res.status(401).json({ success: false, error: 'LOGIN_REQUIRED' });
  try {
    const admin = isLedgerAdmin(req.user);
    const window = averageSalesWindow();
    const scope = admin ? 'all' : 'assigned';
    let snapshot;
    if (req.query.snapshotKey !== undefined) {
      const key = Number(req.query.snapshotKey);
      if (!Number.isSafeInteger(key) || key < 1) return res.status(400).json({ success: false, error: 'INVALID_SNAPSHOT' });
      snapshot = (await query(
        `SELECT SnapshotKey, CONVERT(varchar(19),TakenAt,120) AS takenAt FROM dbo.WebEcountSnapshot WHERE SnapshotKey=@sk AND Dataset='ar'`,
        { sk: { type: sql.Int, value: key } },
      )).recordset[0];
    } else {
      snapshot = (await query(`SELECT TOP 1 SnapshotKey, CONVERT(varchar(19),TakenAt,120) AS takenAt FROM dbo.WebEcountSnapshot WHERE Dataset='ar' ORDER BY SnapshotKey DESC`)).recordset[0];
    }
    if (!snapshot) return res.status(200).json({ success: true, noEcount: true, scope, rows: [], averageWindow: window });

    const [customers, averages, ec] = await Promise.all([
      loadCustomers(),
      loadAverageMetrics(window),
      query(`SELECT CustName, Payload FROM dbo.WebEcountRow WHERE SnapshotKey=@sk AND ISNULL(IsSubtotal,0)=0`,
        { sk: { type: sql.Int, value: snapshot.SnapshotKey } }),
    ]);
    const customerMetrics = new Map(customers.map((customer) => [Number(customer.CustKey), { avgSalesMonthly: 0, avgSalesCycle: null, cycleCount: 0 }]));
    for (const metric of averages) customerMetrics.set(Number(metric.CustKey), {
      avgSalesMonthly: Number(metric.avgSalesMonthly) || 0,
      avgSalesCycle: metric.avgSalesCycle == null ? null : Number(metric.avgSalesCycle) || 0,
      cycleCount: Number(metric.cycleCount) || 0,
    });

    const sourceRows = [];
    for (const row of ec.recordset || []) {
      let payload;
      try { payload = JSON.parse(row.Payload); } catch { continue; }
      const balance = roundWon(payload.balance);
      const sales = roundWon(payload.salesTotal);
      const receipt = roundWon(payload.receiptTotal);
      const etcDiff = roundWon(payload.etcDiff);
      if (balance === 0 && sales === 0 && receipt === 0 && etcDiff === 0) continue;
      const agingMonths = agingNum(payload.agingMonth);
      const bucket = bucketOf(agingMonths);
      sourceRows.push({
        name: row.CustName || payload.custName || '(미지정)',
        sales, receipt, etcDiff, balance, agingMonths,
        agingRaw: payload.agingMonth || '', bucket: bucket.key, bucketLabel: bucket.label, color: bucket.color,
      });
    }
    const rows = attachCustomerAverages(sourceRows, customers, customerMetrics, {
      userId: req.user.userId, admin,
    }).sort((a, b) => b.balance - a.balance);
    const posBal = rows.filter((row) => row.balance > 0);
    const overdue = (min) => {
      const found = posBal.filter((row) => row.agingMonths >= min);
      return { count: found.length, amount: found.reduce((sum, row) => sum + row.balance, 0) };
    };
    const aging = BUCKETS.map((bucket) => {
      const found = rows.filter((row) => row.bucket === bucket.key && row.balance > 0);
      return { key: bucket.key, label: bucket.label, color: bucket.color, count: found.length,
        amount: found.reduce((sum, row) => sum + row.balance, 0) };
    });
    return res.status(200).json({
      success: true, snapshotKey: snapshot.SnapshotKey, takenAt: snapshot.takenAt || '', scope,
      averageWindow: window,
      summary: {
        totalBalance: rows.reduce((sum, row) => sum + row.balance, 0), posCount: posBal.length,
        overdue4: overdue(4), overdue7: overdue(7), overdue13: overdue(13),
      },
      aging, rows,
    });
  } catch {
    return res.status(500).json({ success: false, error: 'RECEIVABLES_UNAVAILABLE' });
  }
});
