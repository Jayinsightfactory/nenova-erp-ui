/** Read-only quantity policy for the four country-average inventory valuations.
 * Stock is ProductStock.Stock in OutUnit, never EstUnit. No amount or ledger is changed.
 */
export const COUNTRY_AVERAGE_UNITS = Object.freeze({
  '네덜란드': '송이', '태국': '송이', '중국': '단', '에콰도르': '송이',
});

const numeric = value => value == null || String(value).trim() === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const same = (a, b) => Math.abs(a - b) <= Math.max(1e-7, Math.abs(a) * 1e-8, Math.abs(b) * 1e-8);
const unit = value => {
  const raw = String(value || '').trim().toUpperCase();
  if (['박스', 'BOX', 'BX'].includes(raw)) return '박스';
  if (['단', 'BUNCH', 'BUN'].includes(raw)) return '단';
  if (['송이', 'STEM', 'EA', '스팀', '대'].includes(raw)) return '송이';
  return raw;
};
const rank = value => {
  const match = String(value || '').trim().match(/^(\d{1,2})-(\d+)$/);
  return match && Number(match[1]) >= 1 && Number(match[1]) <= 53
    && Number(match[2]) >= 1 && Number(match[2]) <= 99
    ? Number(match[1]) * 10000 + Number(match[2]) : null;
};
const sameYear = (row, year) => String(row.OrderYear) === String(year);
const stockable = row => !/(?:chargeable|gross)\s*weig(?:ht|th)|운송료|현지상차\s*운임|SERVICE\s*FEE/i.test(String(row.ProdName || ''));
const sourceRef = row => ({ prodKey: row.ProdKey, orderYear: String(row.OrderYear), orderWeek: row.OrderWeek,
  ...(row.WdetailKey == null ? {} : { warehouseDetailKey: row.WdetailKey }) });

function actualQuantities(row) {
  const values = [];
  for (const [field, u] of [['SteamQuantity', '송이'], ['BunchQuantity', '단'], ['BoxQuantity', '박스'],
    ['EstQuantity', unit(row.EstUnit)], ['OutQuantity', unit(row.OutUnit)]]) {
    const q = numeric(row[field]);
    if (q != null && q !== 0 && ['박스', '단', '송이'].includes(u)) values.push({ unit: u, quantity: q, field });
  }
  // Physical quantity columns retain their units even when Product.EstUnit changed after
  // the receipt. Est/Out quantities are fallback, not competing physical measurements.
  const physicalUnits = new Set(values.filter(q => ['SteamQuantity', 'BunchQuantity', 'BoxQuantity'].includes(q.field)).map(q => q.unit));
  return values.filter(q => !['EstQuantity', 'OutQuantity'].includes(q.field) || !physicalUnits.has(q.unit));
}

function consistentValue(values) {
  if (!values.length) return { error: 'missing_conversion' };
  if (values.some(x => !same(x.value, values[0].value))) return { error: 'ambiguous_conversion' };
  return { value: values[0].value, evidence: values };
}

// All paths are limited to the same product; never borrow a similarly named sample.
function masterRatios(row, from, to) {
  const edges = [];
  for (const [field, a, b] of [['SteamOf1Bunch', '단', '송이'], ['SteamOf1Box', '박스', '송이'], ['BunchOf1Box', '박스', '단']]) {
    const value = numeric(row[field]);
    if (value > 0) {
      edges.push({ from: a, to: b, value, fields: [field] }, { from: b, to: a, value: 1 / value, fields: [field] });
    }
  }
  const found = edges.filter(e => e.from === from && e.to === to);
  for (const first of edges.filter(e => e.from === from)) {
    for (const second of edges.filter(e => e.from === first.to && e.to === to && e.to !== from)) {
      found.push({ value: first.value * second.value, fields: [...first.fields, ...second.fields] });
    }
  }
  return found.map(e => ({ value: e.value, source: 'product_master', fields: e.fields, prodKey: row.ProdKey }));
}

