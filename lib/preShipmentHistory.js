import { query, sql } from './db.js';

const p = (type, value) => ({ type, value });
const WEEK_RE = /^(\d{2})-(\d{2})$/;

/**
 * 선출고/정상 출고의 재고 이력 조회 범위다. 이 모듈은 ERP 원장을 절대 수정하지 않는다.
 * `OrderWeek`가 매년 반복되므로 모든 차수 조회는 `OrderYear`를 함께 받는다.
 */
export function normalizePreShipmentHistoryWeek(value, fieldName = '차수') {
  const text = String(value || '').trim();
  const match = text.match(WEEK_RE);
  if (!match) throw new Error(`${fieldName}는 NN-NN 형식이어야 합니다.`);
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (major < 1 || major > 53 || minor < 1 || minor > 99) throw new Error(`${fieldName} 범위가 올바르지 않습니다.`);
  return `${String(major).padStart(2, '0')}-${String(minor).padStart(2, '0')}`;
}

export function normalizePreShipmentHistoryScope(input = {}) {
  const orderYear = String(input.orderYear || '').trim();
  if (!/^\d{4}$/.test(orderYear)) throw new Error('orderYear는 필수이며 YYYY 형식이어야 합니다.');
  const preWeek = normalizePreShipmentHistoryWeek(input.preWeek, '선출고 차수');
  const custKey = Number(input.custKey);
  if (!Number.isInteger(custKey) || custKey <= 0) throw new Error('custKey는 필수입니다.');
  const normalWeek = input.normalWeek == null || String(input.normalWeek).trim() === ''
    ? null
    : normalizePreShipmentHistoryWeek(input.normalWeek, '정상 출고 차수');
  return { orderYear, preWeek, normalWeek, custKey };
}

export function normalizePreShipmentHistoryItems(items) {
  if (!Array.isArray(items) || items.length === 0) throw new Error('조회할 품목이 필요합니다.');
  if (items.length > 200) throw new Error('품목은 한 번에 200개까지 조회할 수 있습니다.');
  return items.map((item, index) => {
    const prodKey = Number(item?.prodKey);
    const quantity = Number(item?.quantity ?? 0);
    if (!Number.isInteger(prodKey) || prodKey <= 0) throw new Error(`${index + 1}번째 품목의 prodKey가 올바르지 않습니다.`);
    if (!Number.isFinite(quantity) || quantity < 0) throw new Error(`${index + 1}번째 품목의 수량이 올바르지 않습니다.`);
    return { prodKey, quantity, unit: String(item?.unit || '').trim().slice(0, 20) || null };
  });
}

export function resolveNormalHistoryWeek(preWeek, requestedNormalWeek, availableWeeks = []) {
  const normalizedPre = normalizePreShipmentHistoryWeek(preWeek, '선출고 차수');
  if (requestedNormalWeek) return { normalWeek: normalizePreShipmentHistoryWeek(requestedNormalWeek, '정상 출고 차수'), source: 'requested' };
  const after = availableWeeks
    .map(value => normalizePreShipmentHistoryWeek(value, '재고 차수'))
    .filter(value => value > normalizedPre)
    .sort()[0] || null;
  return { normalWeek: after, source: after ? 'next-stock-snapshot' : 'unavailable' };
}

/** StockHistory는 거래처 FK가 없으므로 품목·연도·차수의 시스템 이력일 뿐 업체 귀속 이력이 아니다. */
export function isManualStockAdjustment(changeType) {
  const normalized = String(changeType || '').replace(/[\s_-]+/g, '').toLowerCase();
  return normalized === '재고조정' || normalized === '재고수정' || normalized === 'stockadjustment';
}

export function buildPreShipmentHistoryStatus({ snapshot, stockHistory = [] } = {}) {
  const hasManualStockAdjustment = stockHistory.some(row => isManualStockAdjustment(row.ChangeType));
  return {
    hasStockSnapshot: Number(snapshot?.HasSnapshot || 0) === 1,
    hasStockHistory: stockHistory.length > 0,
    hasManualStockAdjustment,
    stockAdjustmentLabel: hasManualStockAdjustment ? '수동 재고조정 있음' : '수동 재고조정 없음',
  };
}

function productParams(items) {
  const params = {};
  const keys = [...new Set(items.map(item => item.prodKey))];
  const names = keys.map((prodKey, index) => {
    const name = `prod${index}`;
    params[name] = p(sql.Int, prodKey);
    return name;
  });
  return { params, names };
}

