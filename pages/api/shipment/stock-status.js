// pages/api/shipment/stock-status.js
// GET  ?weekFrom&weekTo&view=products|customers|managers|pivot  → 조회
// PATCH { custKey, prodKey, week, outQty, descrLog }             → 출고수량 수정 + 비고 로그
// POST  { action:'addOrder', custKey, prodKey, week, qty }       → 주문 추가/수정
// DELETE { custKey, prodKey, week, lineIdx }                     → 수정내역 특정 줄 삭제

import { query, withTransaction, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

// MAX(Key)+1 안전 INSERT — HOLDLOCK + PK 충돌 시 자동 재시도
async function safeNextKey(tQ, table, keyCol, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    const r = await tQ(
      `SELECT ISNULL(MAX(${keyCol}),0)+1 AS nk FROM ${table} WITH (UPDLOCK, HOLDLOCK)`, {}
    );
    return r.recordset[0].nk;
  }
}

export default withAuth(async function handler(req, res) {
  if (req.method === 'PATCH' && req.body?.action === 'editDescrLine') return await editDescrLine(req, res);
  if (req.method === 'PATCH')  return await updateOutQty(req, res);
  if (req.method === 'POST' && req.body?.action === 'addOrderDelta') return await addOrderDelta(req, res);
  if (req.method === 'POST')   return await addOrder(req, res);
  if (req.method === 'DELETE') return await deleteDescrLine(req, res);
  if (req.method === 'PUT')    return await saveStartStock(req, res);
  if (req.method !== 'GET')    return res.status(405).end();

  // 차수 파라미터
  let { weekFrom, weekTo, week, view, prodKey } = req.query;
  if (week && !weekFrom) { weekFrom = week; weekTo = week; }
  if (!weekFrom) return res.status(400).json({ success: false, error: 'weekFrom 필요' });
  if (!weekTo) weekTo = weekFrom;

  // YYYY-WW-SS → WW-SS (DB 저장 형식으로 정규화)
  const normWeek = w => w.match(/^\d{4}-(\d{2}-\d{2})$/) ? w.match(/^\d{4}-(\d{2}-\d{2})$/)[1] : w;
  weekFrom = normWeek(weekFrom);
  weekTo   = normWeek(weekTo);

  const params = {
    weekFrom: { type: sql.NVarChar, value: weekFrom },
    weekTo:   { type: sql.NVarChar, value: weekTo },
  };

  // GET은 읽기 전용 — DB 수정하지 않음

  try {
    // ── 품목별: 이월재고 + 입고/출고/주문 + 차수별 세부
    if (view === 'products' || !view) {
      const totalResult = await query(
        `SELECT
          p.ProdKey, p.ProdName, p.DisplayName, p.FlowerName, p.CounName, p.CountryFlower,
          p.OutUnit, p.BunchOf1Box, p.SteamOf1Box,
          -- 이월재고: weekFrom 이전 최신 ProductStock 스냅샷
          ISNULL((
            SELECT TOP 1 ps.Stock
            FROM ProductStock ps
            JOIN StockMaster sm2 ON ps.StockKey = sm2.StockKey
            WHERE ps.ProdKey = p.ProdKey AND sm2.OrderWeek <= @weekFrom
            ORDER BY sm2.OrderWeek DESC
          ), 0) AS prevStock,
          -- 기간 내 입고수량
          ISNULL((
            SELECT SUM(wd.OutQuantity) FROM WarehouseDetail wd
            JOIN WarehouseMaster wm ON wd.WarehouseKey = wm.WarehouseKey
            WHERE wd.ProdKey = p.ProdKey
              AND wm.OrderWeek >= @weekFrom AND wm.OrderWeek <= @weekTo
              AND wm.isDeleted = 0
          ), 0) AS inQty,
          -- 기간 내 출고수량 (전체 업체)
          ISNULL((
            SELECT SUM(sd.OutQuantity) FROM ShipmentDetail sd
            JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
            WHERE sd.ProdKey = p.ProdKey
              AND sm.OrderWeek >= @weekFrom AND sm.OrderWeek <= @weekTo
              AND sm.isDeleted = 0
          ), 0) AS outQty,
          -- 기간 내 주문수량 (전체 업체) — OutUnit 기준 단일 컬럼 선택
          ISNULL((
            SELECT SUM(CASE WHEN p2.OutUnit='단'  THEN ISNULL(od.BunchQuantity,0)
                            WHEN p2.OutUnit='송이' THEN ISNULL(od.SteamQuantity,0)
                            ELSE ISNULL(od.BoxQuantity,0) END)
            FROM OrderDetail od
            JOIN OrderMaster om ON od.OrderMasterKey = om.OrderMasterKey
            JOIN Product p2 ON od.ProdKey = p2.ProdKey
            WHERE od.ProdKey = p.ProdKey
              AND om.OrderWeek >= @weekFrom AND om.OrderWeek <= @weekTo
              AND om.isDeleted = 0 AND od.isDeleted = 0
          ), 0) AS orderQty
         FROM Product p
         WHERE p.isDeleted = 0
           AND EXISTS (
             SELECT 1 FROM OrderDetail od2
             JOIN OrderMaster om2 ON od2.OrderMasterKey = om2.OrderMasterKey
             WHERE od2.ProdKey = p.ProdKey
               AND om2.OrderWeek >= @weekFrom AND om2.OrderWeek <= @weekTo
               AND om2.isDeleted = 0 AND od2.isDeleted = 0
           )
         ORDER BY p.CounName, p.FlowerName, p.ProdName`,
        params
      );

      // 차수별 세부 (범위 조회 시 expandable row용)
      const detailResult = await query(
        `SELECT src.ProdKey, src.OrderWeek,
          SUM(CASE WHEN src.kind='in'  THEN src.qty ELSE 0 END) AS inQty,
          SUM(CASE WHEN src.kind='out' THEN src.qty ELSE 0 END) AS outQty,
          SUM(CASE WHEN src.kind='ord' THEN src.qty ELSE 0 END) AS orderQty
         FROM (
           SELECT wd.ProdKey, wm.OrderWeek, wd.OutQuantity AS qty, 'in' AS kind
           FROM WarehouseDetail wd JOIN WarehouseMaster wm ON wd.WarehouseKey=wm.WarehouseKey
           WHERE wm.OrderWeek >= @weekFrom AND wm.OrderWeek <= @weekTo AND wm.isDeleted=0
           UNION ALL
           SELECT sd.ProdKey, sm.OrderWeek, sd.OutQuantity, 'out'
           FROM ShipmentDetail sd JOIN ShipmentMaster sm ON sd.ShipmentKey=sm.ShipmentKey
           WHERE sm.OrderWeek >= @weekFrom AND sm.OrderWeek <= @weekTo AND sm.isDeleted=0
           UNION ALL
           -- OutUnit 기준 단일 컬럼 선택
           SELECT od.ProdKey, om.OrderWeek,
                  CASE WHEN p2.OutUnit='단'  THEN ISNULL(od.BunchQuantity,0)
                       WHEN p2.OutUnit='송이' THEN ISNULL(od.SteamQuantity,0)
                       ELSE ISNULL(od.BoxQuantity,0) END,
                  'ord'
           FROM OrderDetail od
           JOIN OrderMaster om ON od.OrderMasterKey=om.OrderMasterKey
           JOIN Product p2 ON od.ProdKey=p2.ProdKey
           WHERE om.OrderWeek >= @weekFrom AND om.OrderWeek <= @weekTo
             AND om.isDeleted=0 AND od.isDeleted=0
         ) AS src
         GROUP BY src.ProdKey, src.OrderWeek
         ORDER BY src.ProdKey, src.OrderWeek`,
        params
      );

      const detailMap = {};
      detailResult.recordset.forEach(r => {
        if (!detailMap[r.ProdKey]) detailMap[r.ProdKey] = [];
        detailMap[r.ProdKey].push({ week: r.OrderWeek, inQty: r.inQty, outQty: r.outQty, orderQty: r.orderQty });
      });

      const products = totalResult.recordset.map(p => ({
        ...p,
        weekDetail: detailMap[p.ProdKey] || [],
      }));

      return res.status(200).json({ success: true, products });
    }

    // ── 업체별: 해당 업체 출고수량 + 전체 입고/주문/출고 기준 잔량
    if (view === 'customers') {
      // prodKey 필터 (품목별 탭 업체분포 조회용)
      const pkFilter = prodKey ? 'AND od.ProdKey = @pk' : '';
      if (prodKey) params.pk = { type: sql.Int, value: parseInt(prodKey) };

      const result = await query(
        `SELECT
          c.CustKey, c.CustName, c.CustArea, c.Manager,
          ISNULL(c.Descr, '') AS CustDescr,
          p.ProdKey, p.ProdName, p.DisplayName, p.FlowerName, p.CounName, p.OutUnit,
          om.OrderWeek,
          -- OutUnit 기준 단일 컬럼 선택
          CASE WHEN p.OutUnit='단'  THEN ISNULL(od.BunchQuantity,0)
               WHEN p.OutUnit='송이' THEN ISNULL(od.SteamQuantity,0)
               ELSE ISNULL(od.BoxQuantity,0) END AS custOrderQty,
          ISNULL(sd.OutQuantity,   0) AS outQty,
          CONVERT(NVARCHAR(16), sd.ShipmentDtm, 120) AS outCreateDtm,
          ISNULL(sd.Descr, '') AS outDescr,
          ISNULL(sm.isFix, 0) AS isFix,
          sd.SdetailKey,
          ISNULL((
            SELECT TOP 1 ps.Stock FROM ProductStock ps
            JOIN StockMaster sm2 ON ps.StockKey = sm2.StockKey
            WHERE ps.ProdKey = p.ProdKey AND sm2.OrderWeek <= @weekFrom
            ORDER BY sm2.OrderWeek DESC
          ), 0) AS prevStock,
          ISNULL((
            SELECT SUM(CASE WHEN p2.OutUnit='단'  THEN ISNULL(od2.BunchQuantity,0)
                            WHEN p2.OutUnit='송이' THEN ISNULL(od2.SteamQuantity,0)
                            ELSE ISNULL(od2.BoxQuantity,0) END)
            FROM OrderDetail od2
            JOIN OrderMaster om2 ON od2.OrderMasterKey=om2.OrderMasterKey
            JOIN Product p2 ON od2.ProdKey=p2.ProdKey
            WHERE od2.ProdKey=p.ProdKey AND om2.OrderWeek=om.OrderWeek
              AND om2.isDeleted=0 AND od2.isDeleted=0
          ), 0) AS totalOrderQty,
          ISNULL((
            SELECT SUM(wd.OutQuantity) FROM WarehouseDetail wd
            JOIN WarehouseMaster wm2 ON wd.WarehouseKey=wm2.WarehouseKey
            WHERE wd.ProdKey=p.ProdKey AND wm2.OrderWeek=om.OrderWeek AND wm2.isDeleted=0
          ), 0) AS totalInQty,
          ISNULL((
            SELECT SUM(sd2.OutQuantity) FROM ShipmentDetail sd2
            JOIN ShipmentMaster sm2 ON sd2.ShipmentKey=sm2.ShipmentKey
            WHERE sd2.ProdKey=p.ProdKey AND sm2.OrderWeek=om.OrderWeek AND sm2.isDeleted=0
          ), 0) AS totalOutQty
         FROM OrderMaster om
         JOIN Customer c      ON om.CustKey = c.CustKey
         JOIN OrderDetail od  ON om.OrderMasterKey = od.OrderMasterKey AND od.isDeleted=0 ${pkFilter}
         JOIN Product p       ON od.ProdKey = p.ProdKey
         OUTER APPLY (
           SELECT TOP 1 sm2.ShipmentKey, sm2.isFix
           FROM ShipmentMaster sm2
           WHERE sm2.CustKey=om.CustKey AND sm2.OrderWeek=om.OrderWeek AND sm2.isDeleted=0
           ORDER BY sm2.isFix DESC
         ) sm
         LEFT JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey AND sd.ProdKey=p.ProdKey
         WHERE om.OrderWeek >= @weekFrom AND om.OrderWeek <= @weekTo AND om.isDeleted=0
         ORDER BY c.CustArea, c.CustName, om.OrderWeek, p.CounName, p.FlowerName, p.ProdName`,
        params
      );
      return res.status(200).json({ success: true, rows: result.recordset });
    }

    // ── 담당자별
    if (view === 'managers') {
      const result = await query(
        `SELECT
          ISNULL(c.Manager, '미지정') AS Manager,
          c.CustKey, c.CustName, c.CustArea,
          p.ProdKey, p.ProdName, p.DisplayName, p.FlowerName, p.CounName, p.OutUnit,
          om.OrderWeek,
          -- OutUnit 기준 단일 컬럼 선택
          CASE WHEN p.OutUnit='단'  THEN ISNULL(od.BunchQuantity,0)
               WHEN p.OutUnit='송이' THEN ISNULL(od.SteamQuantity,0)
               ELSE ISNULL(od.BoxQuantity,0) END AS custOrderQty,
          ISNULL(sd.OutQuantity, 0) AS outQty,
          CONVERT(NVARCHAR(16), sd.ShipmentDtm, 120) AS outCreateDtm,
          ISNULL((
            SELECT TOP 1 ps.Stock FROM ProductStock ps
            JOIN StockMaster sm2 ON ps.StockKey=sm2.StockKey
            WHERE ps.ProdKey=p.ProdKey AND sm2.OrderWeek <= @weekFrom
            ORDER BY sm2.OrderWeek DESC
          ), 0) AS prevStock,
          ISNULL((
            SELECT SUM(CASE WHEN p2.OutUnit='단'  THEN ISNULL(od2.BunchQuantity,0)
                            WHEN p2.OutUnit='송이' THEN ISNULL(od2.SteamQuantity,0)
                            ELSE ISNULL(od2.BoxQuantity,0) END)
            FROM OrderDetail od2
            JOIN OrderMaster om2 ON od2.OrderMasterKey=om2.OrderMasterKey
            JOIN Product p2 ON od2.ProdKey=p2.ProdKey
            WHERE od2.ProdKey=p.ProdKey AND om2.OrderWeek=om.OrderWeek
              AND om2.isDeleted=0 AND od2.isDeleted=0
          ), 0) AS totalOrderQty,
          ISNULL((
            SELECT SUM(wd.OutQuantity) FROM WarehouseDetail wd
            JOIN WarehouseMaster wm2 ON wd.WarehouseKey=wm2.WarehouseKey
            WHERE wd.ProdKey=p.ProdKey AND wm2.OrderWeek=om.OrderWeek AND wm2.isDeleted=0
          ), 0) AS totalInQty,
          ISNULL((
            SELECT SUM(sd2.OutQuantity) FROM ShipmentDetail sd2
            JOIN ShipmentMaster sm2 ON sd2.ShipmentKey=sm2.ShipmentKey
            WHERE sd2.ProdKey=p.ProdKey AND sm2.OrderWeek=om.OrderWeek AND sm2.isDeleted=0
          ), 0) AS totalOutQty
         FROM OrderMaster om
         JOIN Customer c      ON om.CustKey=c.CustKey
         JOIN OrderDetail od  ON om.OrderMasterKey=od.OrderMasterKey AND od.isDeleted=0
         JOIN Product p       ON od.ProdKey=p.ProdKey
         LEFT JOIN ShipmentMaster sm ON sm.CustKey=om.CustKey AND sm.OrderWeek=om.OrderWeek AND sm.isDeleted=0
         LEFT JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey AND sd.ProdKey=p.ProdKey
         WHERE om.OrderWeek >= @weekFrom AND om.OrderWeek <= @weekTo AND om.isDeleted=0
         ORDER BY Manager, c.CustArea, c.CustName, om.OrderWeek, p.CounName, p.FlowerName`,
        params
      );
      return res.status(200).json({ success: true, rows: result.recordset });
    }

    // ── 모아보기 피벗
    if (view === 'pivot') {
      const result = await query(
        `SELECT
          c.CustKey, c.CustName, c.CustArea,
          p.ProdKey, p.ProdName, p.DisplayName, p.FlowerName, p.CounName,
          om.OrderWeek,
          ISNULL(sd.OutQuantity, 0) AS outQty
         FROM OrderMaster om
         JOIN Customer c     ON om.CustKey=c.CustKey
         JOIN OrderDetail od ON om.OrderMasterKey=od.OrderMasterKey AND od.isDeleted=0
         JOIN Product p      ON od.ProdKey=p.ProdKey
         LEFT JOIN ShipmentMaster sm ON sm.CustKey=om.CustKey AND sm.OrderWeek=om.OrderWeek AND sm.isDeleted=0
         LEFT JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey AND sd.ProdKey=p.ProdKey
         WHERE om.OrderWeek >= @weekFrom AND om.OrderWeek <= @weekTo
           AND om.isDeleted=0 AND ISNULL(sd.OutQuantity,0)>0
         ORDER BY c.CustArea, c.CustName, p.CounName, p.FlowerName`,
        params
      );
      return res.status(200).json({ success: true, rows: result.recordset });
    }

    // ── 확정재고 조회 (ProductStock에서 isFix=1 확정 스냅샷)
    if (view === 'confirmedStock') {
      const result = await query(
        `SELECT p.ProdKey, sm.OrderWeek, ps.Stock
         FROM Product p
         CROSS APPLY (
           SELECT TOP 1 ps2.Stock, sm2.OrderWeek
           FROM ProductStock ps2
           JOIN StockMaster sm2 ON ps2.StockKey = sm2.StockKey
           WHERE ps2.ProdKey = p.ProdKey AND sm2.OrderWeek <= @weekTo
           ORDER BY sm2.OrderWeek DESC
         ) ps
         CROSS APPLY (
           SELECT TOP 1 sm3.OrderWeek
           FROM StockMaster sm3
           WHERE sm3.OrderWeek <= @weekTo AND sm3.isFix IN (1,2)
           ORDER BY sm3.OrderWeek DESC
         ) sm
         WHERE p.isDeleted = 0`,
        params
      );
      const stocks = {};
      (result.recordset||[]).forEach(r => { stocks[`${r.ProdKey}-${r.OrderWeek}`] = r.Stock; });
      return res.status(200).json({ success: true, stocks });
    }

    // ── 시작재고 조회 (isFix=2 마커)
    if (view === 'startStocks') {
      const result = await query(
        `SELECT ps.ProdKey, sm.OrderWeek, ps.Stock
         FROM ProductStock ps
         JOIN StockMaster sm ON ps.StockKey=sm.StockKey
         WHERE sm.isFix=2
           AND sm.OrderWeek >= @weekFrom AND sm.OrderWeek <= @weekTo`,
        params
      );
      return res.status(200).json({ success: true, rows: result.recordset });
    }

    // ── EstQuantity 불일치 확인 (읽기 전용)
    if (view === 'checkEstQty') {
      const result = await query(
        `SELECT sd.SdetailKey, sd.ProdKey, sd.CustKey, sd.OutQuantity, sd.EstQuantity,
                sd.BoxQuantity, sd.BunchQuantity, sd.SteamQuantity, sd.Cost, sd.Amount,
                CONVERT(NVARCHAR(16), sd.ShipmentDtm, 120) AS ShipmentDtm,
                sm.OrderWeek, p.ProdName, c.CustName
         FROM ShipmentDetail sd
         JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
         LEFT JOIN Product p ON sd.ProdKey = p.ProdKey
         LEFT JOIN Customer c ON sd.CustKey = c.CustKey
         WHERE sm.OrderWeek >= @weekFrom AND sm.OrderWeek <= @weekTo AND sm.isDeleted = 0
           AND (ISNULL(sd.EstQuantity, 0) != ISNULL(sd.OutQuantity, 0)
                OR sd.OutQuantity = 0)`,
        params
      );
      return res.status(200).json({ success: true, rows: result.recordset });
    }

    // ── stockMasterDiag: StockMaster + ProductStock 구조 진단
    // /api/shipment/stock-status?view=stockMasterDiag&weekFrom=14-01&weekTo=15-01&prodKey=389
    if (view === 'stockMasterDiag') {
      const pk = parseInt(req.query.prodKey) || null;

      // 1) 해당 기간 StockMaster 전체 (isFix, OrderWeek, StockKey)
      const smList = await query(
        `SELECT StockKey, OrderWeek, ISNULL(isFix, -999) AS isFix,
                CONVERT(NVARCHAR(16), CreateDtm, 120) AS CreateDtm,
                ISNULL(CreateID, '') AS CreateID
           FROM StockMaster
          WHERE OrderWeek >= @weekFrom AND OrderWeek <= @weekTo
          ORDER BY OrderWeek, StockKey`,
        params
      );

      // 2) isFix 값별 카운트
      const isFixDist = await query(
        `SELECT ISNULL(isFix, -999) AS isFix, COUNT(*) AS cnt
           FROM StockMaster
          WHERE OrderWeek >= @weekFrom AND OrderWeek <= @weekTo
          GROUP BY ISNULL(isFix, -999)
          ORDER BY ISNULL(isFix, -999)`,
        params
      );

      // 3) prodKey 있으면 해당 품목의 ProductStock 전체
      let prodStock = [];
      let testConfirmedStock = null;
      let testConfirmedStockInt = null;
      let testConfirmedStockBit = null;
      if (pk) {
        const ps = await query(
          `SELECT ps.StockKey, sm.OrderWeek, ISNULL(sm.isFix,-999) AS isFix,
                  CAST(sm.isFix AS INT) AS isFixInt,
                  ps.Stock,
                  CONVERT(NVARCHAR(16), sm.CreateDtm, 120) AS SMCreateDtm
             FROM ProductStock ps
             JOIN StockMaster sm ON ps.StockKey = sm.StockKey
            WHERE ps.ProdKey = @pk
              AND sm.OrderWeek >= @weekFrom AND sm.OrderWeek <= @weekTo
            ORDER BY sm.OrderWeek, ps.StockKey`,
          { ...params, pk: { type: sql.Int, value: pk } }
        );
        prodStock = ps.recordset;

        // negativeStock 서브쿼리와 동일 로직 직접 실행 — 디버그
        // weekTo 를 기준으로 < weekTo (즉 15-01 이전) 확정 재고 찾기
        const tcs = await query(
          `SELECT TOP 1 ps.Stock, sm2.OrderWeek, sm2.isFix
             FROM ProductStock ps
             JOIN StockMaster sm2 ON ps.StockKey = sm2.StockKey
            WHERE ps.ProdKey = @pk
              AND sm2.OrderWeek < @weekTo
              AND sm2.isFix = 1
            ORDER BY sm2.OrderWeek DESC`,
          { ...params, pk: { type: sql.Int, value: pk } }
        );
        testConfirmedStock = tcs.recordset[0] || null;

        // int 캐스팅 비교
        const tcs2 = await query(
          `SELECT TOP 1 ps.Stock, sm2.OrderWeek, sm2.isFix
             FROM ProductStock ps
             JOIN StockMaster sm2 ON ps.StockKey = sm2.StockKey
            WHERE ps.ProdKey = @pk
              AND sm2.OrderWeek < @weekTo
              AND CAST(sm2.isFix AS INT) = 1
            ORDER BY sm2.OrderWeek DESC`,
          { ...params, pk: { type: sql.Int, value: pk } }
        );
        testConfirmedStockInt = tcs2.recordset[0] || null;

        // isFix=1 대신 <> 0 로 비교
        const tcs3 = await query(
          `SELECT TOP 1 ps.Stock, sm2.OrderWeek, sm2.isFix
             FROM ProductStock ps
             JOIN StockMaster sm2 ON ps.StockKey = sm2.StockKey
            WHERE ps.ProdKey = @pk
              AND sm2.OrderWeek < @weekTo
              AND sm2.isFix <> 0
            ORDER BY sm2.OrderWeek DESC`,
          { ...params, pk: { type: sql.Int, value: pk } }
        );
        testConfirmedStockBit = tcs3.recordset[0] || null;
      }

      // 4) 해당 품목의 ShipmentDetail 합계 차수별 (검증용)
      let shipSummary = [];
      if (pk) {
        const ss = await query(
          `SELECT sm.OrderWeek, ISNULL(sm.isFix,-999) AS smIsFix,
                  SUM(sd.OutQuantity) AS outSum
             FROM ShipmentDetail sd
             JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
            WHERE sd.ProdKey = @pk
              AND sm.OrderWeek >= @weekFrom AND sm.OrderWeek <= @weekTo
              AND ISNULL(sm.isDeleted,0) = 0
            GROUP BY sm.OrderWeek, ISNULL(sm.isFix,-999)
            ORDER BY sm.OrderWeek`,
          { ...params, pk: { type: sql.Int, value: pk } }
        );
        shipSummary = ss.recordset;
      }

      // 5) 해당 품목의 WarehouseDetail 합계 차수별 (입고)
      let whSummary = [];
      if (pk) {
        const wh = await query(
          `SELECT wm.OrderWeek, SUM(wd.OutQuantity) AS inSum
             FROM WarehouseDetail wd
             JOIN WarehouseMaster wm ON wd.WarehouseKey = wm.WarehouseKey
            WHERE wd.ProdKey = @pk
              AND wm.OrderWeek >= @weekFrom AND wm.OrderWeek <= @weekTo
              AND ISNULL(wm.isDeleted,0) = 0
            GROUP BY wm.OrderWeek
            ORDER BY wm.OrderWeek`,
          { ...params, pk: { type: sql.Int, value: pk } }
        );
        whSummary = wh.recordset;
      }

      return res.status(200).json({
        success: true,
        filter: { weekFrom: req.query.weekFrom, weekTo: req.query.weekTo, prodKey: pk },
        stockMasterList: smList.recordset,
        isFixDistribution: isFixDist.recordset,
        productStock: prodStock,
        shipmentSummary: shipSummary,
        warehouseSummary: whSummary,
        testConfirmedStock,
        testConfirmedStockInt,
        testConfirmedStockBit,
      });
    }

    // ── custDiag: 거래처+차수 ShipmentDetail 전체 진단 (모든 필드)
    // /api/shipment/stock-status?view=custDiag&custName=동산&weekFrom=15-01&weekTo=15-02
    if (view === 'custDiag') {
      const custName = req.query.custName || '';
      const dParams = { ...params, cn: { type: sql.NVarChar, value: `%${custName}%` } };
      const result = await query(
        `SELECT sd.SdetailKey, sd.ShipmentKey, sd.ProdKey, sd.CustKey,
                sd.OutQuantity, sd.EstQuantity,
                sd.BoxQuantity, sd.BunchQuantity, sd.SteamQuantity,
                sd.Cost, sd.Amount, sd.Vat,
                CONVERT(NVARCHAR(16), sd.ShipmentDtm, 120) AS ShipmentDtm,
                sm.OrderWeek, sm.isFix AS smIsFix,
                p.ProdName, ISNULL(p.FlowerName,'') AS FlowerName,
                ISNULL(p.OutUnit,'') AS OutUnit,
                ISNULL(p.BunchOf1Box,0) AS BunchOf1Box,
                ISNULL(p.SteamOf1Box,0) AS SteamOf1Box,
                ISNULL(p.SteamOf1Bunch,0) AS SteamOf1Bunch,
                ISNULL(p.Cost,0) AS pCost,
                c.CustName,
                ISNULL(sd.Descr,'') AS Descr,
                -- 13/14차 패턴 검증값 계산
                CASE WHEN ISNULL(sd.OutQuantity,0) <> ISNULL(sd.EstQuantity,0)
                     THEN 'OUT≠EST' ELSE '' END AS check1,
                CASE WHEN ISNULL(sd.BoxQuantity,0) <> ISNULL(sd.OutQuantity,0)
                     THEN 'BOX≠OUT' ELSE '' END AS check2,
                CASE WHEN ABS(ISNULL(sd.BunchQuantity,0) - ISNULL(sd.OutQuantity,0)*ISNULL(p.BunchOf1Box,0)) > 0.01
                     THEN 'BUNCH≠OUT*B1B' ELSE '' END AS check3,
                CASE WHEN ABS(ISNULL(sd.SteamQuantity,0) - ISNULL(sd.OutQuantity,0)*ISNULL(p.SteamOf1Box,0)) > 0.01
                     THEN 'STEAM≠OUT*S1B' ELSE '' END AS check4
         FROM ShipmentDetail sd
         JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
         JOIN Customer c ON sm.CustKey = c.CustKey
         LEFT JOIN Product p ON sd.ProdKey = p.ProdKey
         WHERE sm.OrderWeek >= @weekFrom AND sm.OrderWeek <= @weekTo
           AND ISNULL(sm.isDeleted,0) = 0
           AND c.CustName LIKE @cn
         ORDER BY sm.OrderWeek, p.ProdName`,
        dParams
      );
      // OrderDetail 매칭 (참고용)
      const odResult = await query(
        `SELECT od.OrderDetailKey, od.ProdKey, od.OutQuantity AS odOutQty,
                od.BoxQuantity AS odBox, od.BunchQuantity AS odBunch, od.SteamQuantity AS odSteam,
                om.OrderWeek, c.CustName
         FROM OrderMaster om
         JOIN OrderDetail od ON om.OrderMasterKey = od.OrderMasterKey AND ISNULL(od.isDeleted,0)=0
         JOIN Customer c ON om.CustKey = c.CustKey
         WHERE om.OrderWeek >= @weekFrom AND om.OrderWeek <= @weekTo
           AND ISNULL(om.isDeleted,0) = 0
           AND c.CustName LIKE @cn`,
        dParams
      );
      // 요약: 불일치 카운트
      const rows = result.recordset;
      const summary = {
        total: rows.length,
        outNeqEst: rows.filter(r => r.check1).length,
        boxNeqOut: rows.filter(r => r.check2).length,
        bunchNeqExpected: rows.filter(r => r.check3).length,
        steamNeqExpected: rows.filter(r => r.check4).length,
        zeroOut: rows.filter(r => (r.OutQuantity||0) === 0).length,
      };
      return res.status(200).json({
        success: true,
        custName,
        weekFrom: req.query.weekFrom,
        weekTo: req.query.weekTo,
        summary,
        shipmentDetails: rows,
        orderDetails: odResult.recordset,
      });
    }

    // ── DB 기준 잔량 마이너스 품목 찾기 (전산 확정 방식 동일)
    // 선택적 필터: country (CounName / CountryFlower like), flower (FlowerName / ProdName like)
    //   예: view=negativeStock&weekFrom=15-01&weekTo=15-01&country=콜롬비아&flower=카네이션
    if (view === 'negativeStock') {
      const countryQ = (req.query.country || '').trim();
      const flowerQ  = (req.query.flower  || '').trim();
      const filterParams = { ...params };
      let filterWhere = '';
      if (countryQ) {
        filterWhere += ` AND (p.CounName LIKE @country OR p.CountryFlower LIKE @country)`;
        filterParams.country = { type: sql.NVarChar, value: `%${countryQ}%` };
      }
      if (flowerQ) {
        filterWhere += ` AND (p.FlowerName LIKE @flower OR p.ProdName LIKE @flower)`;
        filterParams.flower = { type: sql.NVarChar, value: `%${flowerQ}%` };
      }
      const result = await query(
        `SELECT p.ProdKey, p.ProdName, p.DisplayName, p.FlowerName, p.CounName,
          ISNULL(p.CountryFlower,'') AS CountryFlower,
          ISNULL(p.OutUnit,'') AS OutUnit,
          -- 시작재고: weekFrom 이전 차수 중 전산 생성(isFix IS NULL) 또는 확정(isFix=1) ProductStock
          -- 실측 결과:
          --   전산 생성: isFix = NULL (14차 14-01, 14-02 확인)
          --   웹 임의값: isFix = 0/false (웹 전용 startStock)
          --   전산 확정: isFix = 1 (안전 fallback)
          -- 가장 최근 레코드를 기준으로 잡되, isFix=false(0) 인 웹 임의값은 제외
          ISNULL((
            SELECT TOP 1 ps.Stock FROM ProductStock ps
            JOIN StockMaster sm2 ON ps.StockKey = sm2.StockKey
            WHERE ps.ProdKey = p.ProdKey
              AND sm2.OrderWeek < @weekFrom
              AND (sm2.isFix IS NULL OR sm2.isFix = 1)
            ORDER BY sm2.OrderWeek DESC
          ), 0) AS confirmedStock,
          -- 어느 차수 재고를 기준으로 했는지 (디버깅용)
          (
            SELECT TOP 1 sm2.OrderWeek FROM ProductStock ps
            JOIN StockMaster sm2 ON ps.StockKey = sm2.StockKey
            WHERE ps.ProdKey = p.ProdKey
              AND sm2.OrderWeek < @weekFrom
              AND (sm2.isFix IS NULL OR sm2.isFix = 1)
            ORDER BY sm2.OrderWeek DESC
          ) AS baseWeek,
          ISNULL((
            SELECT SUM(wd.OutQuantity) FROM WarehouseDetail wd
            JOIN WarehouseMaster wm ON wd.WarehouseKey = wm.WarehouseKey
            WHERE wd.ProdKey = p.ProdKey AND wm.OrderWeek >= @weekFrom AND wm.OrderWeek <= @weekTo AND wm.isDeleted = 0
          ), 0) AS inQty,
          ISNULL((
            SELECT SUM(sd.OutQuantity) FROM ShipmentDetail sd
            JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
            WHERE sd.ProdKey = p.ProdKey AND sm.OrderWeek >= @weekFrom AND sm.OrderWeek <= @weekTo AND sm.isDeleted = 0
          ), 0) AS outQty,
          -- 업체별 출고 수량 집계 (어느 거래처가 몇 개 가져갔는지)
          (
            SELECT c.CustName, SUM(sd.OutQuantity) AS qty
            FROM ShipmentDetail sd
            JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
            JOIN Customer c ON sm.CustKey = c.CustKey
            WHERE sd.ProdKey = p.ProdKey
              AND sm.OrderWeek >= @weekFrom AND sm.OrderWeek <= @weekTo
              AND sm.isDeleted = 0 AND sd.OutQuantity > 0
            GROUP BY c.CustName
            ORDER BY SUM(sd.OutQuantity) DESC
            FOR JSON PATH
          ) AS custBreakdown
         FROM Product p
         WHERE p.isDeleted = 0
           ${filterWhere}
           AND EXISTS (
             SELECT 1 FROM ShipmentDetail sd2
             JOIN ShipmentMaster sm3 ON sd2.ShipmentKey = sm3.ShipmentKey
             WHERE sd2.ProdKey = p.ProdKey AND sm3.OrderWeek >= @weekFrom AND sm3.OrderWeek <= @weekTo AND sm3.isDeleted = 0 AND sd2.OutQuantity > 0
           )
         ORDER BY p.CounName, p.FlowerName, p.ProdName`,
        filterParams
      );
      const rows = result.recordset.map(r => ({
        ...r,
        custBreakdown: r.custBreakdown ? JSON.parse(r.custBreakdown) : [],
        remain: (r.confirmedStock||0) + (r.inQty||0) - (r.outQty||0)
      }));
      const negative = rows.filter(r => r.remain < 0);
      return res.status(200).json({
        success: true,
        filter: { country: countryQ || null, flower: flowerQ || null, weekFrom: req.query.weekFrom, weekTo: req.query.weekTo },
        total: rows.length,
        negativeCount: negative.length,
        negative,
        all: rows,
      });
    }

    // ── SdetailKey로 특정 ShipmentDetail 삭제
    if (view === 'deleteSdetail') {
      const sdk = parseInt(req.query.sdk);
      if (!sdk) return res.status(400).json({ success: false, error: 'sdk 필요' });
      const result = await query(
        `DELETE FROM ShipmentDetail WHERE SdetailKey=@sdk`,
        { sdk: { type: sql.Int, value: sdk } }
      );
      return res.status(200).json({ success: true, message: `sdk=${sdk} 삭제`, rowsAffected: result.rowsAffected });
    }

    // ── 고스트 출고 레코드 찾기 (주문 없이 출고만 있는 ShipmentDetail)
    if (view === 'ghostShipments') {
      const result = await query(
        `SELECT sd.SdetailKey, sd.ProdKey, sd.OutQuantity, sd.EstQuantity, sd.CustKey,
                sm.OrderWeek, sm.ShipmentKey, p.ProdName, p.DisplayName, p.FlowerName, c.CustName,
                CONVERT(NVARCHAR(16), sd.ShipmentDtm, 120) AS ShipmentDtm
         FROM ShipmentDetail sd
         JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
         LEFT JOIN Product p ON sd.ProdKey = p.ProdKey
         LEFT JOIN Customer c ON sm.CustKey = c.CustKey
         WHERE sm.OrderWeek >= @weekFrom AND sm.OrderWeek <= @weekTo AND sm.isDeleted = 0
           AND sd.ProdKey = @pk AND sd.OutQuantity > 0`,
        { ...params, pk: { type: sql.Int, value: parseInt(req.query.prodKey) } }
      );
      return res.status(200).json({ success: true, rows: result.recordset });
    }

    // ── OutQuantity=0 빈 ShipmentDetail 정리 (전산 확정 차단 원인)
    if (view === 'cleanupZero') {
      const result = await query(
        `DELETE sd FROM ShipmentDetail sd
         JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
         WHERE sm.OrderWeek >= @weekFrom AND sm.OrderWeek <= @weekTo AND sm.isDeleted = 0
           AND ISNULL(sd.OutQuantity, 0) = 0`,
        params
      );
      return res.status(200).json({ success: true, message: '빈 레코드 정리', rowsAffected: result.rowsAffected });
    }

    // ── EstQuantity 동기화 (OutQuantity != EstQuantity 보정)
    if (view === 'syncEstQty') {
      const result = await query(
        `UPDATE sd SET sd.EstQuantity = sd.OutQuantity
         FROM ShipmentDetail sd
         JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
         WHERE sm.OrderWeek >= @weekFrom AND sm.OrderWeek <= @weekTo AND sm.isDeleted = 0
           AND ISNULL(sd.EstQuantity, 0) != ISNULL(sd.OutQuantity, 0)`,
        params
      );
      return res.status(200).json({ success: true, message: `동기화 완료`, rowsAffected: result.rowsAffected });
    }

    return res.status(400).json({ success: false, error: 'view 파라미터 필요' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── PATCH: 출고수량 수정 + 비고 로그 저장
async function updateOutQty(req, res) {
  const { custKey, prodKey, week, outQty, shipDate, descrLog, mode } = req.body;
  if (!custKey || !prodKey || !week) {
    return res.status(400).json({ success: false, error: 'custKey, prodKey, week 필요' });
  }
  try {
    const qty = parseFloat(outQty) || 0;
    const ck  = parseInt(custKey);
    const pk  = parseInt(prodKey);
    const uid = req.user?.userId || 'system';

    // ── 업체별 BaseOutDay 조회 → 기존 전산 동일 로직으로 출고일 계산
    // 기준: 해당 주의 수요일 + BaseOutDay별 오프셋 (차수 -01/-02 무관)
    // BaseOutDay=0→수(+0), 6→금(+2), 1→일(+4), 2→월(+5), 3→화(+6), 4→목(+1), 5→토(+3)
    const custInfo = await query(
      `SELECT BaseOutDay FROM Customer WHERE CustKey=@ck`,
      { ck: { type: sql.Int, value: ck } }
    );
    const baseOutDay = custInfo.recordset[0]?.BaseOutDay ?? 0;

    function calcShipDate(weekStr, baseDay) {
      try {
        const weekNum = parseInt(weekStr.split('-')[0], 10);
        const yr = new Date().getFullYear();
        // getCurrentWeek()과 동일한 단순 7일 분할: week N = day (N-1)*7+1 ~ N*7
        const dayStart = (weekNum - 1) * 7 + 1;
        const dateStart = new Date(yr, 0, dayStart); // day 1 = Jan 1
        // 해당 7일 구간 내 수요일(getDay()=3) 찾기
        const wednesday = new Date(dateStart);
        for (let i = 0; i < 7; i++) {
          if (wednesday.getDay() === 3) break;
          wednesday.setDate(wednesday.getDate() + 1);
        }
        // BaseOutDay → 수요일 기준 오프셋 (DB 실데이터 검증 완료)
        //   0=수(+0), 1=일(+4), 2=월(+5), 3=화(+6), 4=목(+1), 5=토(+3), 6=금(+2)
        const offsets = [0, 4, 5, 6, 1, 3, 2];
        const offset = offsets[baseDay] ?? 0;
        wednesday.setDate(wednesday.getDate() + offset);
        // 로컬 날짜 포맷 (toISOString은 UTC 변환으로 KST에서 하루 밀림)
        return `${wednesday.getFullYear()}-${String(wednesday.getMonth()+1).padStart(2,'0')}-${String(wednesday.getDate()).padStart(2,'0')}`;
      } catch { return null; }
    }

    const computedDate = calcShipDate(week, baseOutDay);
    const finalDate = computedDate || shipDate || null;
    const shipDtmExpr = finalDate ? `CAST(@shipDate AS DATETIME)` : `GETDATE()`;
    const shipDtmParam = finalDate ? { shipDate: { type: sql.NVarChar, value: finalDate } } : {};

    await withTransaction(async (tQ) => {
      // ── 1단계: 기존 ShipmentDetail 먼저 찾기 (어떤 ShipmentMaster에 있든)
      // 전산이 만든 레코드도 찾을 수 있도록 CustKey 없이 ProdKey+OrderWeek로 검색
      const existSD = await tQ(
        `SELECT sd.SdetailKey, sd.ShipmentKey, sd.OutQuantity
         FROM ShipmentDetail sd
         JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
         WHERE sm.CustKey=@ck AND sm.OrderWeek=@wk AND sm.isDeleted=0 AND sd.ProdKey=@pk`,
        { ck: { type: sql.Int, value: ck }, wk: { type: sql.NVarChar, value: week }, pk: { type: sql.Int, value: pk } }
      );
      // CustKey 없는 ShipmentMaster도 검색 (전산이 CustKey 없이 만든 경우)
      let existSD2 = { recordset: [] };
      if (existSD.recordset.length === 0) {
        existSD2 = await tQ(
          `SELECT sd.SdetailKey, sd.ShipmentKey, sd.OutQuantity
           FROM ShipmentDetail sd
           JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
           WHERE sm.OrderWeek=@wk AND sm.isDeleted=0 AND sd.ProdKey=@pk AND sd.CustKey=@ck`,
          { wk: { type: sql.NVarChar, value: week }, pk: { type: sql.Int, value: pk }, ck: { type: sql.Int, value: ck } }
        );
      }
      const foundSD = existSD.recordset[0] || existSD2.recordset[0] || null;

      // ── 2단계: ShipmentMaster 결정 (전산 것 우선, 중복 생성 절대 금지)
      let sk;
      if (foundSD) {
        sk = foundSD.ShipmentKey; // 기존 레코드가 있는 ShipmentMaster 사용
      } else {
        // 해당 업체+차수의 모든 ShipmentMaster 검색 (isFix=1 우선)
        const sm = await tQ(
          `SELECT ShipmentKey, isFix FROM ShipmentMaster WITH (UPDLOCK, HOLDLOCK)
           WHERE CustKey=@ck AND OrderWeek=@wk AND isDeleted=0
           ORDER BY isFix DESC`,
          { ck: { type: sql.Int, value: ck }, wk: { type: sql.NVarChar, value: week } }
        );
        if (sm.recordset.length > 0) {
          sk = sm.recordset[0].ShipmentKey; // isFix=1(전산 확정) 우선
        } else {
          // ShipmentMaster가 정말 없을 때만 생성
          const newSk = await safeNextKey(tQ, 'ShipmentMaster', 'ShipmentKey');
          await tQ(
            `INSERT INTO ShipmentMaster (ShipmentKey,OrderWeek,CustKey,isFix,isDeleted,CreateID,CreateDtm)
             VALUES(@newSk,@wk,@ck,0,0,@uid,GETDATE())`,
            { newSk: { type: sql.Int, value: newSk }, wk: { type: sql.NVarChar, value: week },
              ck: { type: sql.Int, value: ck }, uid: { type: sql.NVarChar, value: uid } }
          );
          sk = newSk;
        }
      }

      // Product 환산정보 조회 (전산과 동일 구조: Box/Bunch/Steam)
      const prodInfo = await tQ(
        `SELECT BunchOf1Box, SteamOf1Box FROM Product WHERE ProdKey=@pk`,
        { pk: { type: sql.Int, value: pk } }
      );
      const bunchOf1Box = prodInfo.recordset[0]?.BunchOf1Box || 1;
      const steamOf1Box = prodInfo.recordset[0]?.SteamOf1Box || 1;

      // ── 3단계: ShipmentDetail UPDATE/DELETE/INSERT
      const sd = { recordset: foundSD ? [foundSD] : [] };

      if (sd.recordset.length > 0) {
        const targetSdk = foundSD.SdetailKey;
        // delta 모드: 기존값 + delta, absolute 모드: 그대로
        let finalQty = qty;
        if (mode === 'delta') {
          finalQty = (foundSD.OutQuantity || 0) + qty;
        }
        if (finalQty <= 0) {
          await tQ(`DELETE FROM ShipmentDetail WHERE SdetailKey=@sdk`,
            { sdk: { type: sql.Int, value: targetSdk } });
        } else {
          // 전산 동일 구조: Box=qty, Bunch=qty*bunchOf1Box, Steam=qty*steamOf1Box
          await tQ(
            `UPDATE ShipmentDetail SET OutQuantity=@qty, EstQuantity=@qty,
              BoxQuantity=@bq, BunchQuantity=@bnq, SteamQuantity=@sq,
              ShipmentDtm=${shipDtmExpr}
             WHERE SdetailKey=@sdk`,
            { qty: { type: sql.Float, value: finalQty },
              bq:  { type: sql.Float, value: finalQty },
              bnq: { type: sql.Float, value: finalQty * bunchOf1Box },
              sq:  { type: sql.Float, value: finalQty * steamOf1Box },
              sdk: { type: sql.Int, value: targetSdk }, ...shipDtmParam }
          );
        }
      } else if ((mode === 'delta' ? qty : qty) > 0) {
        // SdetailKey는 IDENTITY 아님 → 안전한 MAX+1
        const nk = await safeNextKey(tQ, 'ShipmentDetail', 'SdetailKey');
        const insertQty = qty > 0 ? qty : 0;
        if (insertQty > 0) {
          await tQ(
            `INSERT INTO ShipmentDetail (SdetailKey,ShipmentKey,CustKey,ProdKey,ShipmentDtm,OutQuantity,EstQuantity,BoxQuantity,BunchQuantity,SteamQuantity)
             VALUES(@nk,@sk,@ck,@pk,${shipDtmExpr},@qty,@qty,@bq,@bnq,@sq)`,
            { nk:  { type: sql.Int,   value: nk  },
              sk:  { type: sql.Int,   value: sk  },
              ck:  { type: sql.Int,   value: ck  },
              pk:  { type: sql.Int,   value: pk  },
              qty: { type: sql.Float, value: insertQty },
              bq:  { type: sql.Float, value: insertQty },
              bnq: { type: sql.Float, value: insertQty * bunchOf1Box },
              sq:  { type: sql.Float, value: insertQty * steamOf1Box },
              ...shipDtmParam }
          );
        }
      }
    });

    // descrLog 있으면 ShipmentDetail.Descr에 추가 (수량 관계없이 기록)
    if (descrLog) {
      const now = new Date().toISOString().replace('T',' ').slice(0,16);
      const logLine = `[${now}] ${descrLog}`;
      await query(
        `UPDATE ShipmentDetail SET Descr = ISNULL(Descr,'') + @log
         WHERE ShipmentKey=(SELECT ShipmentKey FROM ShipmentMaster WHERE CustKey=@ck AND OrderWeek=@wk AND isDeleted=0)
         AND ProdKey=@pk`,
        { log:  { type: sql.NVarChar, value: '\n' + logLine },
          ck:   { type: sql.Int,      value: ck },
          wk:   { type: sql.NVarChar, value: week },
          pk:   { type: sql.Int,      value: pk } }
      );
    }
    return res.status(200).json({ success: true, message: '출고수량 수정 완료' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ── DELETE: 수정내역 특정 줄 삭제
async function deleteDescrLine(req, res) {
  const { custKey, prodKey, week: rawWeek, lineIdx } = req.body;
  if (custKey === undefined || !prodKey || !rawWeek || lineIdx === undefined) {
    return res.status(400).json({ success: false, error: 'custKey, prodKey, week, lineIdx 필요' });
  }
  const week = rawWeek.match(/^\d{4}-(\d{2}-\d{2})$/) ? rawWeek.match(/^\d{4}-(\d{2}-\d{2})$/)[1] : rawWeek;
  try {
    const ck = parseInt(custKey);
    const pk = parseInt(prodKey);
    const idx = parseInt(lineIdx);
    const r = await query(
      `SELECT sd.SdetailKey, sd.Descr FROM ShipmentDetail sd
       JOIN ShipmentMaster sm ON sd.ShipmentKey=sm.ShipmentKey
       WHERE sm.CustKey=@ck AND sm.OrderWeek=@wk AND sm.isDeleted=0 AND sd.ProdKey=@pk`,
      { ck: { type: sql.Int, value: ck }, wk: { type: sql.NVarChar, value: week },
        pk: { type: sql.Int, value: pk } }
    );
    if (!r.recordset.length) return res.status(404).json({ success: false, error: '데이터 없음' });
    const { SdetailKey, Descr } = r.recordset[0];
    const lines = (Descr || '').split('\n').filter(l => l.trim());
    if (idx < 0 || idx >= lines.length) return res.status(400).json({ success: false, error: '잘못된 인덱스' });
    lines.splice(idx, 1);
    const newDescr = lines.join('\n');
    await query(
      `UPDATE ShipmentDetail SET Descr=@d WHERE SdetailKey=@k`,
      { d: { type: sql.NVarChar, value: newDescr }, k: { type: sql.Int, value: SdetailKey } }
    );
    return res.status(200).json({ success: true, lines });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ── PATCH action=editDescrLine: 수정내역 특정 줄 텍스트 수정
async function editDescrLine(req, res) {
  const { custKey, prodKey, week: rawWeek, lineIdx, newText } = req.body;
  if (custKey === undefined || !prodKey || !rawWeek || lineIdx === undefined || newText === undefined) {
    return res.status(400).json({ success: false, error: 'custKey, prodKey, week, lineIdx, newText 필요' });
  }
  const week = rawWeek.match(/^\d{4}-(\d{2}-\d{2})$/) ? rawWeek.match(/^\d{4}-(\d{2}-\d{2})$/)[1] : rawWeek;
  try {
    const ck = parseInt(custKey);
    const pk = parseInt(prodKey);
    const idx = parseInt(lineIdx);
    const r = await query(
      `SELECT sd.SdetailKey, sd.Descr FROM ShipmentDetail sd
       JOIN ShipmentMaster sm ON sd.ShipmentKey=sm.ShipmentKey
       WHERE sm.CustKey=@ck AND sm.OrderWeek=@wk AND sm.isDeleted=0 AND sd.ProdKey=@pk`,
      { ck: { type: sql.Int, value: ck }, wk: { type: sql.NVarChar, value: week },
        pk: { type: sql.Int, value: pk } }
    );
    if (!r.recordset.length) return res.status(404).json({ success: false, error: '데이터 없음' });
    const { SdetailKey, Descr } = r.recordset[0];
    const lines = (Descr || '').split('\n').filter(l => l.trim());
    if (idx < 0 || idx >= lines.length) return res.status(400).json({ success: false, error: '잘못된 인덱스' });
    lines[idx] = newText.trim();
    const newDescr = lines.join('\n');
    await query(
      `UPDATE ShipmentDetail SET Descr=@d WHERE SdetailKey=@k`,
      { d: { type: sql.NVarChar, value: newDescr }, k: { type: sql.Int, value: SdetailKey } }
    );
    return res.status(200).json({ success: true, lines });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ── POST: 주문 추가/수정 (OrderMaster + OrderDetail)
// DB 로그 기록 헬퍼 (AppLog 테이블 필요 — 없으면 무시)
async function appLog(category, step, detail, isError = false) {
  try {
    await query(
      `INSERT INTO AppLog (Category, Step, Detail, IsError) VALUES (@cat, @step, @detail, @err)`,
      { cat: { type: sql.NVarChar, value: category }, step: { type: sql.NVarChar, value: step },
        detail: { type: sql.NVarChar, value: String(detail) }, err: { type: sql.Bit, value: isError ? 1 : 0 } }
    );
  } catch { /* AppLog 테이블 없으면 무시 */ }
}

async function addOrder(req, res) {
  const { action, custKey, prodKey, week, qty, unit } = req.body;
  if (action !== 'addOrder') return res.status(400).json({ success: false, error: 'action=addOrder 필요' });
  if (!custKey || !prodKey || !week) {
    return res.status(400).json({ success: false, error: 'custKey, prodKey, week 필요' });
  }
  try {
    const ck       = parseInt(custKey);
    const pk       = parseInt(prodKey);
    const quantity = parseFloat(qty) || 0;
    const uid      = req.user?.userId || 'system';
    const userName = req.user?.userName || uid;
    const now = new Date();
    const timeStr = `${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    // YYYY-WW-SS → WW-SS 정규화
    const normWeek = week.match(/^\d{4}-(\d{2}-\d{2})$/) ? week.match(/^\d{4}-(\d{2}-\d{2})$/)[1] : week;
    const normYear = week.match(/^(\d{4})-/) ? week.match(/^(\d{4})-/)[1] : String(new Date().getFullYear());

    // 단위별 수량 분배 (박스/단/송이)
    const boxQty   = unit === '박스' ? quantity : 0;
    const bunchQty = unit === '단'   ? quantity : 0;
    const steamQty = unit === '송이' ? quantity : 0;

    await appLog('addOrder', '시작', `ck=${ck} pk=${pk} week=${normWeek} qty=${quantity} unit=${unit} uid=${uid}`);

    await withTransaction(async (tQ) => {
      // OrderMaster 찾기 또는 생성
      const om = await tQ(
        `SELECT TOP 1 OrderMasterKey FROM OrderMaster WITH (UPDLOCK, HOLDLOCK)
         WHERE CustKey=@ck AND OrderWeek=@wk AND isDeleted=0
         ORDER BY OrderMasterKey ASC`,
        { ck: { type: sql.Int, value: ck }, wk: { type: sql.NVarChar, value: normWeek } }
      );

      let mk;
      if (om.recordset.length === 0) {
        mk = await safeNextKey(tQ, 'OrderMaster', 'OrderMasterKey');
        await appLog('addOrder', 'OM_INSERT', `new mk=${mk} ck=${ck} wk=${normWeek}`);
        await tQ(
          `INSERT INTO OrderMaster (OrderMasterKey,OrderDtm,OrderYear,OrderWeek,CustKey,isDeleted,CreateID,CreateDtm)
           VALUES(@mk,GETDATE(),@yr,@wk,@ck,0,@uid,GETDATE())`,
          { mk: { type: sql.Int, value: mk }, yr: { type: sql.NVarChar, value: normYear },
            wk: { type: sql.NVarChar, value: normWeek },
            ck: { type: sql.Int, value: ck }, uid: { type: sql.NVarChar, value: 'admin' } }
        );
      } else {
        mk = om.recordset[0].OrderMasterKey;
        await appLog('addOrder', 'OM_FOUND', `mk=${mk}`);
      }

      // OrderDetail: 있으면 UPDATE, qty=0이면 삭제, 없으면 INSERT
      const od = await tQ(
        `SELECT od.OrderDetailKey, od.BoxQuantity, od.BunchQuantity, od.SteamQuantity, p.OutUnit
           FROM OrderDetail od JOIN Product p ON od.ProdKey=p.ProdKey
           WHERE od.OrderMasterKey=@mk AND od.ProdKey=@pk AND od.isDeleted=0`,
        { mk: { type: sql.Int, value: mk }, pk: { type: sql.Int, value: pk } }
      );

      if (od.recordset.length > 0) {
        const existing = od.recordset[0];
        const detailKey = existing.OrderDetailKey;
        const outUnit = existing.OutUnit || '박스';
        const oldQty = outUnit === '단' ? (existing.BunchQuantity || 0)
                     : outUnit === '송이' ? (existing.SteamQuantity || 0)
                     : (existing.BoxQuantity || 0);
        if (quantity <= 0) {
          await appLog('addOrder', 'OD_DELETE', `dk=${detailKey}`);
          await tQ(
            `UPDATE OrderDetail SET isDeleted=1 WHERE OrderMasterKey=@mk AND ProdKey=@pk`,
            { mk: { type: sql.Int, value: mk }, pk: { type: sql.Int, value: pk } }
          );
          await insertOrderHistory(tQ, detailKey, String(oldQty), '0', `[${timeStr} ${userName}] 차수피벗 삭제`, uid);
        } else {
          await appLog('addOrder', 'OD_UPDATE', `dk=${detailKey} box=${boxQty} bunch=${bunchQty} steam=${steamQty}`);
          await tQ(
            `UPDATE OrderDetail SET BoxQuantity=@bq, BunchQuantity=@bnq, SteamQuantity=@sq, OutQuantity=@oq,
               LastUpdateID=@uid, LastUpdateDtm=GETDATE()
             WHERE OrderMasterKey=@mk AND ProdKey=@pk AND isDeleted=0`,
            {
              bq:  { type: sql.Float,    value: boxQty },
              bnq: { type: sql.Float,    value: bunchQty },
              sq:  { type: sql.Float,    value: steamQty },
              oq:  { type: sql.Float,    value: quantity },
              uid: { type: sql.NVarChar, value: uid },
              mk:  { type: sql.Int,      value: mk },
              pk:  { type: sql.Int,      value: pk },
            }
          );
          if (oldQty !== quantity) {
            await insertOrderHistory(tQ, detailKey, String(oldQty), String(quantity), `[${timeStr} ${userName}] 차수피벗 수정`, uid);
          }
        }
      } else if (quantity > 0) {
        const nextKey = await safeNextKey(tQ, 'OrderDetail', 'OrderDetailKey');
        await appLog('addOrder', 'OD_INSERT', `nk=${nextKey} mk=${mk} pk=${pk} box=${boxQty} bunch=${bunchQty} steam=${steamQty}`);
        await tQ(
          `INSERT INTO OrderDetail (OrderDetailKey,OrderMasterKey,ProdKey,OutQuantity,NoneOutQuantity,BoxQuantity,BunchQuantity,SteamQuantity,isDeleted,CreateID,CreateDtm)
           VALUES(@nk,@mk,@pk,@oq,0,@bq,@bnq,@sq,0,@uid,GETDATE())`,
          {
            nk:  { type: sql.Int,   value: nextKey },
            mk:  { type: sql.Int,   value: mk },      pk:  { type: sql.Int,   value: pk },
            oq:  { type: sql.Float, value: quantity },
            bq:  { type: sql.Float, value: boxQty },
            bnq: { type: sql.Float, value: bunchQty }, sq:  { type: sql.Float, value: steamQty },
            uid: { type: sql.NVarChar, value: 'admin' },
          }
        );
        await insertOrderHistory(tQ, nextKey, '0', String(quantity), `[${timeStr} ${userName}] 차수피벗 추가`, uid);
      } else {
        await appLog('addOrder', 'OD_SKIP', `qty=0이고 기존 없음 — 아무것도 안함`);
      }
    });

    await appLog('addOrder', '완료', `ck=${ck} pk=${pk} wk=${normWeek}`);
    return res.status(200).json({ success: true, message: '주문 추가/수정 완료' });
  } catch (err) {
    await appLog('addOrder', '오류', err.message, true);
    return res.status(500).json({ success: false, error: err.message });
  }
}

// OrderHistory INSERT 공통 헬퍼 — 차수피벗/주문관리 양쪽에서 일관된 이력 기록
async function insertOrderHistory(tQ, detailKey, before, after, descr, uid) {
  try {
    await tQ(
      `INSERT INTO OrderHistory
         (OrderDetailKey, ChangeType, ColumName, BeforeValue, AfterValue, Descr, ChangeID, ChangeDtm)
       VALUES (@dk, '수정', '수량', @before, @after, @descr, @uid, GETDATE())`,
      {
        dk:     { type: sql.Int,      value: detailKey },
        before: { type: sql.NVarChar, value: before },
        after:  { type: sql.NVarChar, value: after },
        descr:  { type: sql.NVarChar, value: descr },
        uid:    { type: sql.NVarChar, value: uid },
      }
    );
  } catch (e) {
    // OrderHistory 실패시 전체 트랜잭션 롤백 방지 — 경고 로그만
    console.warn('[OrderHistory INSERT failed]', e.message);
  }
}

// ── PUT: 시작재고(startStock) 저장
// { prodKey, week, stock, remark }
// StockMaster에 isFix=2(시작재고 전용) 레코드를 사용하여 ProductStock에 저장
async function saveStartStock(req, res) {
  const { prodKey, week, stock, remark } = req.body;
  if (!prodKey || !week) {
    return res.status(400).json({ success: false, error: 'prodKey, week 필요' });
  }
  try {
    const pk      = parseInt(prodKey);
    const stockVal = parseFloat(stock) || 0;
    const remarkVal = remark || '';

    await withTransaction(async (tQ) => {
      // StockMaster: isFix=2 를 시작재고 전용 마커로 사용
      let smResult = await tQ(
        `SELECT StockKey FROM StockMaster WITH (UPDLOCK, HOLDLOCK) WHERE OrderWeek=@wk AND isFix=2`,
        { wk: { type: sql.NVarChar, value: week } }
      );

      let sk;
      if (smResult.recordset.length === 0) {
        const ins = await tQ(
          `INSERT INTO StockMaster (OrderWeek, isFix) OUTPUT INSERTED.StockKey VALUES (@wk, 2)`,
          { wk: { type: sql.NVarChar, value: week } }
        );
        sk = ins.recordset[0].StockKey;
      } else {
        sk = smResult.recordset[0].StockKey;
      }

      // ProductStock upsert (시작재고)
      await tQ(
        `MERGE INTO ProductStock WITH (HOLDLOCK) AS t
         USING (VALUES (@pk, @sk)) AS s(ProdKey, StockKey) ON t.ProdKey=s.ProdKey AND t.StockKey=s.StockKey
         WHEN MATCHED THEN UPDATE SET Stock=@stock
         WHEN NOT MATCHED THEN INSERT (ProdKey, StockKey, Stock) VALUES (@pk, @sk, @stock);`,
        { pk: { type: sql.Int, value: pk }, sk: { type: sql.Int, value: sk }, stock: { type: sql.Float, value: stockVal } }
      );
    });

    return res.status(200).json({ success: true, message: '시작재고 저장 완료' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ── POST action='addOrderDelta': 기존 주문수량에 delta 합산 (기존값 + 추가값)
async function addOrderDelta(req, res) {
  const { custKey, prodKey, week, qty, unit } = req.body;
  if (!custKey || !prodKey || !week) {
    return res.status(400).json({ success: false, error: 'custKey, prodKey, week 필요' });
  }
  try {
    const ck       = parseInt(custKey);
    const pk       = parseInt(prodKey);
    const delta    = parseFloat(qty) || 0;
    const uid      = req.user?.userId || 'system';
    const normWeek2 = week.match(/^\d{4}-(\d{2}-\d{2})$/) ? week.match(/^\d{4}-(\d{2}-\d{2})$/)[1] : week;
    const normYear2 = week.match(/^(\d{4})-/) ? week.match(/^(\d{4})-/)[1] : String(new Date().getFullYear());

    await withTransaction(async (tQ) => {
      // OrderMaster 찾기 또는 생성
      const om = await tQ(
        `SELECT TOP 1 OrderMasterKey FROM OrderMaster WITH (UPDLOCK, HOLDLOCK)
         WHERE CustKey=@ck AND OrderWeek=@wk AND isDeleted=0
         ORDER BY OrderMasterKey ASC`,
        { ck: { type: sql.Int, value: ck }, wk: { type: sql.NVarChar, value: normWeek2 } }
      );

      let mk;
      if (om.recordset.length === 0) {
        mk = await safeNextKey(tQ, 'OrderMaster', 'OrderMasterKey');
        await tQ(
          `INSERT INTO OrderMaster (OrderMasterKey,OrderDtm,OrderYear,OrderWeek,CustKey,isDeleted,CreateID,CreateDtm)
           VALUES(@mk,GETDATE(),@yr,@wk,@ck,0,@uid,GETDATE())`,
          { mk: { type: sql.Int, value: mk }, yr: { type: sql.NVarChar, value: normYear2 },
            wk: { type: sql.NVarChar, value: normWeek2 },
            ck: { type: sql.Int, value: ck }, uid: { type: sql.NVarChar, value: 'admin' } }
        );
      } else {
        mk = om.recordset[0].OrderMasterKey;
      }

      // 기존 OrderDetail 조회 (14차 패턴: Box+Bunch+Steam 합이 주문수량)
      const od = await tQ(
        `SELECT OrderDetailKey,
                (ISNULL(BoxQuantity,0)+ISNULL(BunchQuantity,0)+ISNULL(SteamQuantity,0)) AS qty
           FROM OrderDetail WITH (UPDLOCK)
          WHERE OrderMasterKey=@mk AND ProdKey=@pk AND isDeleted=0`,
        { mk: { type: sql.Int, value: mk }, pk: { type: sql.Int, value: pk } }
      );

      if (od.recordset.length > 0) {
        const existQty = od.recordset[0].qty || 0;
        const finalQty = existQty + delta;

        if (finalQty <= 0) {
          await tQ(`UPDATE OrderDetail SET isDeleted=1 WHERE OrderMasterKey=@mk AND ProdKey=@pk`,
            { mk: { type: sql.Int, value: mk }, pk: { type: sql.Int, value: pk } });
        } else {
          const boxQty   = unit === '박스' ? finalQty : 0;
          const bunchQty = unit === '단'   ? finalQty : 0;
          const steamQty = unit === '송이' ? finalQty : 0;
          // 14차 패턴: OutQuantity 는 건드리지 않음
          await tQ(
            `UPDATE OrderDetail SET BoxQuantity=@bq, BunchQuantity=@bnq, SteamQuantity=@sq
             WHERE OrderMasterKey=@mk AND ProdKey=@pk AND isDeleted=0`,
            { bq: { type: sql.Float, value: boxQty },
              bnq: { type: sql.Float, value: bunchQty }, sq: { type: sql.Float, value: steamQty },
              mk: { type: sql.Int, value: mk }, pk: { type: sql.Int, value: pk } }
          );
        }
      } else if (delta > 0) {
        const boxQty   = unit === '박스' ? delta : 0;
        const bunchQty = unit === '단'   ? delta : 0;
        const steamQty = unit === '송이' ? delta : 0;
        const nextKey = await safeNextKey(tQ, 'OrderDetail', 'OrderDetailKey');
        // 14차 패턴: OutQuantity=0, NoneOutQuantity=0
        await tQ(
          `INSERT INTO OrderDetail (OrderDetailKey,OrderMasterKey,ProdKey,OutQuantity,NoneOutQuantity,BoxQuantity,BunchQuantity,SteamQuantity,isDeleted,CreateID,CreateDtm)
           VALUES(@nk,@mk,@pk,0,0,@bq,@bnq,@sq,0,@uid,GETDATE())`,
          { nk: { type: sql.Int, value: nextKey }, mk: { type: sql.Int, value: mk }, pk: { type: sql.Int, value: pk },
            bq: { type: sql.Float, value: boxQty },
            bnq: { type: sql.Float, value: bunchQty }, sq: { type: sql.Float, value: steamQty },
            uid: { type: sql.NVarChar, value: 'admin' } }
        );
      }
    });

    return res.status(200).json({ success: true, message: '주문 추가(delta) 완료' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
