'use strict';

// Read-only request/evidence comparison. This module deliberately does not
// infer completion from a stock snapshot or mutate parser/API inputs.
const EPSILON = 1e-6;
const MAX_GROUPED_ROWS = 10000;
const ISO_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;

function finiteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !/^-?(?:\d+\.?\d*|\.\d+)$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveKey(value) {
  const key = Number(value);
  return Number.isInteger(key) && key > 0 ? key : null;
}

function canonicalUnit(value) {
  const unit = String(value || '').trim().toLowerCase();
  if (unit === '박스' || unit === 'box') return '박스';
  if (unit === '단' || unit === 'bunch') return '단';
  if (unit === '송이' || unit === 'stem' || unit === 'stems') return '송이';
  return null;
}

function timestamp(value) {
  if (typeof value !== 'string' || !ISO_TIME_RE.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function requestDelta(request) {
  const qty = finiteNumber(request?.qty);
  if (qty === null || qty <= 0) return null;
  if (request.action === 'ADD') return qty;
  if (request.action === 'CANCEL') return -qty;
  return null;
}

function cloneParsedItems(items) {
  return (items || []).map(item => ({
    sourceIdentity: item?.sourceIdentity,
    requests: (item?.requests || []).map(request => ({ ...request })),
  }));
}

function flattenRequests(items) {
  const flattened = [];
  for (const item of items || []) {
    for (const request of item?.requests || []) flattened.push({ ...request, sourceIdentity: item.sourceIdentity });
  }
  return flattened;
}

function sqlNumber(column) {
  return `TRY_CONVERT(decimal(28,6),NULLIF(LTRIM(RTRIM(CONVERT(nvarchar(100),${column}))),N''))`;
}

async function loadDistributionRequestBalanceFacts(query, sql, scope) {
  const params = {
    year: { type: sql.NVarChar, value: scope.year },
    week: { type: sql.NVarChar, value: scope.weeks[0] },
  };
  const snapshotValue = sqlNumber('ps.Stock');
  const distributionValue = sqlNumber('vs.OutQuantity');
  const [masters, snapshots, distributions] = await Promise.all([
    query(`SELECT COUNT_BIG(*) AS scopeStockMasterCount
      FROM StockMaster sm
      WHERE sm.OrderYear=@year AND sm.OrderWeek=@week`, params),
    query(`SELECT TOP 10001 ps.ProdKey,
      COUNT_BIG(DISTINCT sm.StockKey) AS snapshotStockKeyCount,
      COUNT_BIG(*) AS snapshotRowCount,
      COUNT_BIG(${snapshotValue}) AS finiteValueCount,
      MIN(${snapshotValue}) AS storedStockSnapshot,
      MIN(sm.StockKey) AS firstStockKey,
      MAX(sm.StockKey) AS lastStockKey
      FROM StockMaster sm
      JOIN ProductStock ps ON ps.StockKey=sm.StockKey
      WHERE sm.OrderYear=@year AND sm.OrderWeek=@week
      GROUP BY ps.ProdKey
      ORDER BY ps.ProdKey`, params),
    query(`SELECT TOP 10001 vs.ProdKey,p.OutUnit AS unit,
      COUNT_BIG(*) AS distributionRowCount,
      COUNT_BIG(${distributionValue}) AS finiteValueCount,
      SUM(${distributionValue}) AS actualDistributionTotal
      FROM ViewShipment vs
      JOIN Product p ON p.ProdKey=vs.ProdKey
      WHERE vs.OrderYear=@year AND vs.OrderWeek=@week
      GROUP BY vs.ProdKey,p.OutUnit
      ORDER BY vs.ProdKey`, params),
  ]);
  const snapshotRows = (snapshots?.recordset || []).slice(0, MAX_GROUPED_ROWS);
  const distributionRows = (distributions?.recordset || []).slice(0, MAX_GROUPED_ROWS);
  return {
    scopeStockMasterCount: finiteNumber(masters?.recordset?.[0]?.scopeStockMasterCount),
    snapshotRows,
    distributionRows,
    snapshotsTruncated: (snapshots?.recordset || []).length > MAX_GROUPED_ROWS,
    distributionsTruncated: (distributions?.recordset || []).length > MAX_GROUPED_ROWS,
  };
}

function eventMatches(event, request, scope, sourceAt) {
  return String(event?.year || '') === scope.year
    && event?.week === scope.weeks[0]
    && positiveKey(event?.custKey) === positiveKey(request?.custKey)
    && positiveKey(event?.prodKey) === positiveKey(request?.prodKey)
    && canonicalUnit(event?.unit) !== null
    && canonicalUnit(event?.unit) === canonicalUnit(request?.unit)
    && timestamp(event?.changeAt) !== null
    && timestamp(event.changeAt) >= sourceAt
    && finiteNumber(event?.before) !== null
    && finiteNumber(event?.after) !== null;
}

function readiness(request, scope, historyTruncated) {
  if (request?.status === 'AMBIGUOUS') return 'PARSER_AMBIGUOUS';
  if (String(request?.year || '') !== scope.year || request?.week !== scope.weeks[0]) return 'REQUEST_SCOPE_MISMATCH';
  if (!positiveKey(request?.custKey) || !positiveKey(request?.prodKey)) return 'REQUEST_IDENTITY_UNKNOWN';
  if (requestDelta(request) === null) return 'REQUEST_QUANTITY_UNKNOWN';
  if (canonicalUnit(request?.unit) === null) return 'UNIT_UNKNOWN';
  if (request?.timestamp_approximate === true) return 'SOURCE_TIME_APPROXIMATE';
  if (timestamp(request?.sourceAt) === null) return 'SOURCE_TIME_MISSING';
  if (historyTruncated) return 'DATA_TRUNCATED';
  return null;
}

function statusForDelta(expected, observed) {
  if (Math.abs(observed - expected) <= EPSILON) return 'CONSISTENT';
  if (observed * expected > EPSILON * EPSILON && Math.abs(observed) < Math.abs(expected) - EPSILON) return 'PARTIAL';
  return 'MISMATCH';
}

function buildSnapshotMap(balanceFacts) {
  const map = new Map();
  for (const row of balanceFacts?.snapshotRows || []) {
    const prodKey = positiveKey(row?.ProdKey);
    if (!prodKey) continue;
    map.set(prodKey, {
      stockKeyCount: finiteNumber(row.snapshotStockKeyCount),
      rowCount: finiteNumber(row.snapshotRowCount),
      finiteCount: finiteNumber(row.finiteValueCount),
      value: finiteNumber(row.storedStockSnapshot),
    });
  }
  return map;
}

function buildDistributionMap(balanceFacts) {
  const map = new Map();
  for (const row of balanceFacts?.distributionRows || []) {
    const prodKey = positiveKey(row?.ProdKey);
    if (!prodKey) continue;
    const next = {
      rowCount: finiteNumber(row.distributionRowCount),
      finiteCount: finiteNumber(row.finiteValueCount),
      value: finiteNumber(row.actualDistributionTotal),
      unit: canonicalUnit(row.unit),
      conflictingUnits: false,
    };
    const existing = map.get(prodKey);
    if (!existing) {
      map.set(prodKey, next);
      continue;
    }
    // Product is normally one OutUnit. Do not silently overwrite if a bad
    // catalog join returns more than one unit group for the same product.
    existing.conflictingUnits = true;
    if (existing.unit !== next.unit) existing.conflictingUnits = true;
  }
  return map;
}

function snapshotFor(prodKey, scopeStockMasterCount, snapshotsTruncated, snapshotMap) {
  if (snapshotsTruncated) return { value: null, status: 'UNKNOWN', reason: 'DATA_TRUNCATED' };
  if (scopeStockMasterCount === 0) return { value: null, status: 'UNKNOWN', reason: 'STOCK_MASTER_SCOPE_MISSING' };
  if (scopeStockMasterCount === null || scopeStockMasterCount === undefined) return { value: null, status: 'UNKNOWN', reason: 'INVALID_STOCK_MASTER_SCOPE' };
  if (scopeStockMasterCount > 1) return { value: null, status: 'AMBIGUOUS', reason: 'AMBIGUOUS_STOCK_MASTER_SCOPE' };
  const row = snapshotMap.get(prodKey);
  if (!row) return { value: null, status: 'UNKNOWN', reason: 'STOCK_SNAPSHOT_MISSING' };
  if (row.stockKeyCount !== 1 || row.rowCount !== 1) return { value: null, status: 'AMBIGUOUS', reason: 'DUPLICATE_STOCK_SNAPSHOT' };
  if (row.finiteCount !== 1 || row.value === null) return { value: null, status: 'UNKNOWN', reason: 'INVALID_STOCK_SNAPSHOT' };
  return { value: row.value, status: 'AVAILABLE', reason: null };
}

function distributionFor(prodKey, distributionsTruncated, distributionMap) {
  if (distributionsTruncated) return { value: null, reason: 'DATA_TRUNCATED' };
  const row = distributionMap.get(prodKey);
  if (!row) return { value: 0, reason: null };
  if (row.conflictingUnits) return { value: null, reason: 'AMBIGUOUS_DISTRIBUTION_UNIT' };
  if (row.rowCount === null || row.finiteCount !== row.rowCount || row.value === null) return { value: null, reason: 'INVALID_DISTRIBUTION_TOTAL' };
  return { value: row.value, reason: null };
}

function productNameFor(request, products) {
  const product = (products || []).find(row => positiveKey(row?.ProdKey) === positiveKey(request?.prodKey));
  return product?.ProdName || product?.DisplayName || request?.productText || '품목 확인 필요';
}

function compareRequests(rawRequests, shipmentEvents, scope, historyTruncated) {
  const results = rawRequests.map(request => ({ request, status: null, observed: null, reasonCodes: [], candidates: [] }));
  const idCounts = new Map();
  for (const request of rawRequests) if (typeof request?.id === 'string' && request.id) idCounts.set(request.id, (idCounts.get(request.id) || 0) + 1);
  const claims = new Map();

  for (const result of results) {
    const problem = readiness(result.request, scope, historyTruncated);
    if (problem) {
      result.status = 'AMBIGUOUS';
      result.reasonCodes.push(problem);
      continue;
    }
    const sourceAt = timestamp(result.request.sourceAt);
    const matching = (shipmentEvents || []).filter(event => eventMatches(event, result.request, scope, sourceAt));
    const unsafe = matching.filter(event => event.multiDate === true);
    result.candidates = matching.filter(event => event.multiDate !== true);
    if (unsafe.length) result.reasonCodes.push('MULTI_DATE_SHIPMENT');
    for (const event of result.candidates) {
      const claimsForEvent = claims.get(event.eventId) || [];
      claimsForEvent.push(result);
      claims.set(event.eventId, claimsForEvent);
    }
    if (idCounts.get(result.request.id) > 1) {
      result.status = 'AMBIGUOUS'; result.reasonCodes.push('DUPLICATE_REQUEST_ID');
    } else if (unsafe.length || result.candidates.length > 1) {
      result.status = 'AMBIGUOUS'; result.reasonCodes.push(unsafe.length ? 'MULTI_DATE_SHIPMENT' : 'MULTIPLE_SHIPMENT_EVENTS');
    } else if (result.candidates.length === 0) {
      result.status = 'UNCONFIRMED'; result.reasonCodes.push('NO_SHIPMENT_HISTORY');
    }
  }

  for (const [eventId, claimants] of claims) {
    if (claimants.length < 2) continue;
    for (const result of claimants) {
      result.status = 'AMBIGUOUS';
      result.observed = null;
      result.reasonCodes.push(`COMPETING_SHIPMENT_EVENT:${eventId}`);
    }
  }
  for (const result of results) {
    if (result.status) continue;
    const event = result.candidates[0];
    const observed = finiteNumber(event.after) - finiteNumber(event.before);
    result.observed = observed;
    result.status = statusForDelta(requestDelta(result.request), observed);
    if (result.status === 'PARTIAL') result.reasonCodes.push('PARTIAL_SHIPMENT_HISTORY');
    if (result.status === 'MISMATCH') result.reasonCodes.push('SHIPMENT_DELTA_MISMATCH');
  }
  return results;
}

function aggregateProducts(requestResults, rawRequests, facts, balanceFacts, scope) {
  const groups = new Map();
  for (const result of requestResults) {
    const prodKey = positiveKey(result.request?.prodKey);
    if (!prodKey || requestDelta(result.request) === null) continue;
    const group = groups.get(prodKey) || { prodKey, results: [] };
    group.results.push(result);
    groups.set(prodKey, group);
  }
  const snapshotMap = buildSnapshotMap(balanceFacts);
  const distributionMap = buildDistributionMap(balanceFacts);
  return [...groups.values()].map(group => {
    const first = group.results[0].request;
    const requestedSignedDelta = group.results.reduce((sum, result) => sum + requestDelta(result.request), 0);
    const observed = group.results.filter(result => result.observed !== null).map(result => result.observed);
    const observedComplete = group.results.every(result => result.status === 'CONSISTENT');
    const evidenceStatus = group.results.some(result => result.status === 'AMBIGUOUS') ? 'AMBIGUOUS'
      : group.results.some(result => result.status === 'MISMATCH') ? 'MISMATCH'
        : group.results.some(result => result.status === 'PARTIAL') ? 'PARTIAL'
          : group.results.some(result => result.status === 'UNCONFIRMED') ? 'UNCONFIRMED' : 'CONSISTENT';
    const snapshot = snapshotFor(group.prodKey, balanceFacts?.scopeStockMasterCount, balanceFacts?.snapshotsTruncated === true, snapshotMap);
    const distribution = distributionFor(group.prodKey, balanceFacts?.distributionsTruncated === true, distributionMap);
    const reasonCodes = new Set(group.results.flatMap(result => result.reasonCodes));
    if (snapshot.reason) reasonCodes.add(snapshot.reason);
    if (distribution.reason) reasonCodes.add(distribution.reason);
    const requests = group.results.map(result => ({
      requestId: typeof result.request.id === 'string' ? result.request.id : null,
      sourceIdentity: typeof result.request.sourceIdentity === 'string' ? result.request.sourceIdentity : null,
      custKey: positiveKey(result.request.custKey),
      prodKey: group.prodKey,
      requestedSignedDelta: requestDelta(result.request),
      observedSignedDelta: result.observed,
      evidenceStatus: result.status,
      reasonCodes: [...new Set(result.reasonCodes)].sort(),
    }));
    return {
      prodKey: group.prodKey,
      prodName: productNameFor(first, facts?.products),
      unit: first.unit,
      requestCount: group.results.length,
      requestedSignedDelta,
      observedSignedDelta: observed.length ? observed.reduce((sum, value) => sum + value, 0) : null,
      observedComplete,
      expectedBalanceImpact: -requestedSignedDelta,
      actualDistributionTotal: distribution.value,
      storedStockSnapshot: snapshot.value,
      snapshotSource: 'PRODUCT_STOCK_SNAPSHOT',
      snapshotStatus: snapshot.status,
      evidenceStatus,
      visibleByDefault: evidenceStatus !== 'CONSISTENT' || snapshot.status !== 'AVAILABLE' || distribution.value === null,
      reasonCodes: [...reasonCodes].sort(),
      sourceIdentities: [...new Set(group.results.map(result => result.request.sourceIdentity).filter(value => typeof value === 'string'))],
      requestIds: [...new Set(group.results.map(result => result.request.id).filter(value => typeof value === 'string'))],
      requests,
      _scope: scope,
    };
  }).sort((left, right) => left.prodKey - right.prodKey).map(({ _scope, ...product }) => product);
}

function buildDistributionRequestBalanceComparison({ parsedItems, facts, balanceFacts, scope }) {
  const rawRequests = flattenRequests(parsedItems);
  const requestResults = compareRequests(rawRequests, facts?.shipmentEvents || [], scope, facts?.queryTruncated === true);
  const products = aggregateProducts(requestResults, rawRequests, facts, balanceFacts, scope);
  const visibleCount = products.filter(product => product.visibleByDefault).length;
  return {
    version: 1,
    defaultFilter: 'EXCEPTIONS',
    summary: {
      productCount: products.length,
      visibleCount,
      consistentHiddenCount: products.length - visibleCount,
      unresolvedRequestCount: rawRequests.filter(request => !positiveKey(request?.prodKey)).length,
    },
    products,
  };
}

module.exports = {
  MAX_GROUPED_ROWS,
  cloneParsedItems,
  loadDistributionRequestBalanceFacts,
  buildDistributionRequestBalanceComparison,
};