function twoWeekParams(scope, names) {
  return {
    ...Object.fromEntries(names.map(name => [name, null])),
    orderYear: p(sql.Char(4), scope.orderYear),
    preWeek: p(sql.Char(5), scope.preWeek),
    normalWeek: p(sql.Char(5), scope.normalWeek),
    custKey: p(sql.Int, scope.custKey),
  };
}

function productList(names) { return names.map(name => `@${name}`).join(','); }

export function buildPreShipmentHistoryAvailableWeeksSql() {
  return `
WITH Candidate AS (
  SELECT sm.OrderWeek,sm.StockKey,
         ROW_NUMBER() OVER (
           PARTITION BY sm.OrderWeek
           ORDER BY (SELECT COUNT(*) FROM ProductStock ps WHERE ps.StockKey=sm.StockKey) DESC,sm.StockKey DESC
         ) AS rn
    FROM StockMaster sm
   WHERE sm.OrderYear=@orderYear
     AND sm.OrderWeek LIKE '__-__'
     AND EXISTS (SELECT 1 FROM ProductStock ps WHERE ps.StockKey=sm.StockKey)
)
SELECT OrderWeek FROM Candidate WHERE rn=1 ORDER BY OrderWeek;`;
}

export function buildPreShipmentHistorySnapshotSql(names) {
  return `
WITH Candidate AS (
  SELECT sm.OrderWeek,sm.StockKey,ISNULL(sm.isFix,0) AS StockMasterFix,
         ROW_NUMBER() OVER (
           PARTITION BY sm.OrderWeek
           ORDER BY (SELECT COUNT(*) FROM ProductStock ps WHERE ps.StockKey=sm.StockKey) DESC,sm.StockKey DESC
         ) AS rn
    FROM StockMaster sm
   WHERE sm.OrderYear=@orderYear
     AND sm.OrderWeek IN (@preWeek,@normalWeek)
     AND EXISTS (SELECT 1 FROM ProductStock ps WHERE ps.StockKey=sm.StockKey)
), ScopedStock AS (
  SELECT OrderWeek,StockKey,StockMasterFix FROM Candidate WHERE rn=1
), SelectedProduct AS (
  SELECT p.ProdKey,p.ProdName,ISNULL(p.DisplayName,'') AS DisplayName,ISNULL(p.FlowerName,'') AS FlowerName,ISNULL(p.OutUnit,'') AS OutUnit
    FROM Product p WHERE p.ProdKey IN (${productList(names)})
)
SELECT ss.OrderWeek,sp.ProdKey,sp.ProdName,sp.DisplayName,sp.FlowerName,sp.OutUnit,
       ss.StockKey,ss.StockMasterFix,
       CASE WHEN ps.ProdKey IS NULL THEN 0 ELSE 1 END AS HasSnapshot,
       ps.Stock AS Stock
  FROM ScopedStock ss CROSS JOIN SelectedProduct sp
  LEFT JOIN ProductStock ps ON ps.StockKey=ss.StockKey AND ps.ProdKey=sp.ProdKey
 ORDER BY ss.OrderWeek,sp.ProdKey;`;
}

export function buildPreShipmentHistoryStockHistorySql(names) {
  return `
SELECT sh.OrderWeek,sh.ProdKey,sh.StockHistoryKey,sh.ChangeDtm,sh.ChangeID,sh.ChangeType,sh.ColumName,
       sh.BeforeValue,sh.AfterValue,(ISNULL(sh.AfterValue,0)-ISNULL(sh.BeforeValue,0)) AS ChangeValue,sh.Descr
  FROM StockHistory sh
 WHERE sh.OrderYear=@orderYear
   AND sh.OrderWeek IN (@preWeek,@normalWeek)
   AND sh.ProdKey IN (${productList(names)})
 ORDER BY sh.OrderWeek,sh.ProdKey,sh.ChangeDtm,sh.StockHistoryKey;`;
}

export function buildPreShipmentHistoryWarehouseSql(names) {
  return `
SELECT vw.OrderWeek,vw.ProdKey,SUM(ISNULL(vw.OutQuantity,0)) AS InboundQuantity
  FROM ViewWarehouse vw
 WHERE vw.OrderYear=@orderYear
   AND vw.OrderWeek IN (@preWeek,@normalWeek)
   AND vw.ProdKey IN (${productList(names)})
 GROUP BY vw.OrderWeek,vw.ProdKey;`;
}