function receiptRatios(receipt, from, to) {
  // Physical fields keep their own unit even if today's Product.EstUnit differs from the
  // legacy entry's EstQuantity. Example: EC3227 Box=1/Steam=150/Est=6 is a 150-stem box,
  // not a 25-stem box. Est/Out are only fallback when that physical unit is absent.
  const quantities = actualQuantities(receipt);
  const a = quantities.filter(x => x.unit === from && x.quantity > 0);
  const b = quantities.filter(x => x.unit === to && x.quantity > 0);
  return a.flatMap(x => b.map(y => ({ value: y.quantity / x.quantity,
    source: 'warehouse_actual_ratio', ...sourceRef(receipt), fields: [x.field, y.field] })));
}

function conversion(row, from, to, receipts) {
  if (from === to) return { value: 1, evidence: [{ source: 'same_unit', unit: to }] };
  if (!['단', '송이', '박스'].includes(from)) return { error: 'missing_unit' };
  return consistentValue([...masterRatios(row, from, to), ...receipts.flatMap(r => receiptRatios(r, from, to))]);
}

function purchaseQuantity(row, target, receipts) {
  const actual = actualQuantities(row);
  const direct = actual.filter(x => x.unit === target);
  if (direct.length) {
    const check = consistentValue(direct.map(x => ({ value: x.quantity, source: 'warehouse_actual', field: x.field })));
    return check.error ? check : { quantity: check.value, evidence: check.evidence };
  }
  if (!actual.length) {
    // An actual all-zero receipt is distinct from a missing quantity carrying a nonzero price.
    const fields = ['SteamQuantity', 'BunchQuantity', 'BoxQuantity', 'EstQuantity', 'OutQuantity'];
    const known = fields.map(field => numeric(row[field])).filter(x => x != null);
    if (known.length && known.every(x => x === 0) && numeric(row.TPrice) === 0) {
      return { quantity: 0, evidence: [{ source: 'explicit_zero_receipt' }] };
    }
    return { error: 'missing_purchase_quantity' };
  }
  const converted = [];
  for (const quantity of actual) {
    const ratio = conversion(row, quantity.unit, target, receipts);
    if (ratio.error === 'ambiguous_conversion') return ratio;
    if (!ratio.error) converted.push({ value: quantity.quantity * ratio.value,
      source: 'warehouse_converted', field: quantity.field, conversion: ratio.evidence });
  }
  const check = consistentValue(converted);
  return check.error ? check : { quantity: check.value, evidence: check.evidence };
}

/** Recover only a previously ambiguous conversion from a fully reconciled stock cycle.
 * This is not FIFO: mixed-size acquisitions may be summed only if none were consumed.
 */
