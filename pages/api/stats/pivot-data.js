// pages/api/stats/pivot-data.js
// Pivot 통계 데이터 API
// 수정이력: 2026-03-30 — 농장명(입고) 열 추가, CustomerProdCost 개별단가 추가

import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const { weekStart, weekEnd } = req.query;
  if (!weekStart) return res.status(400).json({ success: false, error: 'weekStart 필요' });
  const wEnd = weekEnd || weekStart;

  try {
    // ── 1. 주문 데이터 (02.주문) — 거래처별
    const orderResult = await query(
      `SELECT
        p.CounName AS country, p.FlowerName AS flower, p.ProdName AS prodName,
        p.ProdKey, p.OutUnit, ISNULL(p.Cost,0) AS cost,
        c.CustKey, c.CustName, c.CustArea AS area, c.OrderCode, ISNULL(c.Descr,'') AS custDescr,
        om.OrderWeek AS week,
        -- 14차 패턴: Box+Bunch+Steam 합 = 주문수량
        (ISNULL(od.BoxQuantity,0)+ISNULL(od.BunchQuantity,0)+ISNULL(od.SteamQuantity,0)) AS outQty,
        ISNULL(od.Descr,'') AS descr
       FROM OrderMaster om
       JOIN Customer c     ON om.CustKey = c.CustKey AND c.isDeleted = 0
       JOIN OrderDetail od  ON om.OrderMasterKey = od.OrderMasterKey AND od.isDeleted = 0
       JOIN Product p      ON od.ProdKey = p.ProdKey AND p.isDeleted = 0
       WHERE om.OrderWeek >= @ws AND om.OrderWeek <= @we AND om.isDeleted = 0
       ORDER BY p.CounName, p.FlowerName, p.ProdName, c.CustArea, c.CustName`,
      { ws:{type:sql.NVarChar,value:weekStart}, we:{type:sql.NVarChar,value:wEnd} }
    );

    // ── 2. 입고 데이터 (03.입고) — 농장별
    const inResult = await query(
      `SELECT
        p.CounName AS country, p.FlowerName AS flower, p.ProdName AS prodName,
        p.ProdKey,
        wm.FarmName AS farmName,
        wm.OrderNo AS awb,
        wm.InputDate AS inDate,
        ISNULL(wd.UPrice, 0) AS inPrice,
        ISNULL(wd.TPrice, 0) AS inTotal,
        ISNULL(wd.OutQuantity, 0) AS inQty
       FROM WarehouseDetail wd
       JOIN WarehouseMaster wm ON wd.WarehouseKey = wm.WarehouseKey AND wm.isDeleted = 0
       JOIN Product p ON wd.ProdKey = p.ProdKey
       WHERE wm.OrderWeek >= @ws AND wm.OrderWeek <= @we
       ORDER BY p.CounName, p.FlowerName, p.ProdName, wm.FarmName`,
      { ws:{type:sql.NVarChar,value:weekStart}, we:{type:sql.NVarChar,value:wEnd} }
    );

    // ── 3. 전재고 — 이전 확정 차수
    const stockResult = await query(
      `SELECT p.ProdKey, ISNULL(ps.Stock,0) AS prevStock
       FROM Product p
       LEFT JOIN ProductStock ps ON ps.ProdKey = p.ProdKey AND ps.StockKey = (
         SELECT TOP 1 StockKey FROM StockMaster
         WHERE OrderWeek < @ws AND isFix = 1
         ORDER BY OrderWeek DESC
       )
       WHERE p.isDeleted = 0`,
      { ws:{type:sql.NVarChar,value:weekStart} }
    );

    // ── 4. 출고 데이터 (확정된 것)
    const outResult = await query(
      `SELECT sd.ProdKey, SUM(sd.OutQuantity) AS outQty,
        MAX(CONVERT(NVARCHAR(10), sd.ShipmentDtm, 120)) AS outDate
       FROM ShipmentDetail sd
       JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey AND sm.isDeleted = 0
       WHERE sm.OrderWeek >= @ws AND sm.OrderWeek <= @we AND sm.isFix = 1
       GROUP BY sd.ProdKey`,
      { ws:{type:sql.NVarChar,value:weekStart}, we:{type:sql.NVarChar,value:wEnd} }
    );

    // ── 5. 개별단가 (CustomerProdCost)
    const priceResult = await query(
      `SELECT CustKey, ProdKey, Cost FROM CustomerProdCost`
    );

    // ── 개별단가 맵: priceMap[custKey][prodKey] = cost
    const priceMap = {};
    priceResult.recordset.forEach(r => {
      if (!priceMap[r.CustKey]) priceMap[r.CustKey] = {};
      priceMap[r.CustKey][r.ProdKey] = r.Cost;
    });

    // ── 맵 구성
    const prevStockMap = {};
    stockResult.recordset.forEach(r => { prevStockMap[r.ProdKey] = r.prevStock||0; });

    const outDateMap = {};
    const confirmedOutMap = {};
    outResult.recordset.forEach(r => {
      confirmedOutMap[r.ProdKey] = r.outQty||0;
      outDateMap[r.ProdKey] = r.outDate||'';
    });

    // 농장 입고 맵 { prodKey: { farmName: qty } }
    const incomingMap = {};
    const inPriceMap  = {};
    const inTotalMap  = {};
    const awbMap      = {};
    inResult.recordset.forEach(r => {
      if (!incomingMap[r.ProdKey]) incomingMap[r.ProdKey] = {};
      incomingMap[r.ProdKey][r.farmName] = (incomingMap[r.ProdKey][r.farmName]||0) + r.inQty;
      inPriceMap[r.ProdKey]  = r.inPrice;
      inTotalMap[r.ProdKey]  = (inTotalMap[r.ProdKey]||0) + r.inTotal;
      awbMap[r.ProdKey]      = r.awb||'';
    });

    // 주문 맵 { prodKey: { custName: qty } }
    const orderMap = {};
    orderResult.recordset.forEach(r => {
      if (!orderMap[r.ProdKey]) {
        orderMap[r.ProdKey] = {
          country:r.country, flower:r.flower, prodName:r.prodName,
          unit:r.OutUnit, cost:r.cost||0, area:r.area, custOrders:{}, custKeys:{}, descr:''
        };
      }
      if (r.descr) orderMap[r.ProdKey].descr = r.descr;
      orderMap[r.ProdKey].custOrders[r.CustName] = (orderMap[r.ProdKey].custOrders[r.CustName]||0) + r.outQty;
      orderMap[r.ProdKey].custKeys[r.CustName] = r.CustKey;
    });

    // 거래처 목록
    const custSet = new Set();
    const customers = [];
    orderResult.recordset.forEach(r => {
      const key = r.area+'|'+r.CustName;
      if (!custSet.has(key)) { custSet.add(key); customers.push({area:r.area, custName:r.CustName, orderCode:r.OrderCode, custDescr:r.custDescr||''}); }
    });
    customers.sort((a,b) => (a.area+a.custName).localeCompare(b.area+b.custName));

    // 농장 목록
    const farmSet = new Set();
    inResult.recordset.forEach(r => farmSet.add(r.farmName));
    const farms = [...farmSet].sort();

    // 행 생성
    const prodKeys = new Set([
      ...Object.keys(orderMap).map(Number),
      ...Object.keys(incomingMap).map(Number),
    ]);

    const rows = [...prodKeys].map(prodKey => {
      const item = orderMap[prodKey];
      const incoming = incomingMap[prodKey] || {};
      const totalIncoming = Object.values(incoming).reduce((a,b)=>a+b, 0);
      const prevStock  = prevStockMap[prodKey] || 0;
      const totalOrder = item ? Object.values(item.custOrders).reduce((a,b)=>a+b, 0) : 0;
      const noneOut    = Math.max(0, totalOrder - totalIncoming);
      const curStock   = prevStock + totalIncoming - totalOrder;

      // 업체별 개별단가 맵 { custName: cost }
      const custKeys  = item?.custKeys || {};
      const costOrders = {};
      Object.entries(custKeys).forEach(([custName, custKey]) => {
        const individualCost = priceMap[custKey]?.[prodKey];
        costOrders[custName] = individualCost != null ? individualCost : (item?.cost || 0);
      });

      return {
        country:    item?.country || inResult.recordset.find(r=>r.ProdKey===prodKey)?.country || '',
        flower:     item?.flower  || inResult.recordset.find(r=>r.ProdKey===prodKey)?.flower  || '',
        prodName:   item?.prodName|| inResult.recordset.find(r=>r.ProdKey===prodKey)?.prodName|| '',
        unit:       item?.unit    || '',
        area:       item?.area    || '',
        prodKey,
        prevStock,
        orders:     item?.custOrders || {},
        costOrders,
        totalOrder,
        incoming,
        totalIncoming,
        noneOut,
        curStock,
        descr:      item?.descr          || '',
        cost:       item?.cost           || 0,
        outDate:    outDateMap[prodKey]  || '',
        inPrice:    inPriceMap[prodKey]  || 0,
        inTotal:    inTotalMap[prodKey]  || 0,
        awb:        awbMap[prodKey]      || '',
      };
    });

    rows.sort((a,b) => (a.country+a.flower+a.prodName).localeCompare(b.country+b.flower+b.prodName));

    return res.status(200).json({
      success: true,
      weekStart, weekEnd: wEnd,
      customers,
      farms,
      rows,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
