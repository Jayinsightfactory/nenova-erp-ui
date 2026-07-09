// GET /api/automation/ai/<scope>?week=28-01  — MOYI AI 조회용 요약(읽기 전용, ≤4KB).
//   scope: order | shipment | stock | estimate
// 인증: Authorization: Bearer <MOYI_API_TOKEN>
// 원칙: SELECT 전용 · TOP(LIMIT) 필수 · 원가/이익 등 민감정보 제외(매출·수량만) · 응답 요약(≤4KB).
// 도메인 안전: ViewOrder/ViewShipment 사용(ShipmentDetail 직접·sd.isDeleted 회피). OrderWeek 는 대차수/세부차수 모두 지원.
import { query, sql } from '../../../../lib/db';
import { checkAutomationAuth } from '../../../../lib/automationAuth';

const TOP = 12; // LIMIT
const round = v => Math.round(Number(v || 0));

// week 파라미터: '28'(대차수) 또는 '28-01'(세부차수). 대차수면 LEFT 매칭, 세부면 정확매칭.
function weekClause(alias, raw) {
  const w = String(raw || '').trim();
  if (/^\d{1,2}-\d{2}$/.test(w)) return { sql: `${alias}.OrderWeek = @week`, week: w };
  if (/^\d{1,2}$/.test(w)) return { sql: `LEFT(${alias}.OrderWeek, CHARINDEX('-', ${alias}.OrderWeek + '-') - 1) = @week`, week: w.padStart(2, '0') };
  return null;
}

async function scopeOrder(week) {
  const wc = weekClause('vo', week); if (!wc) throw new Error('week 형식 오류(예: 28 또는 28-01)');
  const tot = await query(
    `SELECT COUNT(DISTINCT vo.CustKey) AS custs, COUNT(*) AS lines,
            SUM(ISNULL(vo.OutQuantity,0)) AS qty
       FROM ViewOrder vo WHERE ${wc.sql}`,
    { week: { type: sql.NVarChar, value: wc.week } });
  const byCF = await query(
    `SELECT TOP (${TOP}) vo.CountryFlower AS cf, COUNT(*) AS lines, SUM(ISNULL(vo.OutQuantity,0)) AS qty
       FROM ViewOrder vo WHERE ${wc.sql} GROUP BY vo.CountryFlower ORDER BY SUM(ISNULL(vo.OutQuantity,0)) DESC`,
    { week: { type: sql.NVarChar, value: wc.week } });
  const t = tot.recordset[0] || {};
  return { scope: 'order', week, customers: t.custs || 0, orderLines: t.lines || 0, totalOutQty: round(t.qty),
    topCountryFlower: byCF.recordset.map(r => ({ name: r.cf, lines: r.lines, qty: round(r.qty) })) };
}

async function scopeShipment(week) {
  const wc = weekClause('vs', week); if (!wc) throw new Error('week 형식 오류(예: 28 또는 28-01)');
  const tot = await query(
    `SELECT COUNT(DISTINCT vs.CustKey) AS custs, COUNT(*) AS lines,
            SUM(ISNULL(vs.Amount,0)+ISNULL(vs.Vat,0)) AS sales,
            SUM(CASE WHEN ISNULL(vs.DetailFix,0)=1 THEN 1 ELSE 0 END) AS fixedLines
       FROM ViewShipment vs WHERE ${wc.sql}`,
    { week: { type: sql.NVarChar, value: wc.week } });
  const byCust = await query(
    `SELECT TOP (${TOP}) vs.CustName AS cust, SUM(ISNULL(vs.Amount,0)+ISNULL(vs.Vat,0)) AS sales
       FROM ViewShipment vs WHERE ${wc.sql} GROUP BY vs.CustName ORDER BY SUM(ISNULL(vs.Amount,0)+ISNULL(vs.Vat,0)) DESC`,
    { week: { type: sql.NVarChar, value: wc.week } });
  const t = tot.recordset[0] || {};
  return { scope: 'shipment', week, customers: t.custs || 0, shipmentLines: t.lines || 0,
    salesTotalVatIncl: round(t.sales), fixedLines: t.fixedLines || 0,
    topCustomers: byCust.recordset.map(r => ({ name: r.cust, sales: round(r.sales) })) };
}

async function scopeEstimate(week) {
  const wc = weekClause('vs', week); if (!wc) throw new Error('week 형식 오류(예: 28 또는 28-01)');
  // 확정(DetailFix=1) 출고 기준 거래처별 매출(견적 확정분)
  const tot = await query(
    `SELECT COUNT(DISTINCT vs.CustKey) AS custs, SUM(ISNULL(vs.Amount,0)+ISNULL(vs.Vat,0)) AS sales
       FROM ViewShipment vs WHERE ${wc.sql} AND ISNULL(vs.DetailFix,0)=1`,
    { week: { type: sql.NVarChar, value: wc.week } });
  const byCust = await query(
    `SELECT TOP (${TOP}) vs.CustName AS cust, SUM(ISNULL(vs.Amount,0)+ISNULL(vs.Vat,0)) AS sales
       FROM ViewShipment vs WHERE ${wc.sql} AND ISNULL(vs.DetailFix,0)=1
       GROUP BY vs.CustName ORDER BY SUM(ISNULL(vs.Amount,0)+ISNULL(vs.Vat,0)) DESC`,
    { week: { type: sql.NVarChar, value: wc.week } });
  const t = tot.recordset[0] || {};
  return { scope: 'estimate', week, confirmedCustomers: t.custs || 0, confirmedSalesVatIncl: round(t.sales),
    topCustomers: byCust.recordset.map(r => ({ name: r.cust, sales: round(r.sales) })) };
}

async function scopeStock() {
  // 현재 품목 재고(Product.Stock) — 낮은/마이너스 상위. 원가 제외, 수량만.
  const low = await query(
    `SELECT TOP (${TOP}) p.ProdName AS name, ISNULL(p.CountryFlower, ISNULL(p.CounName,'')+ISNULL(p.FlowerName,'')) AS cf, ISNULL(p.Stock,0) AS stock
       FROM Product p WHERE ISNULL(p.isDeleted,0)=0 AND ISNULL(p.Stock,0) < 10 ORDER BY ISNULL(p.Stock,0) ASC`, {});
  const neg = await query(`SELECT COUNT(*) AS n FROM Product p WHERE ISNULL(p.isDeleted,0)=0 AND ISNULL(p.Stock,0) < 0`, {});
  return { scope: 'stock', negativeStockItems: neg.recordset[0]?.n || 0,
    lowStock: low.recordset.map(r => ({ name: r.name, cf: r.cf, stock: round(r.stock) })) };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'GET only' });
  const auth = checkAutomationAuth(req);
  if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });

  const scope = String(req.query.scope || '').toLowerCase();
  const week = req.query.week;
  try {
    let out;
    if (scope === 'order') out = await scopeOrder(week);
    else if (scope === 'shipment') out = await scopeShipment(week);
    else if (scope === 'estimate') out = await scopeEstimate(week);
    else if (scope === 'stock') out = await scopeStock();
    else return res.status(404).json({ success: false, error: `알 수 없는 scope: ${scope} (order|shipment|stock|estimate)` });

    const payload = { success: true, app: 'nenovaweb', generatedAt: new Date().toISOString(), ...out };
    const json = JSON.stringify(payload);
    if (json.length > 4096) return res.status(200).send(json.slice(0, 4096)); // 안전상한(요약 원칙)
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).send(json);
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}