function recoverStockCycle(row, target, year, snapshotRank, receipts, cycleEvidence) {
  if (cycleEvidence?.complete !== true || String(cycleEvidence.orderYear) !== String(year)
      || rank(cycleEvidence.week) !== snapshotRank || numeric(row.Stock) <= 0) return null;
  const productKey = String(row.ProdKey);
  const from = unit(row.OutUnit);
  // Unknown activity coordinates cannot be discarded to make an apparently complete lot.
  const activity = [...receipts, ...(cycleEvidence.shipments || []), ...(cycleEvidence.adjustments || [])];
  if (activity.some(r => sameYear(r, year) && String(r.ProdKey) === productKey && rank(r.OrderWeek) == null)) return null;
  const snapshotRows = (cycleEvidence.snapshots || []).filter(r => sameYear(r, year)
    && String(r.ProdKey) === productKey && rank(r.OrderWeek) != null && rank(r.OrderWeek) < snapshotRank);
  // The loader ranks masters before joining product rows. Recheck duplicate candidates in
  // pure fixtures; a product's missing row in a canonical master never becomes a zero.
  const canonical = new Map();
  for (const candidate of snapshotRows) {
    const key = rank(candidate.OrderWeek);
    const previous = canonical.get(key);
    if (!previous || Number(candidate.SnapshotRowCount) > Number(previous.SnapshotRowCount)
      || (Number(candidate.SnapshotRowCount) === Number(previous.SnapshotRowCount)
        && Number(candidate.StockKey) > Number(previous.StockKey))) canonical.set(key, candidate);
  }
  const zero = [...canonical.values()].filter(r => numeric(r.Stock) === 0)
    .sort((a, b) => rank(b.OrderWeek) - rank(a.OrderWeek))[0];
  if (!zero) return null;
  const anchorRank = rank(zero.OrderWeek);
  const inCycle = r => sameYear(r, year) && String(r.ProdKey) === productKey
    && rank(r.OrderWeek) != null && rank(r.OrderWeek) > anchorRank && rank(r.OrderWeek) <= snapshotRank;
  const acquisitions = receipts.filter(inCycle);
  const shipments = (cycleEvidence.shipments || []).filter(inCycle);
  const adjustments = (cycleEvidence.adjustments || []).filter(inCycle);
  if (!acquisitions.length || [...canonical.values()].some(r => rank(r.OrderWeek) > anchorRank
      && (numeric(r.Stock) == null || numeric(r.Stock) < 0))) return null;
  // A nonzero adjustment does not identify a physical acquisition lot. Even net-zero
  // opposing adjustments must not silently select or recreate a lot.
  if (adjustments.some(r => Number(r.StockTypeMatches) !== 1 || numeric(r.BeforeValue) == null || numeric(r.AfterValue) == null
      || !same(Number(r.AfterValue), Number(r.BeforeValue)))) return null;
  if (shipments.some(r => numeric(r.OutQuantity) == null || Number(r.OutQuantity) < 0
      || (Number(r.OutQuantity) !== 0 && Number(r.DetailFix) !== 1))) return null;
  const targetField = target === '송이' ? 'SteamQuantity' : 'BunchQuantity';
  const fromField = { 송이: 'SteamQuantity', 단: 'BunchQuantity', 박스: 'BoxQuantity' }[from];
  if (!fromField) return null;
  const lots = [];
  for (const acquisition of acquisitions) {
    const out = numeric(acquisition.OutQuantity);
    const physicalOut = numeric(acquisition[fromField]);
    const physicalTarget = numeric(acquisition[targetField]);
    if (!(out > 0) || !(physicalOut > 0) || !(physicalTarget > 0) || !same(out, physicalOut)
        || unit(acquisition.OutUnit) !== from) return null;
    lots.push({ ...sourceRef(acquisition), outQuantity: out, quantity: physicalTarget, ratio: physicalTarget / out });
  }
  const totalOut = lots.reduce((sum, lot) => sum + lot.outQuantity, 0);
  const shipped = shipments.reduce((sum, r) => sum + Number(r.OutQuantity), 0);
  const stock = Number(row.Stock);
  if (!same(totalOut - shipped, stock)) return null;
  const uniform = lots.every(lot => same(lot.ratio, lots[0].ratio));
  let quantity;
  let source;
  if (uniform) {
    // The master is corroborating evidence, not an override for contrary active receipts.
    const ratios = [...masterRatios(row, from, target), ...lots.map(lot => ({ value: lot.ratio }))];
    if (consistentValue(ratios).error) return null;
    quantity = stock * lots[0].ratio;
    source = 'zero_anchor_uniform_receipts';
  } else {
    if (shipments.some(r => Number(r.OutQuantity) !== 0) || !same(totalOut, stock)) return null;
    quantity = lots.reduce((sum, lot) => sum + lot.quantity, 0);
    source = 'zero_anchor_unconsumed_lots';
  }
  return { value: quantity / stock, evidence: [{ source, prodKey: row.ProdKey,
    orderYear: String(year), anchorWeek: zero.OrderWeek, anchorStockKey: zero.StockKey,
    week: row.OrderWeek, stockKey: row.StockKey, outQuantity: stock, quantity, unit: target,
    totalAcquiredOut: totalOut, shippedOut: shipped, lots }] };
}

/** SQL-shaped rows are deliberate: fixtures retain source year/week/product/quantity fields.
 * A country is all-or-nothing. Null totals on failure prohibit consumers using a partial sum.
 */
