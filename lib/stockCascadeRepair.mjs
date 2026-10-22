import { stockRepairDigest } from './historicalStockRepair.mjs';
export { stockRepairDigest };
const fail = message => { throw new Error(message); };
const coordinate = row => `${row.OrderYear}/${row.OrderWeek}`;
const round = n => Math.sign(n) * Math.round((Math.abs(n) + Number.EPSILON) * 100) / 100;
const finite = n => n != null && n !== '' && Number.isFinite(Number(n));

// Native-only replay: no new compensating history, no Product.Stock mutation.
export function planStockCascadeRepair(state, scope) {
  if (!/^20\d{2}$/.test(scope?.year) || +scope.year <= 2025
    || !/^(0[1-9]|[1-4]\d|5[0-3])-\d{2}$/.test(scope.startWeek)
    || !Array.isArray(scope.prodKeys) || !scope.prodKeys.length || scope.prodKeys.length > 20
    || new Set(scope.prodKeys).size !== scope.prodKeys.length
    || scope.prodKeys.some(k => !Number.isInteger(k) || k <= 0)) fail('CASCADE_SCOPE_INVALID');
  const masters = state.masters.filter(r => r.OrderYearWeek != null)
    .sort((a,b) => String(a.OrderYearWeek).localeCompare(String(b.OrderYearWeek)) || a.StockKey-b.StockKey);
  const first = masters.findIndex(m => m.OrderYear === scope.year && m.OrderWeek === scope.startWeek);
  if (first < 1) fail('CASCADE_ANCHOR_REQUIRED');
  const relevant = masters.slice(first-1), legacy = new Set(scope.nativeLegacyPeriods || []);
  if (new Set(relevant.map(coordinate)).size !== relevant.length
    || new Set(relevant.map(r => r.OrderYearWeek)).size !== relevant.length) fail('CASCADE_MASTER_AMBIGUOUS');
  for (const m of relevant) {
    if ((!/^\d{2}-\d{2}$/.test(m.OrderWeek) && !legacy.has(coordinate(m)))
      || String(m.OrderYearWeek) !== m.OrderYear + m.OrderWeek.replace('-','')) fail('CASCADE_LEGACY_REVIEW_REQUIRED');
  }
  if ([...state.incoming,...state.outgoing,...state.adjustments].some(r => legacy.has(coordinate(r)))) fail('CASCADE_LEGACY_MOVEMENT');
  const stocks = new Map();
  for (const r of state.stocks) {
    const key = `${r.StockKey}/${r.ProdKey}`;
    if (stocks.has(key) || !finite(r.Stock)) fail('CASCADE_STOCK_AMBIGUOUS');
    stocks.set(key,Number(r.Stock));
  }
  const getStock = (m,k) => { const value=stocks.get(`${m.StockKey}/${k}`); if(value===undefined)fail('CASCADE_STOCK_MISSING');return value; };
  const expected = [];
  for (const pk of scope.prodKeys) {
    const products = state.products.filter(p => p.ProdKey === pk && !p.isDeleted);
    if (products.length !== 1) fail('CASCADE_PRODUCT_INVALID');
    let previous = getStock(masters[first-1],pk);
    for (const m of masters.slice(first)) {
      const match = r => String(r.OrderYear) === m.OrderYear && r.OrderWeek === m.OrderWeek && r.ProdKey === pk;
      const quantity = source => round(source.filter(match).reduce((n,r) => {
        if(!finite(r.OutQuantity)) fail('CASCADE_QUANTITY_MISSING'); return n+Number(r.OutQuantity);
      },0));
      const history = state.adjustments.filter(match).filter(r => r.TypeMatches > 0);
      if(history.some(r => r.TypeMatches !== 1 || !finite(r.BeforeValue) || !finite(r.AfterValue))) fail('CASCADE_HISTORY_AMBIGUOUS');
      const incoming=quantity(state.incoming), outgoing=quantity(state.outgoing);
      const adjusted=round(history.reduce((n,r) => n+Number(r.AfterValue)-Number(r.BeforeValue),0));
      const after=round(previous+incoming-outgoing+adjusted),before=getStock(m,pk);
      if(after < 0 && after < before) fail('CASCADE_NEW_NEGATIVE');
      expected.push({ StockKey:m.StockKey,ProdKey:pk,OrderYear:m.OrderYear,OrderWeek:m.OrderWeek,
        before,after,previous,incoming,outgoing,adjusted });
      previous=after;
    }
  }
  return { scope, sourceHash:stockRepairDigest(state), expected };
}

export function verifyStockCascadeRepair(before,after,plan) {
  for(const field of ['masters','products','incoming','outgoing','adjustments','protected','procedureHash'])
    if(stockRepairDigest(before[field])!==stockRepairDigest(after[field])) fail(`CASCADE_PROTECTED_CHANGED:${field}`);
  const expected=new Map(plan.expected.map(r=>[`${r.StockKey}/${r.ProdKey}`,r.after]));
  const originals=new Map(before.stocks.map(r=>[`${r.StockKey}/${r.ProdKey}`,r.Stock]));
  if(before.stocks.length!==after.stocks.length)fail('CASCADE_CARDINALITY_CHANGED');
  const seen=new Set();
  for(const r of after.stocks){const key=`${r.StockKey}/${r.ProdKey}`, value=expected.get(key)??originals.get(key);
    if(seen.has(key)||value===undefined||!finite(r.Stock)||Math.abs(Number(r.Stock)-value)>1e-7)fail('CASCADE_READBACK_FAILED');seen.add(key);
  }
  return { changedSnapshots:plan.expected.filter(r=>r.before!==r.after).length,
    checkedSnapshots:plan.expected.length, protectedPreserved:true, addedHistory:0 };
}