export function buildPreShipmentHistoryConfirmedShipmentSql(names) {
  return `
SELECT vs.OrderWeek,vs.ProdKey,SUM(ISNULL(vs.OutQuantity,0)) AS ConfirmedOutboundQuantity
  FROM ViewShipment vs
 WHERE vs.OrderYear=@orderYear
   AND vs.OrderWeek IN (@preWeek,@normalWeek)
   AND vs.ProdKey IN (${productList(names)})
   AND ISNULL(vs.DetailFix,0)=1
 GROUP BY vs.OrderWeek,vs.ProdKey;`;
}

export function buildPreShipmentHistoryCustomerDistributionSql(names) {
  return `
SELECT vs.OrderWeek,vs.ProdKey,vs.ShipmentKey,vs.SdetailKey,ISNULL(vs.DetailFix,0) AS DetailFix,
       SUM(ISNULL(vs.OutQuantity,0)) AS DistributionQuantity,
       SUM(CASE WHEN ISNULL(vs.DetailFix,0)=1 THEN ISNULL(vs.OutQuantity,0) ELSE 0 END) AS CustomerConfirmedQuantity
  FROM ViewShipment vs
 WHERE vs.OrderYear=@orderYear
   AND vs.OrderWeek IN (@preWeek,@normalWeek)
   AND vs.CustKey=@custKey
   AND vs.ProdKey IN (${productList(names)})
 GROUP BY vs.OrderWeek,vs.ProdKey,vs.ShipmentKey,vs.SdetailKey,ISNULL(vs.DetailFix,0)
 ORDER BY vs.OrderWeek,vs.ProdKey,vs.ShipmentKey,vs.SdetailKey;`;
}

export function buildPreShipmentHistoryShipmentDateSql(names) {
  return `
SELECT vs.OrderWeek,vs.ProdKey,vs.ShipmentKey,vs.SdetailKey,CONVERT(date,sd.ShipmentDtm) AS ShipmentDate,
       SUM(ISNULL(sd.ShipmentQuantity,0)) AS ShipmentDateQuantity
  FROM ViewShipment vs
  JOIN ShipmentDate sd ON sd.SdetailKey=vs.SdetailKey
 WHERE vs.OrderYear=@orderYear
   AND vs.OrderWeek IN (@preWeek,@normalWeek)
   AND vs.CustKey=@custKey
   AND vs.ProdKey IN (${productList(names)})
 GROUP BY vs.OrderWeek,vs.ProdKey,vs.ShipmentKey,vs.SdetailKey,CONVERT(date,sd.ShipmentDtm)
 ORDER BY vs.OrderWeek,vs.ProdKey,ShipmentDate,vs.ShipmentKey,vs.SdetailKey;`;
}

function weekProductIndex(rows = []) {
  return rows.reduce((index, row) => {
    const key = `${row.OrderWeek}:${row.ProdKey}`;
    (index[key] ||= []).push(row);
    return index;
  }, {});
}

function firstByWeekProduct(rows = []) {
  return Object.fromEntries(rows.map(row => [`${row.OrderWeek}:${row.ProdKey}`, row]));
}

