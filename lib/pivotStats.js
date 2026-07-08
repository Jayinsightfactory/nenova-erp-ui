import { query, sql } from './db';
import {
  buildOrderYearWeek,
  normalizeOrderWeek,
  resolveActiveOrderYear,
  listOrderWeeksInRange,
} from './orderUtils';
import { aggregateDistCostOrders, aggregateOutOrders } from './pivotDistCost';
import { getArrivalCostsForWeekRange } from './pivotFreightArrival';
import { cleanPivotProdName } from './pivotProdName';

export { aggregateDistCostOrders, aggregateOutOrders };
export { cleanPivotProdName };

function yearWeekExpr(alias) {
  return `${alias}.OrderYear + REPLACE(${alias}.OrderWeek, '-', '')`;
}

const STOCK_ADJUST_FARM = '재고조정';
const MANUAL_STOCK_CHANGE_FILTER = `(sh.ChangeType IS NULL OR sh.ChangeType NOT IN (N'확정', N'확정취소', N'입고', N'출고'))`;

function safeSheetName(value, fallback = 'Sheet') {
  const name = String(value || fallback).replace(/[\\/?*[\]:]/g, '').trim() || fallback;
  return name.slice(0, 31);
}

export function customerDisplayLabel(customer) {
  return String(customer?.custName || '').trim();
}

export function makePivotVolumeSheetName(country, flower, used = new Set()) {
  const base = safeSheetName(`${country || ''}${flower || ''}`, '물량표');
  let name = base;
  let idx = 2;
  while (used.has(name)) {
    const suffix = `_${idx++}`;
    name = `${base.slice(0, 31 - suffix.length)}${suffix}`;
  }
  used.add(name);
  return name;
}

async function loadPriceMap() {
  const priceResult = await query(`SELECT CustKey, ProdKey, Cost FROM CustomerProdCost`);
  const priceMap = {};
  priceResult.recordset.forEach(r => {
    if (!priceMap[r.CustKey]) priceMap[r.CustKey] = {};
    priceMap[r.CustKey][r.ProdKey] = r.Cost;
  });
  return priceMap;
}

