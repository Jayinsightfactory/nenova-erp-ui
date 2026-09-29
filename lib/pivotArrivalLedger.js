import { query, sql } from './db';
import { RAUM_PNL_ARRIVAL_REFERENCE_SQL } from './raumPnlArrivalReference';
import { buildPivotArrivalReferences, pivotArrivalWeek } from './pivotArrivalReference';

// Reuse the canonical current-ledger/explicit source-bundle query. Bound years and
// product keys come only from the already-authorized native report rows.
export async function loadPivotArrivalLedger(rows, tQuery = query) {
  const byYear = new Map();
  for (const row of rows) {
    const year = String(row.OrderYear), week = pivotArrivalWeek(row.OrderWeek), pk = Number(row.ProdKey);
    if (!/^\d{4}$/.test(year) || !week || !Number.isSafeInteger(pk) || pk <= 0) continue;
    if (!byYear.has(year)) byYear.set(year, { major: 0, products: new Set() });
    const group = byYear.get(year);
    group.major = Math.max(group.major, Math.floor(week / 100)); group.products.add(pk);
  }
  const sources = [];
  for (const [year, { major, products }] of byYear) {
    const keys = [...products];
    for (let start = 0; start < keys.length; start += 500) {
      const params = { yr: { type: sql.NVarChar, value: year }, major: { type: sql.Int, value: major } };
      const names = keys.slice(start, start + 500).map((value, i) => { params[`pk${i}`] = { type: sql.Int, value }; return `@pk${i}`; });
      const statement = RAUM_PNL_ARRIVAL_REFERENCE_SQL
        .replace('SELECT l.OrderWeek', 'SELECT l.OrderYear, l.CountryName, l.RawJson, l.OrderWeek')
        .replace('AND ISNULL(l.SelectedArrivalCostKRW,0)>0', 'AND l.SelectedArrivalCostKRW IS NOT NULL AND l.SelectedArrivalCostKRW>=0')
        .replace('__PROD_KEYS__', names.join(','));
      sources.push(...(await tQuery(statement, params)).recordset);
    }
  }
  return buildPivotArrivalReferences(rows, sources);
}