function mapWeekHistory({ week, prodKey, snapshotByKey, historiesByKey, inboundByKey, confirmedByKey, distributionByKey, datesByKey }) {
  const key = `${week}:${prodKey}`;
  const stockHistory = historiesByKey[key] || [];
  const snapshot = snapshotByKey[key] || { OrderWeek: week, ProdKey: prodKey, HasSnapshot: 0, Stock: null, StockKey: null, StockMasterFix: null };
  const distributions = distributionByKey[key] || [];
  return {
    week,
    snapshot: {
      stockKey: snapshot.StockKey == null ? null : Number(snapshot.StockKey),
      stockMasterFix: snapshot.StockMasterFix == null ? null : Number(snapshot.StockMasterFix),
      hasSnapshot: Number(snapshot.HasSnapshot || 0) === 1,
      stock: snapshot.Stock == null ? null : Number(snapshot.Stock),
    },
    stockHistory: stockHistory.map(row => ({
      stockHistoryKey: row.StockHistoryKey,
      changedAt: row.ChangeDtm,
      changeId: row.ChangeID || '',
      changeType: row.ChangeType || '',
      columnName: row.ColumName || '',
      beforeValue: row.BeforeValue == null ? null : Number(row.BeforeValue),
      afterValue: row.AfterValue == null ? null : Number(row.AfterValue),
      changeValue: row.ChangeValue == null ? null : Number(row.ChangeValue),
      descr: row.Descr || '',
      isManualStockAdjustment: isManualStockAdjustment(row.ChangeType),
    })),
    inboundQuantity: Number(inboundByKey[key]?.InboundQuantity || 0),
    confirmedOutboundQuantity: Number(confirmedByKey[key]?.ConfirmedOutboundQuantity || 0),
    customerDistribution: distributions.map(row => ({
      shipmentKey: row.ShipmentKey,
      sdetailKey: row.SdetailKey,
      detailFix: Number(row.DetailFix || 0),
      distributionQuantity: Number(row.DistributionQuantity || 0),
      confirmedQuantity: Number(row.CustomerConfirmedQuantity || 0),
    })),
    shipmentDates: (datesByKey[key] || []).map(row => ({
      shipmentKey: row.ShipmentKey,
      sdetailKey: row.SdetailKey,
      shipmentDate: row.ShipmentDate,
      shipmentDateQuantity: Number(row.ShipmentDateQuantity || 0),
    })),
    status: buildPreShipmentHistoryStatus({ snapshot, stockHistory }),
  };
}

export async function loadPreShipmentHistory(input = {}) {
  const requestedScope = normalizePreShipmentHistoryScope(input);
  const items = normalizePreShipmentHistoryItems(input.items);
  const availableWeeksResult = requestedScope.normalWeek ? null : await query(buildPreShipmentHistoryAvailableWeeksSql(), {
    orderYear: p(sql.Char(4), requestedScope.orderYear),
  });
  const normal = resolveNormalHistoryWeek(requestedScope.preWeek, requestedScope.normalWeek, availableWeeksResult?.recordset?.map(row => row.OrderWeek) || []);
  const scope = { ...requestedScope, normalWeek: normal.normalWeek || requestedScope.preWeek };
  const { params: productOnlyParams, names } = productParams(items);
  const params = { ...twoWeekParams(scope, names), ...productOnlyParams };
  const [snapshots, stockHistory, inbound, confirmedOutbound, customerDistribution, shipmentDates] = await Promise.all([
    query(buildPreShipmentHistorySnapshotSql(names), params),
    query(buildPreShipmentHistoryStockHistorySql(names), params),
    query(buildPreShipmentHistoryWarehouseSql(names), params),
    query(buildPreShipmentHistoryConfirmedShipmentSql(names), params),
    query(buildPreShipmentHistoryCustomerDistributionSql(names), params),
    query(buildPreShipmentHistoryShipmentDateSql(names), params),
  ]);
  const snapshotByKey = firstByWeekProduct(snapshots.recordset || []);
  const historiesByKey = weekProductIndex(stockHistory.recordset || []);
  const inboundByKey = firstByWeekProduct(inbound.recordset || []);
  const confirmedByKey = firstByWeekProduct(confirmedOutbound.recordset || []);
  const distributionByKey = weekProductIndex(customerDistribution.recordset || []);
  const datesByKey = weekProductIndex(shipmentDates.recordset || []);
  const resultItems = items.map(item => {
    const product = (snapshots.recordset || []).find(row => Number(row.ProdKey) === item.prodKey);
    return {
      ...item,
      product: product ? { prodName: product.ProdName || '', displayName: product.DisplayName || '', flowerName: product.FlowerName || '', outUnit: product.OutUnit || '' } : null,
      preShipment: mapWeekHistory({ week: requestedScope.preWeek, prodKey: item.prodKey, snapshotByKey, historiesByKey, inboundByKey, confirmedByKey, distributionByKey, datesByKey }),
      normalShipment: normal.normalWeek
        ? mapWeekHistory({ week: normal.normalWeek, prodKey: item.prodKey, snapshotByKey, historiesByKey, inboundByKey, confirmedByKey, distributionByKey, datesByKey })
        : null,
    };
  });
  return {
    scope: { ...requestedScope, normalWeek: normal.normalWeek, normalWeekSource: normal.source },
    items: resultItems,
    summary: {
      itemCount: resultItems.length,
      manualAdjustmentItemCount: resultItems.filter(item => item.preShipment.status.hasManualStockAdjustment || item.normalShipment?.status.hasManualStockAdjustment).length,
      normalWeekUnavailable: normal.normalWeek == null,
    },
  };
}