export function normalizeCountryInventoryQuantities({ major, year, snapshot, purchases = [], stocks = [], historicalReceipts = [], cycleEvidence } = {}) {
  const snapshotRank = rank(snapshot?.week);
  const validScope = /^\d{4}$/.test(String(year)) && Number.isInteger(Number(major)) && Number(major) >= 1 && Number(major) <= 53;
  const available = validScope && snapshot?.snapshotAvailable === true && snapshot?.stockKey != null
    && String(snapshot?.orderYear) === String(year) && snapshotRank != null && Math.floor(snapshotRank / 10000) === Number(major);
  const results = {};
  for (const [category, target] of Object.entries(COUNTRY_AVERAGE_UNITS)) {
    const entry = results[category] = { eligible: false, unit: target, purchaseQty: null, stockQty: null,
      reason: null, issues: [], sources: [], details: [], snapshot: snapshot ? { ...snapshot } : null };
    if (!available) { entry.reason = validScope ? 'missing_snapshot' : 'invalid_scope'; continue; }
    const purchaseRows = purchases.filter(row => row.Category === category && stockable(row) && sameYear(row, year)
      && rank(row.OrderWeek) != null && Math.floor(rank(row.OrderWeek) / 10000) === Number(major));
    const stockRows = stocks.filter(row => row.Category === category && stockable(row) && sameYear(row, year)
      && rank(row.OrderWeek) === snapshotRank && String(row.StockKey) === String(snapshot.stockKey));
    const historicalByProduct = new Map();
    // Future and prior-year evidence is rejected here as well as in SQL.
    for (const row of historicalReceipts) {
      if (!sameYear(row, year) || rank(row.OrderWeek) == null || rank(row.OrderWeek) > snapshotRank || !stockable(row)) continue;
      const key = String(row.ProdKey);
      if (!historicalByProduct.has(key)) historicalByProduct.set(key, []);
      historicalByProduct.get(key).push(row);
    }
    const fail = (row, phase, code) => entry.issues.push({ ...sourceRef(row), prodName: row.ProdName || '', phase, code });
    let purchaseQty = 0;
    let stockQty = 0;
    for (const row of purchaseRows) {
      const receiptRank = rank(row.OrderWeek);
      // The purchase itself may follow the last stock snapshot. It is part of Q, but cannot
      // provide a conversion for an earlier receipt or the stock snapshot.
      const receipts = (historicalByProduct.get(String(row.ProdKey)) || []).filter(r => rank(r.OrderWeek) <= receiptRank);
      const result = purchaseQuantity(row, target, [row, ...receipts]);
      if (result.error) fail(row, 'purchase', result.error);
      else {
        purchaseQty += result.quantity;
        entry.sources.push(`erp-normalized:${year}:${row.OrderWeek}:prod-${row.ProdKey}:purchase:${result.quantity}${target}:${result.evidence[0]?.source}`);
        entry.details.push({ ...sourceRef(row), phase: 'purchase', quantity: result.quantity, unit: target, evidence: result.evidence });
      }
    }
    for (const row of stockRows) {
      const raw = numeric(row.Stock);
      if (raw == null) { fail(row, 'stock', 'missing_stock_quantity'); continue; }
      let result = raw === 0 ? { value: 1, evidence: [{ source: 'explicit_zero_stock' }] }
        : conversion(row, unit(row.OutUnit), target, historicalByProduct.get(String(row.ProdKey)) || []);
      if (result.error === 'ambiguous_conversion') {
        result = recoverStockCycle(row, target, year, snapshotRank, historicalReceipts, cycleEvidence) || result;
      }
      if (result.error) fail(row, 'stock', result.error);
      else {
        const quantity = raw * result.value;
        stockQty += quantity;
        entry.sources.push(`erp-normalized:${year}:${row.OrderWeek}:prod-${row.ProdKey}:stock:${quantity}${target}:${result.evidence[0]?.source}`);
        entry.details.push({ ...sourceRef(row), phase: 'stock', stockKey: row.StockKey, rawQuantity: raw,
          rawUnit: unit(row.OutUnit), quantity, unit: target, evidence: result.evidence });
      }
    }
    if (entry.issues.length) entry.reason = 'quantity_conversion_incomplete';
    else if (!purchaseRows.length || purchaseQty <= 0) entry.reason = 'no_purchase';
    else {
      entry.eligible = true;
      entry.purchaseQty = purchaseQty;
      entry.stockQty = stockQty;
      entry.negativeQty = entry.details.filter(row => row.phase === 'stock' && row.quantity < 0)
        .reduce((sum, row) => sum + Math.abs(row.quantity), 0);
    }
  }
  return results;
}
