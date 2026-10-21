// 단가 스냅샷 → web_mgmt.PriceSnapshot, 직전 스냅샷과 diff → web_mgmt.PriceChangeHistory(Source='snapshot').
// 원천 SELECT 는 pages/api/master/pricing-matrix.js 와 동일: CustomerProdCost(업체별), Product.Cost(기본). 쓰기는 web_mgmt 만.
import { sql } from '../db.js';
import { ensureMgmtSchema } from './schema.js';
import { mgmtQuery } from './safeQuery.js';
import { diffPriceSnapshots } from './priceDiff.js';

export { diffPriceSnapshots } from './priceDiff.js';

const BATCH = 500;

export async function readCurrentPrices() {
  const [cust, def] = await Promise.all([
    mgmtQuery(`SELECT CustKey, ProdKey, Cost FROM CustomerProdCost WHERE ProdKey IS NOT NULL`),
    mgmtQuery(`SELECT ProdKey, Cost FROM Product WHERE isDeleted=0`),
  ]);
  const rows = [];
  for (const r of cust.recordset) rows.push({ custKey: r.CustKey, prodKey: r.ProdKey, priceKind: 'customer', value: r.Cost });
  for (const r of def.recordset) rows.push({ custKey: null, prodKey: r.ProdKey, priceKind: 'default', value: r.Cost });
  return rows;
}

const num = (v) => (v == null || Number.isNaN(Number(v)) ? 'NULL' : String(Number(v)));

async function insertBatches(table, tuples, columns) {
  for (let i = 0; i < tuples.length; i += BATCH) {
    const chunk = tuples.slice(i, i + BATCH);
    await mgmtQuery(`INSERT INTO web_mgmt.${table} (${columns}) VALUES ${chunk.join(',')}`);
  }
}

export async function takeSnapshot({ actorId = '' } = {}) {
  await ensureMgmtSchema();
  const current = await readCurrentPrices();
  const last = await mgmtQuery(`SELECT ISNULL(MAX(SnapshotKey),0) AS K FROM web_mgmt.PriceSnapshot`);
  const prevKey = Number(last.recordset[0].K || 0);
  let prevRows = [];
  if (prevKey > 0) {
    const p = await mgmtQuery(`SELECT CustKey, ProdKey, PriceKind, Value FROM web_mgmt.PriceSnapshot WHERE SnapshotKey=@k`, { k: { type: sql.Int, value: prevKey } });
    prevRows = p.recordset.map((r) => ({ custKey: r.CustKey, prodKey: r.ProdKey, priceKind: r.PriceKind, value: r.Value }));
  }
  const nextKey = prevKey + 1;
  await insertBatches('PriceSnapshot',
    current.map((r) => `(${nextKey},${num(r.custKey)},${num(r.prodKey)},N'${r.priceKind}',${num(r.value)})`),
    'SnapshotKey, CustKey, ProdKey, PriceKind, Value');
  // 첫 스냅샷은 기준선: 이력을 만들지 않는다(전부 '신규'가 되어 노이즈).
  let changes = [];
  if (prevKey > 0) {
    changes = diffPriceSnapshots(prevRows, current);
    const actor = String(actorId || '').replace(/'/g, "''").slice(0, 100);
    await insertBatches('PriceChangeHistory',
      changes.map((c) => `(${num(c.custKey)},${num(c.prodKey)},N'${c.priceKind}',${num(c.before)},${num(c.after)},N'snapshot',N'${actor}')`),
      'CustKey, ProdKey, PriceKind, BeforeValue, AfterValue, Source, CreatedBy');
  }
  return { snapshotKey: nextKey, rows: current.length, baseline: prevKey === 0, changes: changes.length };
}

export async function lastSnapshotAt() {
  await ensureMgmtSchema();
  const r = await mgmtQuery(`SELECT MAX(SnapshotKey) AS K, MAX(TakenAt) AS T FROM web_mgmt.PriceSnapshot`);
  return { snapshotKey: r.recordset[0].K || null, takenAt: r.recordset[0].T || null };
}

export async function listPriceHistory({ prodKey, custKey, q, limit = 200 } = {}) {
  await ensureMgmtSchema();
  const params = { lim: { type: sql.Int, value: Math.min(Math.max(Number(limit) || 200, 1), 1000) } };
  let where = 'WHERE 1=1';
  if (prodKey) { where += ' AND h.ProdKey=@pk'; params.pk = { type: sql.Int, value: Number(prodKey) }; }
  if (custKey) { where += ' AND h.CustKey=@ck'; params.ck = { type: sql.Int, value: Number(custKey) }; }
  if (q) { where += ' AND (p.ProdName LIKE @q OR c.CustName LIKE @q)'; params.q = { type: sql.NVarChar, value: `%${q}%` }; }
  const r = await mgmtQuery(
    `SELECT TOP (@lim) h.HistoryKey, h.CustKey, c.CustName, h.ProdKey, p.ProdName, h.PriceKind, h.BeforeValue, h.AfterValue, h.Source, h.CreatedAt
       FROM web_mgmt.PriceChangeHistory h
       LEFT JOIN Product p ON p.ProdKey=h.ProdKey
       LEFT JOIN Customer c ON c.CustKey=h.CustKey
       ${where}
      ORDER BY h.CreatedAt DESC, h.HistoryKey DESC`, params);
  return r.recordset;
}
