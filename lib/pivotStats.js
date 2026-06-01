import { query, sql } from './db';
import { buildOrderYearWeek, normalizeOrderWeek, normalizeOrderYear } from './orderUtils';

function yearWeekExpr(alias) {
  return `${alias}.OrderYear + REPLACE(${alias}.OrderWeek, '-', '')`;
}

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

export async function getPivotStats({ weekStart, weekEnd, orderYear }) {
  if (!weekStart) throw new Error('weekStart 필요');

  const weekStartNorm = normalizeOrderWeek(weekStart);
  const wEnd = normalizeOrderWeek(weekEnd || weekStart);
  const startYear = normalizeOrderYear(weekStart, orderYear || new Date().getFullYear().toString());
  const endYear = normalizeOrderYear(weekEnd || weekStart, startYear);
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

  const outResult = await query(
    `SELECT sd.ProdKey, SUM(sd.OutQuantity) AS outQty,
      MAX(CONVERT(NVARCHAR(10), sd.ShipmentDtm, 120)) AS outDate
     FROM ShipmentDetail sd
     JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey AND sm.isDeleted = 0
     WHERE sm.OrderYearWeek >= @yws AND sm.OrderYearWeek <= @ywe
       AND ISNULL(sd.isFix, 0) = 1
     GROUP BY sd.ProdKey`,
    rangeParams
  );

  const priceResult = await query(`SELECT CustKey, ProdKey, Cost FROM CustomerProdCost`);

  const priceMap = {};
  priceResult.recordset.forEach(r => {
    if (!priceMap[r.CustKey]) priceMap[r.CustKey] = {};
    priceMap[r.CustKey][r.ProdKey] = r.Cost;
  });

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
  customers.sort((a, b) => `${a.area}${a.custName}`.localeCompare(`${b.area}${b.custName}`));

  const farmSet = new Set();
  inResult.recordset.forEach(r => farmSet.add(r.farmName));
  const farms = [...farmSet].sort();

  const prodKeys = new Set([
    ...Object.keys(orderMap).map(Number),
    ...Object.keys(incomingMap).map(Number),
  ]);

  const rows = [...prodKeys].map(prodKey => {
    const item = orderMap[prodKey];
    const meta = incomingMeta[prodKey] || {};
    const incoming = incomingMap[prodKey] || {};
    const totalIncoming = Object.values(incoming).reduce((a, b) => a + b, 0);
    const prevStock = prevStockMap[prodKey] || 0;
    const totalOrder = item ? Object.values(item.custOrders).reduce((a, b) => a + b, 0) : 0;
    const noneOut = Math.max(0, totalOrder - totalIncoming);
    const curStock = prevStock + totalIncoming - totalOrder;

    const custKeys = item?.custKeys || {};
    const costOrders = {};
    Object.entries(custKeys).forEach(([custName, custKey]) => {
      const individualCost = priceMap[custKey]?.[prodKey];
      costOrders[custName] = individualCost != null ? individualCost : (item?.cost || 0);
    });

    return {
      country: item?.country || meta.country || '',
      flower: item?.flower || meta.flower || '',
      prodName: item?.prodName || meta.prodName || '',
      unit: item?.unit || meta.unit || '',
      productDescr: item?.productDescr || meta.productDescr || '',
      area: item?.area || '',
      prodKey,
      prevStock,
      orders: item?.custOrders || {},
      costOrders,
      totalOrder,
      incoming,
      totalIncoming,
      confirmedOut: confirmedOutMap[prodKey] || 0,
      noneOut,
      curStock,
      descr: item?.descr || '',
      cost: item?.cost || 0,
      outDate: outDateMap[prodKey] || '',
      inPrice: inPriceMap[prodKey] || 0,
      inTotal: inTotalMap[prodKey] || 0,
      awb: awbMap[prodKey] || '',
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