/** 단일 차수 또는 차수 범위 집계 (기존 getPivotStats 본체) */
export async function getPivotStatsRange({
  weekStart,
  weekEnd,
  orderYear,
  priceMap: priceMapIn = null,
}) {
  if (!weekStart) throw new Error('weekStart 필요');

  const weekStartNorm = normalizeOrderWeek(weekStart);
  const wEnd = normalizeOrderWeek(weekEnd || weekStart);
  const startYear = resolveActiveOrderYear(weekStart, orderYear);
  const endYear = resolveActiveOrderYear(weekEnd || weekStart, '', startYear);
  const yws = buildOrderYearWeek(startYear, weekStartNorm);
  const ywe = buildOrderYearWeek(endYear, wEnd);
  if (yws > ywe) throw new Error('차수 범위가 올바르지 않습니다.');

  const rangeParams = {
    yws: { type: sql.NVarChar, value: yws },
    ywe: { type: sql.NVarChar, value: ywe },
  };

  const orderResult = await query(
    `SELECT
      p.CounName AS country, p.FlowerName AS flower, p.ProdName AS prodName,
      p.ProdKey, p.OutUnit, ISNULL(p.Cost,0) AS cost, ISNULL(p.Descr,'') AS productDescr,
      c.CustKey, c.CustName, c.CustArea AS area, c.OrderCode, ISNULL(c.Descr,'') AS custDescr,
      om.OrderWeek AS week,
      ISNULL(od.OutQuantity,0) AS outQty,
      ISNULL(od.Descr,'') AS descr
     FROM OrderMaster om
     JOIN Customer c      ON om.CustKey = c.CustKey AND c.isDeleted = 0
     JOIN OrderDetail od  ON om.OrderMasterKey = od.OrderMasterKey AND od.isDeleted = 0
     JOIN Product p       ON od.ProdKey = p.ProdKey AND p.isDeleted = 0
     WHERE ${yearWeekExpr('om')} >= @yws AND ${yearWeekExpr('om')} <= @ywe
       AND om.isDeleted = 0
     ORDER BY p.CounName, p.FlowerName, p.ProdName, c.CustArea, c.CustName`,
    rangeParams
  );

  const inResult = await query(
    `SELECT
      p.CounName AS country, p.FlowerName AS flower, p.ProdName AS prodName,
      p.ProdKey, p.OutUnit, ISNULL(p.Descr,'') AS productDescr,
      wm.FarmName AS farmName,
      wm.OrderNo AS awb,
      wm.InputDate AS inDate,
      ISNULL(wd.UPrice, 0) AS inPrice,
      ISNULL(wd.TPrice, 0) AS inTotal,
      ISNULL(wd.OutQuantity, 0) AS inQty
     FROM WarehouseDetail wd
     JOIN WarehouseMaster wm ON wd.WarehouseKey = wm.WarehouseKey AND wm.isDeleted = 0
     JOIN Product p ON wd.ProdKey = p.ProdKey AND p.isDeleted = 0
     WHERE ${yearWeekExpr('wm')} >= @yws AND ${yearWeekExpr('wm')} <= @ywe
     ORDER BY p.CounName, p.FlowerName, p.ProdName, wm.FarmName`,
    rangeParams
  );

  const stockResult = await query(
    `SELECT p.ProdKey, ISNULL(ps.Stock,0) AS prevStock
     FROM Product p
     LEFT JOIN ProductStock ps ON ps.ProdKey = p.ProdKey AND ps.StockKey = (
       SELECT TOP 1 StockKey
       FROM StockMaster
       WHERE OrderYearWeek < @yws
       ORDER BY OrderYearWeek DESC, OrderWeek DESC, StockKey DESC
     )
     WHERE p.isDeleted = 0`,
    { yws: { type: sql.NVarChar, value: yws } }
  );

  const adjustResult = await query(
    `SELECT
      p.CounName AS country, p.FlowerName AS flower, p.ProdName AS prodName,
      p.ProdKey, p.OutUnit, ISNULL(p.Descr,'') AS productDescr,
      SUM(ISNULL(sh.AfterValue,0) - ISNULL(sh.BeforeValue,0)) AS adjustQty
     FROM StockHistory sh
     JOIN Product p ON sh.ProdKey = p.ProdKey AND p.isDeleted = 0
     WHERE ${yearWeekExpr('sh')} >= @yws AND ${yearWeekExpr('sh')} <= @ywe
       AND ${MANUAL_STOCK_CHANGE_FILTER}
     GROUP BY p.CounName, p.FlowerName, p.ProdName, p.ProdKey, p.OutUnit, p.Descr
     HAVING SUM(ISNULL(sh.AfterValue,0) - ISNULL(sh.BeforeValue,0)) <> 0
     ORDER BY p.CounName, p.FlowerName, p.ProdName`,
    rangeParams
  );

  const outResult = await query(
    `SELECT sd.ProdKey, SUM(sd.OutQuantity) AS outQty,
      MAX(CONVERT(NVARCHAR(10), sd.ShipmentDtm, 120)) AS outDate
     FROM ShipmentDetail sd
     JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey AND sm.isDeleted = 0
     WHERE ${yearWeekExpr('sm')} >= @yws AND ${yearWeekExpr('sm')} <= @ywe
       AND ISNULL(sd.isFix, 0) = 1
     GROUP BY sd.ProdKey`,
    rangeParams
  );

  const outCustResult = await query(
    `SELECT sd.ProdKey AS prodKey, c.CustKey AS custKey, c.CustName AS custName,
       c.CustArea AS area, c.OrderCode AS orderCode, ISNULL(c.Descr,'') AS custDescr,
       SUM(ISNULL(sd.OutQuantity, 0)) AS outQty
     FROM ShipmentDetail sd
     JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey AND sm.isDeleted = 0
     JOIN Customer c ON sm.CustKey = c.CustKey AND c.isDeleted = 0
     WHERE ${yearWeekExpr('sm')} >= @yws AND ${yearWeekExpr('sm')} <= @ywe
       AND ISNULL(sd.isFix, 0) = 1
       AND ISNULL(sd.OutQuantity, 0) > 0
     GROUP BY sd.ProdKey, c.CustKey, c.CustName, c.CustArea, c.OrderCode, c.Descr`,
    rangeParams
  );

  // 도착원가 맵 — 차수 범위의 FreightCostDetail 스냅샷 또는 live 계산 (read-only)
  // 실패해도 pivot 전체가 중단되지 않도록 try-catch 로 감싼다.
  let arrivalMap = {};
  try {
    arrivalMap = await getArrivalCostsForWeekRange({ weekStart, weekEnd, orderYear });
  } catch (_) {
    // 도착원가 없는 상태로 계속 (arrivalCost=0 이 됨)
  }

  // 분배단가 — 출고분배 시 ShipmentDetail.Cost 에 기록된 단가 (마스터 단가 costOrders 와 별개)
  // 거래처는 ShipmentMaster.CustKey 기준(출고 소유 거래처) → orders 맵의 CustName 키와 정합
  const distCostResult = await query(
    `SELECT sd.ProdKey AS prodKey, c.CustName AS custName,
       ISNULL(sd.OutQuantity, 0) AS outQty, ISNULL(sd.Cost, 0) AS cost
     FROM ShipmentDetail sd
     JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey AND sm.isDeleted = 0
     JOIN Customer c        ON sm.CustKey = c.CustKey AND c.isDeleted = 0
     WHERE ${yearWeekExpr('sm')} >= @yws AND ${yearWeekExpr('sm')} <= @ywe
       AND ISNULL(sd.OutQuantity, 0) > 0`,
    rangeParams
  );
  const distCostMap = aggregateDistCostOrders(distCostResult.recordset);
  const outOrdersMap = aggregateOutOrders(outCustResult.recordset);

  const priceMap = priceMapIn || await loadPriceMap();

  const prevStockMap = {};
  stockResult.recordset.forEach(r => { prevStockMap[r.ProdKey] = r.prevStock || 0; });

  const outDateMap = {};
  const confirmedOutMap = {};
  outResult.recordset.forEach(r => {
    confirmedOutMap[r.ProdKey] = r.outQty || 0;
    outDateMap[r.ProdKey] = r.outDate || '';
  });

  const incomingMap = {};
  const inPriceMap = {};
  const inTotalMap = {};
  const awbMap = {};
  const incomingMeta = {};
  inResult.recordset.forEach(r => {
    if (!incomingMap[r.ProdKey]) incomingMap[r.ProdKey] = {};
    incomingMap[r.ProdKey][r.farmName] = (incomingMap[r.ProdKey][r.farmName] || 0) + r.inQty;
    inPriceMap[r.ProdKey] = r.inPrice;
    inTotalMap[r.ProdKey] = (inTotalMap[r.ProdKey] || 0) + r.inTotal;
    awbMap[r.ProdKey] = r.awb || '';
    if (!incomingMeta[r.ProdKey]) {
      incomingMeta[r.ProdKey] = {
        country: r.country,
        flower: r.flower,
        prodName: r.prodName,
        unit: r.OutUnit || '',
        productDescr: r.productDescr || '',
      };
    }
  });

  const adjustMap = {};
  adjustResult.recordset.forEach(r => {
    const qty = Number(r.adjustQty || 0);
    if (!qty) return;
    adjustMap[r.ProdKey] = (adjustMap[r.ProdKey] || 0) + qty;
    if (!incomingMap[r.ProdKey]) incomingMap[r.ProdKey] = {};
    incomingMap[r.ProdKey][STOCK_ADJUST_FARM] = (incomingMap[r.ProdKey][STOCK_ADJUST_FARM] || 0) + qty;
    if (!incomingMeta[r.ProdKey]) {
      incomingMeta[r.ProdKey] = {
        country: r.country,
        flower: r.flower,
        prodName: r.prodName,
        unit: r.OutUnit || '',
        productDescr: r.productDescr || '',
      };
    }
  });

  const orderMap = {};
  orderResult.recordset.forEach(r => {
    if (!orderMap[r.ProdKey]) {
      orderMap[r.ProdKey] = {
        country: r.country,
        flower: r.flower,
        prodName: r.prodName,
        unit: r.OutUnit,
        productDescr: r.productDescr || '',
        cost: r.cost || 0,
        area: r.area,
        custOrders: {},
        custKeys: {},
        descr: '',
      };
    }
    if (r.descr) orderMap[r.ProdKey].descr = r.descr;
    orderMap[r.ProdKey].custOrders[r.CustName] = (orderMap[r.ProdKey].custOrders[r.CustName] || 0) + r.outQty;
    orderMap[r.ProdKey].custKeys[r.CustName] = r.CustKey;
  });

  const custSet = new Set();
  const customers = [];
  orderResult.recordset.forEach(r => {
    const key = `${r.area}|${r.CustName}`;
    if (!custSet.has(key)) {
      custSet.add(key);
      customers.push({
        custKey: r.CustKey,
        area: r.area,
        custName: r.CustName,
        orderCode: r.OrderCode,
        custDescr: r.custDescr || '',
      });
    }
  });
  outCustResult.recordset.forEach(r => {
    const key = `${r.area}|${r.custName}`;
    if (!custSet.has(key)) {
      custSet.add(key);
      customers.push({
        custKey: r.custKey,
        area: r.area,
        custName: r.custName,
        orderCode: r.orderCode,
        custDescr: r.custDescr || '',
      });
    }
  });
  customers.sort((a, b) => `${a.area}${a.custName}`.localeCompare(`${b.area}${b.custName}`));

  const outCustKeysMap = {};
  outCustResult.recordset.forEach(r => {
    if (!outCustKeysMap[r.prodKey]) outCustKeysMap[r.prodKey] = {};
    outCustKeysMap[r.prodKey][r.custName] = r.custKey;
  });

  const farmSet = new Set();
  inResult.recordset.forEach(r => farmSet.add(r.farmName));
  adjustResult.recordset.forEach(r => {
    if (Number(r.adjustQty || 0) !== 0) farmSet.add(STOCK_ADJUST_FARM);
  });
  const farms = [...farmSet].sort();

  const prodKeys = new Set([
    ...Object.keys(orderMap).map(Number),
    ...Object.keys(incomingMap).map(Number),
    ...Object.keys(adjustMap).map(Number),
    ...Object.keys(outOrdersMap).map(Number),
  ]);

  const rows = [...prodKeys].map(prodKey => {
    const item = orderMap[prodKey];
    const meta = incomingMeta[prodKey] || {};
    const incoming = incomingMap[prodKey] || {};
    const orders = item?.custOrders || {};
    const totalIncoming = Object.values(incoming).reduce((a, b) => a + Number(b || 0), 0);
    const prevStock = prevStockMap[prodKey] || 0;
    const totalOrder = Object.values(orders).reduce((a, b) => a + Number(b || 0), 0);
    const noneOut = Math.max(0, totalOrder - totalIncoming);
    const curStock = prevStock + totalIncoming - totalOrder;

    const custKeys = { ...(item?.custKeys || {}), ...(outCustKeysMap[prodKey] || {}) };
    const costOrders = {};
    Object.entries(custKeys).forEach(([custName, custKey]) => {
      const individualCost = priceMap[custKey]?.[prodKey];
      costOrders[custName] = individualCost != null ? individualCost : (item?.cost || 0);
    });

    const flowerVal = item?.flower || meta.flower || '';
    const rawProdName = item?.prodName || meta.prodName || '';

    return {
      country: item?.country || meta.country || '',
      flower: flowerVal,
      prodName: cleanPivotProdName(rawProdName, flowerVal),
      unit: item?.unit || meta.unit || '',
      productDescr: item?.productDescr || meta.productDescr || '',
      area: item?.area || '',
      prodKey,
      prevStock,
      orders,
      outOrders: outOrdersMap[prodKey] || {},
      costOrders,
      distCostOrders: distCostMap[prodKey] || {},
      totalOrder,
      incoming,
      totalIncoming,
      // compact(exe) 뷰용 단일값 요약 — 02.주문/03.입고 1열 표시
      summary: { totalOrder, totalIncoming },
      stockAdjust: adjustMap[prodKey] || 0,
      confirmedOut: confirmedOutMap[prodKey] || 0,
      noneOut,
      curStock,
      descr: item?.descr || '',
      cost: item?.cost || 0,
      outDate: outDateMap[prodKey] || '',
      inPrice: inPriceMap[prodKey] || 0,
      inTotal: inTotalMap[prodKey] || 0,
      awb: awbMap[prodKey] || '',
      // 도착원가 — 운송기준원가 탭 displayArrivalKRW 와 동일값 (per-displayUnit: 박스/단/송이 자동 분기)
      // 0 이면 해당 차수에 freight 데이터 없음 (입고 없는 품목 포함).
      arrivalCost: arrivalMap[prodKey]?.arrivalCost || 0,
      // 메타 — UI 엔지니어가 단위 표시/디버깅에 활용 가능. 계약 필드는 arrivalCost 만.
      arrivalMeta: arrivalMap[prodKey]
        ? {
            displayUnit: arrivalMap[prodKey].displayUnit,
            source: arrivalMap[prodKey].source,
            arrivalPerStem: arrivalMap[prodKey].arrivalPerStem || 0,
            arrivalPerBunch: arrivalMap[prodKey].arrivalPerBunch ?? null,
          }
        : null,
    };
  });

  rows.sort((a, b) => `${a.country}${a.flower}${a.prodName}`.localeCompare(`${b.country}${b.flower}${b.prodName}`));

  return {
    success: true,
    orderYear: startYear,
    weekStart: weekStartNorm,
    weekEnd: wEnd,
    customers,
    farms,
    rows,
  };
}

