// Read-only display helpers for pasted-product incoming quantities.

const DEFAULT_MAX_PRODUCT_KEYS = 300;

function positiveProductKey(value) {
  const key = Number(value);
  return Number.isSafeInteger(key) && key > 0 ? key : null;
}

/** Return first-seen, unique positive product keys, capped for one GET request. */
export function normalizePasteIncomingProdKeys(value, max = DEFAULT_MAX_PRODUCT_KEYS) {
  const limit = Number.isSafeInteger(Number(max)) && Number(max) > 0 ? Number(max) : DEFAULT_MAX_PRODUCT_KEYS;
  const source = Array.isArray(value)
    ? value
    : (value == null ? [] : String(value).split(',').map(item => item.trim()));
  const keys = [];
  const seen = new Set();
  for (const item of source) {
    const rawKey = item && typeof item === 'object' ? (item.prodKey ?? item.ProdKey) : item;
    const key = positiveProductKey(rawKey);
    if (key == null || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
    if (keys.length >= limit) break;
  }
  return keys;
}

/** Shared SELECT used by the API and executable contract tests. */
export function buildPasteIncomingSql(productParameters) {
  const params = Array.isArray(productParameters) ? productParameters : [];
  if (params.length === 0 || params.some(name => !/^@pk\d+$/.test(String(name)))) {
    throw new Error('유효한 품목 파라미터가 필요합니다.');
  }
  return `SELECT p.ProdKey, p.OutUnit, ISNULL(w.InQuantity,0) AS InQuantity
     FROM Product p
     LEFT JOIN (
       SELECT wd.ProdKey, SUM(ISNULL(wd.OutQuantity,0)) AS InQuantity
         FROM WarehouseDetail wd
         JOIN WarehouseMaster wm ON wm.WarehouseKey=wd.WarehouseKey
        WHERE wm.OrderYear=@orderYear AND wm.OrderWeek=@orderWeek
          AND ISNULL(wm.isDeleted,0)=0
        GROUP BY wd.ProdKey
     ) w ON w.ProdKey=p.ProdKey
    WHERE p.ProdKey IN (${params.join(',')})
    ORDER BY p.ProdKey`;
}

/** Map SELECT result rows to the exact display shape consumed by a pasted match. */
export function buildPasteIncomingMap(rows) {
  const result = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const productKey = positiveProductKey(row?.prodKey ?? row?.ProdKey);
    if (productKey == null) continue;
    const rawQty = Number(row?.qty ?? row?.Qty ?? row?.OutQuantity ?? 0);
    const qty = Number.isFinite(rawQty) ? rawQty : 0;
    const outUnit = row?.outUnit ?? row?.OutUnit ?? '';
    const prior = result[productKey];
    result[productKey] = {
      qty: (prior?.qty || 0) + qty,
      outUnit: String(outUnit || prior?.outUnit || ''),
    };
  }
  return result;
}

/** The UI state is separate from request mechanics and never implies a write. */
export function pasteIncomingDisplayState({ loading = false, error = null, entry = null } = {}) {
  if (loading) return { kind: 'loading', label: '입고 조회 중' };
  if (error) return { kind: 'error', label: '입고 조회 실패' };
  const qty = Number(entry?.qty || 0);
  const unit = String(entry?.outUnit || '').trim();
  if (qty === 0) return { kind: 'zero', label: unit ? `입고 0 ${unit}` : '입고 0' };
  return { kind: 'positive', label: unit ? `입고 ${qty} ${unit}` : `입고 ${qty}` };
}

/** Cross-year criteria ledger for the caller's selected year/week GET. */
export function pasteIncomingDisplayCriteriaLedger({ orderYear, orderWeek, prodKeys, max = DEFAULT_MAX_PRODUCT_KEYS } = {}) {
  const selectedYear = String(orderYear ?? '').trim();
  return Object.freeze({
    operation: 'SELECT_ONLY', orderYear: selectedYear, orderWeek: String(orderWeek ?? '').trim(),
    prodKeys: normalizePasteIncomingProdKeys(prodKeys, max),
    predicates: Object.freeze(['wm.OrderYear = @orderYear', 'wm.OrderWeek = @orderWeek', 'wd.ProdKey IN (@prodKeys)', 'wm.isDeleted = 0']),
    aggregation: 'SUM(wd.OutQuantity)', unitSource: 'Product.OutUnit',
    crossYear: Object.freeze({ included: selectedYear, excluded: 'all other OrderYear values, including a prior year with the same OrderWeek' }),
    preserves: Object.freeze(['Order', 'Shipment', 'Warehouse', 'Stock', 'Estimate', 'WebProfitReport']),
  });
}
