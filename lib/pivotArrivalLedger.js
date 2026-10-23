import { query, sql } from './db';
import { RAUM_PNL_ARRIVAL_REFERENCE_SQL } from './raumPnlArrivalReference';
import { buildPivotArrivalReferences, pivotArrivalWeek } from './pivotArrivalReference';
import { loadLatestArrivalReferences, latestArrivalKey, latestArrivalScalar } from './latestArrivalReference';
import { pivotArrivalKey } from './pivotArrivalReference';
import { compareHotelArrival } from './hotelArrivalDisplay';

// Reuse the canonical current-ledger/explicit source-bundle query. Bound years and
// product keys come only from the already-authorized native report rows.
export async function loadPivotArrivalLedger(rows, tQuery = query) {
  const result = {};
  const years = [...new Set(rows.map(row=>String(row.OrderYear)).filter(year=>/^\d{4}$/.test(year)))];
  for (const orderYear of years) {
    const targets=rows.filter(row=>String(row.OrderYear)===orderYear);
    const productRows=await tQuery('SELECT ProdKey,OutUnit FROM dbo.Product WHERE ISNULL(isDeleted,0)=0');
    const units=new Map(productRows.recordset.map(p=>[Number(p.ProdKey),p.OutUnit]));
    const items=targets.map(row=>({prodKey:Number(row.ProdKey),unit:String(units.get(Number(row.ProdKey)) || '')}));
    const refs=await loadLatestArrivalReferences({orderYear,items},tQuery);
    for(let i=0;i<targets.length;i++) {
      const values=refs[latestArrivalKey(items[i])] || [];
      const scalar=latestArrivalScalar(values);
      result[pivotArrivalKey(targets[i])]=scalar ? {arrivalCost:scalar.arrivalCost,sourceWeek:scalar.arrivalWeek,unit:scalar.displayUnit,isFallback:false,
        fxSources:values.map(ref=>{
          const probe=ref.currency ? compareHotelArrival(ref,{[ref.currency]:Number(ref.exchangeRate)+1}) : {applied:false};
          const foreign=probe.applied ? probe.cost-ref.cost : null;
          return {currency:ref.currency,originalRate:ref.exchangeRate,originalCost:ref.cost,
            foreignPerUnit:foreign,fixedKRW:foreign!=null ? ref.cost-foreign*ref.exchangeRate : null,
            reason:probe.applied ? '' : '원본 비용 구성 확인 필요'};
        })} : null;
    }
  }
  return result;
}

// Historical as-of helper retained for explicit historical consumers/tests only.
export async function loadHistoricalPivotArrivalLedger(rows, tQuery = query) {
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
      const params = { yr: { type: sql.NVarChar, value: year }, major: { type: sql.Int, value: major }, history:{type:sql.Bit,value:false} };
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
