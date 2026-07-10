// GET /api/ecount/reconcile-timing?month=2026-06&cust=아이엠
//   "수입품 전표 타이밍" 차이를 구체적으로 설명: 같은 수입품을
//   웹은 실제 출고차수에 분산 기록 / ECOUNT는 정산·결제일(전표일자)에 몰아서 계상 → 월 대사 시 차이.
//   웹 전체(넓은 기간) 수량이 ECOUNT 월 수량 이상이면 "누락 아님 = 타이밍 차이"임을 증명한다.
import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

const norm = (s) => String(s || '')
  .replace(/[（(][^)）]*[)）]/g, '').replace(/\s+/g, '').toUpperCase().replace(/[^A-Z0-9가-힣]/g, '');
const IMPORT_RE = /호접란|ORCHID|수입|IMPORT/i;
const confirmExpr = (col) => `DATEADD(DAY, (7 - (DATEDIFF(DAY, '19000102', ${col}) % 7)) % 7, CONVERT(DATE, ${col}))`;

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const month = String(req.query.month || '').trim();
  const cust = String(req.query.cust || '').trim();
  const mm = month.match(/^(\d{4})-(\d{2})$/);
  if (!mm || !cust) return res.status(400).json({ success: false, error: 'month=YYYY-MM & cust 필요' });
  const y = Number(mm[1]), mo = Number(mm[2]);
  const monLabel = `${mm[1]}/${mm[2]}`;
  // 웹 조회 창: 대상월 앞 2개월 ~ 뒤 1개월 (수입품이 여러 차수에 걸쳐 있어 넓게)
  const winFrom = new Date(Date.UTC(y, mo - 3, 1));
  const winTo = new Date(Date.UTC(y, mo + 1, 1));
  const iso = (d) => d.toISOString().slice(0, 10);

  try {
    const snapKey = req.query.snapshotKey
      ? Number(req.query.snapshotKey)
      : (await query(`SELECT TOP 1 SnapshotKey FROM WebEcountSnapshot WHERE Dataset='sales' ORDER BY SnapshotKey DESC`)).recordset[0]?.SnapshotKey;

    // ── ECOUNT: 해당 거래처, 대상월, 수입품 → 품목별·일자별
    const ecRows = snapKey ? (await query(
      `SELECT RefDate, Payload FROM WebEcountRow
        WHERE SnapshotKey=@sk AND ISNULL(IsSubtotal,0)=0 AND CustName=@cust AND RefDate LIKE @pfx`,
      { sk: { type: sql.Int, value: snapKey }, cust: { type: sql.NVarChar, value: cust }, pfx: { type: sql.NVarChar, value: `${monLabel}%` } }
    )).recordset : [];
    const ecProd = new Map(); // normProd → { name, total, byDate:Map(date→{qty,supply}) }
    for (const r of ecRows) {
      let o; try { o = JSON.parse(r.Payload); } catch { continue; }
      if (!IMPORT_RE.test(o.prodName || '')) continue;
      const k = norm(o.prodName);
      if (!ecProd.has(k)) ecProd.set(k, { name: o.prodName, total: 0, byDate: new Map() });
      const g = ecProd.get(k); const s = Number(o.supplyAmt || 0);
      g.total += s;
      const dt = String(r.RefDate || '').slice(0, 10);
      const cur = g.byDate.get(dt) || { qty: 0, supply: 0 };
      cur.qty += Number(o.qty || 0); cur.supply += s;
      g.byDate.set(dt, cur);
    }

    // ── 웹: 해당 거래처, 넓은 기간, 수입품(전차수) → 품목별·차수별
    const webRows = (await query(
      `SELECT sm.OrderWeek AS week, p.ProdName AS prod,
              CONVERT(NVARCHAR(10), ${confirmExpr('sd.ShipmentDtm')}, 120) AS confirmDate,
              CONVERT(NVARCHAR(10), sd.ShipmentDtm, 120) AS outDate,
              SUM(sd.OutQuantity) AS qty, SUM(ISNULL(sd.Amount,0)) AS supply
         FROM ShipmentMaster sm
         JOIN ShipmentDetail sd ON sm.ShipmentKey = sd.ShipmentKey
         JOIN Customer c ON sm.CustKey = c.CustKey
         JOIN Product p ON sd.ProdKey = p.ProdKey
        WHERE sm.isDeleted = 0 AND ISNULL(sd.isFix,0) = 1 AND c.CustName = @cust
          AND sd.ShipmentDtm >= @from AND sd.ShipmentDtm < @to
        GROUP BY sm.OrderWeek, p.ProdName, ${confirmExpr('sd.ShipmentDtm')}, CONVERT(NVARCHAR(10), sd.ShipmentDtm, 120)`,
      { cust: { type: sql.NVarChar, value: cust }, from: { type: sql.Date, value: iso(winFrom) }, to: { type: sql.Date, value: iso(winTo) } }
    )).recordset;
    const webProd = new Map();
    for (const r of webRows) {
      if (!IMPORT_RE.test(r.prod || '')) continue;
      const k = norm(r.prod);
      if (!webProd.has(k)) webProd.set(k, { name: r.prod, windowTotal: 0, inMonthTotal: 0, byWeek: [] });
      const g = webProd.get(k);
      g.windowTotal += Number(r.supply || 0);
      const inMonth = String(r.confirmDate || '').slice(0, 7) === `${mm[1]}-${mm[2]}`;
      if (inMonth) g.inMonthTotal += Number(r.supply || 0);
      g.byWeek.push({ week: r.week, confirmDate: r.confirmDate, outDate: r.outDate, qty: Number(r.qty || 0), supply: Math.round(Number(r.supply || 0)), inMonth });
    }

    const round = (v) => Math.round(Number(v || 0));
    const keys = new Set([...ecProd.keys(), ...webProd.keys()]);
    const products = [...keys].map((k) => {
      const e = ecProd.get(k), w = webProd.get(k);
      const ecTotal = round(e?.total || 0);
      const webWindow = round(w?.windowTotal || 0);
      const webInMonth = round(w?.inMonthTotal || 0);
      return {
        name: (e?.name || w?.name || ''),
        ecountMonth: ecTotal,
        webInMonth,
        webWindow,
        diff: ecTotal - webInMonth,
        // 증명: 웹 전체(창) ≥ ECOUNT 월 → 누락 없이 타이밍만 다름
        noMissing: webWindow >= ecTotal,
        ecountByDate: [...(e?.byDate || new Map()).entries()].map(([date, v]) => ({ date, qty: round(v.qty), supply: round(v.supply) })).sort((a, b) => a.date < b.date ? -1 : 1),
        webByWeek: (w?.byWeek || []).sort((a, b) => (a.confirmDate < b.confirmDate ? -1 : 1)),
      };
    }).filter((p) => Math.abs(p.diff) >= 1000 || p.ecountMonth > 0).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

    const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
    return res.status(200).json({
      success: true, cust, month, snapshotKey: snapKey,
      totals: {
        ecountMonth: sum(products, (p) => p.ecountMonth),
        webInMonth: sum(products, (p) => p.webInMonth),
        webWindow: sum(products, (p) => p.webWindow),
        diff: sum(products, (p) => p.diff),
      },
      window: { from: iso(winFrom), to: iso(winTo) },
      products,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