const PIVOT_WEEK_FETCH_CONCURRENCY = 6;

/** Pivot API — 범위가 2개 이상 차수면 byWeek 에 차수별 rows 추가 (exe 열 전개용) */
export async function getPivotStats({ weekStart, weekEnd, orderYear }) {
  const weekStartNorm = normalizeOrderWeek(weekStart);
  const wEnd = normalizeOrderWeek(weekEnd || weekStart);
  const startYear = resolveActiveOrderYear(weekStart, orderYear);

  const weeks = listOrderWeeksInRange(weekStartNorm, wEnd, startYear);
  const aggregated = await getPivotStatsRange({ weekStart: weekStartNorm, weekEnd: wEnd, orderYear: startYear });

  if (weeks.length <= 1) {
    return { ...aggregated, weeks };
  }

  const priceMap = await loadPriceMap();
  const byWeek = {};

  for (let i = 0; i < weeks.length; i += PIVOT_WEEK_FETCH_CONCURRENCY) {
    const batch = weeks.slice(i, i + PIVOT_WEEK_FETCH_CONCURRENCY);
    await Promise.all(batch.map(async (w) => {
      const one = await getPivotStatsRange({
        weekStart: w,
        weekEnd: w,
        orderYear: startYear,
        priceMap,
      });
      byWeek[w] = { rows: one.rows };
    }));
  }

  return { ...aggregated, weeks, byWeek };
}
