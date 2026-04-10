// pages/api/shipment/stock-status.js
// GET  ?weekFrom&weekTo&view=products|customers|managers|pivot  → 조회
// PATCH { custKey, prodKey, week, outQty }                       → 출고수량 수정
// POST  { action:'addOrder', custKey, prodKey, week, qty }       → 주문 추가/수정

import { query, withTransaction, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

export default withAuth(async function handler(req, res) {
  if (req.method === 'PATCH') return await updateOutQty(req, res);
  if (req.method === 'POST')  return await addOrder(req, res);
  if (req.method === 'PUT')   return await updateStartStock(req, res);
  if (req.method !== 'GET')   return res.status(405).end();

  // 차수 파라미터
  let { weekFrom, weekTo, week, view, prodKey } = req.query;

  // 차수 불필요한 뷰는 먼저 처리
  if (view === 'custOrderCounts') {
    try {
      const result = await query(
        `SELECT om.CustKey, COUNT(DISTINCT od.OrderDetailKey) AS cnt
         FROM OrderMaster om
         JOIN OrderDetail od ON om.OrderMasterKey=od.OrderMasterKey AND od.isDeleted=0
         WHERE om.isDeleted=0
         GROUP BY om.CustKey`, {}
      );
      const counts = {};
      result.recordset.forEach(r => { counts[r.CustKey] = r.cnt; });
      return res.status(200).json({ success: true, counts });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // 품목별 주문 횟수 (인기순 정렬용)
  if (view === 'prodOrderCounts') {
    try {
      const result = await query(
        `SELECT od.ProdKey, COUNT(*) AS cnt
         FROM OrderDetail od
         JOIN OrderMaster om ON od.OrderMasterKey=om.OrderMasterKey AND om.isDeleted=0
         WHERE od.isDeleted=0
         GROUP BY od.ProdKey`, {}
      );
      const counts = {};
      result.recordset.forEach(r => { counts[r.ProdKey] = r.cnt; });
      return res.status(200).json({ success: true, counts });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // 시작재고 조회/저장
  if (view === 'startStock') {
    if (!weekFrom) return res.status(400).json({ success: false, error: 'weekFrom 필요' });
    try {
      const result = await query(
        `SELECT ProdKey, Stock FROM StartStock WHERE OrderWeek=@wk`,
        { wk: { type: sql.NVarChar, value: weekFrom } }
      );
      const stocks = {};
      result.recordset.forEach(r => { stocks[r.ProdKey] = r.Stock; });
      return res.status(200).json({ success: true, stocks });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // 특정 업체+차수의 기존 주문수량 조회 (모달용)
  if (view === 'existOrders') {
    const { custKey: ck } = req.query;
    if (!weekFrom || !ck) return res.status(400).json({ success: false, error: 'weekFrom, custKey 필요' });
    try {
      const result = await query(
        `SELECT od.ProdKey, od.OutQuantity, om.OrderWeek
         FROM OrderDetail od
         JOIN OrderMaster om ON od.OrderMasterKey=om.OrderMasterKey
         WHERE om.CustKey=@ck AND om.OrderWeek=@wk AND om.isDeleted=0 AND od.isDeleted=0`,
        { ck: { type: sql.Int, value: parseInt(ck) }, wk: { type: sql.NVarChar, value: weekFrom } }
      );
      const orders = {};
      result.recordset.forEach(r => { orders[`${ck}-${r.ProdKey}-${r.OrderWeek}`] = r.OutQuantity; });
      return res.status(200).json({ success: true, orders });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  if (week && !weekFrom) { weekFrom = week; weekTo = week; }
  if (!weekFrom) return res.status(400).json({ success: false, error: 'weekFrom 필요' });
  if (!weekTo) weekTo = weekFrom;

  const params = {
    weekFrom: { type: sql.NVarChar, value: weekFrom },
    weekTo:   { type: sql.NVarChar, value: weekTo },
  };

  try {
    // ── 품목별: 이월재고 + 입고/출고/주문 + 차수별 세부
    if (view === 'products' || !view) {
      const totalResult = await query(
        `SELECT
          p.ProdKey, p.ProdName, p.FlowerName, p.CounName, p.CountryFlower,
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
          -- 기간 내 주문수량 (전체 업체)
          ISNULL((
            SELECT SUM(od.OutQuantity) FROM OrderDetail od
            JOIN OrderMaster om ON od.OrderMasterKey = om.OrderMasterKey
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
           SELECT od.ProdKey, om.OrderWeek, od.OutQuantity, 'ord'
           FROM OrderDetail od JOIN OrderMaster om ON od.OrderMasterKey=om.OrderMasterKey
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
          c.CustKey, c.CustName, c.CustArea, c.Manager, c.Descr AS CustDescr,
          p.ProdKey, p.ProdName, p.FlowerName, p.CounName, p.OutUnit,
          om.OrderWeek,
          ISNULL(od.OutQuantity,   0) AS custOrderQty,
          ISNULL(sd.OutQuantity,   0) AS outQty,
          CONVERT(NVARCHAR(16), sd.ShipmentDtm, 120) AS outCreateDtm,
          ISNULL(sd.Descr,'') AS outDescr,
          ISNULL(sm.isFix,0) AS isFix,
          ISNULL((
            SELECT TOP 1 ps.Stock FROM ProductStock ps
            JOIN StockMaster sm2 ON ps.StockKey = sm2.StockKey
            WHERE ps.ProdKey = p.ProdKey AND sm2.OrderWeek <= @weekFrom
            ORDER BY sm2.OrderWeek DESC
          ), 0) AS prevStock,
          ISNULL((
            SELECT SUM(od2.OutQuantity) FROM OrderDetail od2
            JOIN OrderMaster om2 ON od2.OrderMasterKey=om2.OrderMasterKey
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
         LEFT JOIN ShipmentMaster sm ON sm.CustKey=om.CustKey AND sm.OrderWeek=om.OrderWeek AND sm.isDeleted=0
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
          c.CustKey, c.CustName, c.CustArea, c.Descr AS CustDescr,
          p.ProdKey, p.ProdName, p.FlowerName, p.CounName, p.OutUnit,
          om.OrderWeek,
          ISNULL(od.OutQuantity, 0) AS custOrderQty,
          ISNULL(sd.OutQuantity, 0) AS outQty,
          CONVERT(NVARCHAR(16), sd.ShipmentDtm, 120) AS outCreateDtm,
          ISNULL(sd.Descr,'') AS outDescr,
          ISNULL(sm.isFix,0) AS isFix,
          ISNULL((
            SELECT TOP 1 ps.Stock FROM ProductStock ps
            JOIN StockMaster sm2 ON ps.StockKey=sm2.StockKey
            WHERE ps.ProdKey=p.ProdKey AND sm2.OrderWeek <= @weekFrom
            ORDER BY sm2.OrderWeek DESC
          ), 0) AS prevStock,
          ISNULL((
            SELECT SUM(od2.OutQuantity) FROM OrderDetail od2
            JOIN OrderMaster om2 ON od2.OrderMasterKey=om2.OrderMasterKey
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
         ORDER BY Manager, c.CustArea, c.CustName, om.OrderWeek, p.CounName, p.FlowerName, p.ProdName`,
        params
      );
      return res.status(200).json({ success: true, rows: result.recordset });
    }

    // ── 모아보기 피벗
    if (view === 'pivot') {
      const result = await query(
        `SELECT
          c.CustKey, c.CustName, c.CustArea, c.Descr AS CustDescr, c.Manager,
          p.ProdKey, p.ProdName, p.FlowerName, p.CounName,
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

    return res.status(400).json({ success: false, error: 'view 파라미터 필요' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── PATCH: 출고수량 수정 (ShipmentMaster + ShipmentDetail)
async function updateOutQty(req, res) {
  const { custKey, prodKey, week, outQty, descrLog } = req.body;
  console.log('[PATCH stock-status]', { custKey, prodKey, week, outQty, descrLog });
  if (!custKey || !prodKey || !week) {
    return res.status(400).json({ success: false, error: 'custKey, prodKey, week 필요' });
  }
  try {
    const qty = parseFloat(outQty) || 0;
    const ck  = parseInt(custKey);
    const pk  = parseInt(prodKey);
    const uid = req.user?.userId || 'system';
    const userName = req.user?.userName || uid;
    const now = new Date();
    const timeStr = `${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    const logEntry = descrLog ? `[${timeStr} ${userName}] ${descrLog}` : '';
    const orderYear = new Date().getFullYear().toString();
    const ywk = orderYear + week.replace('-',''); // "2026" + "1601" = "20261601"

    // Product 환산정보
    const prodInfo = await query(
      `SELECT BunchOf1Box, SteamOf1Box FROM Product WHERE ProdKey=@pk`,
      { pk: { type: sql.Int, value: pk } }
    );
    const bunchOf1Box = prodInfo.recordset[0]?.BunchOf1Box || 1;
    const steamOf1Box = prodInfo.recordset[0]?.SteamOf1Box || 1;
    const boxQty   = qty;
    const bunchQty = qty * bunchOf1Box;
    const steamQty = qty * steamOf1Box;

    await withTransaction(async (tQ) => {
      // ShipmentMaster 찾기 또는 생성
      const sm = await tQ(
        `SELECT ShipmentKey FROM ShipmentMaster WITH (UPDLOCK, HOLDLOCK)
         WHERE CustKey=@ck AND OrderWeek=@wk AND isDeleted=0`,
        { ck: { type: sql.Int, value: ck }, wk: { type: sql.NVarChar, value: week } }
      );

      let sk;
      if (sm.recordset.length === 0) {
        const maxSm = await tQ(`SELECT ISNULL(MAX(ShipmentKey),0)+1 AS nk FROM ShipmentMaster`, {});
        const newSk = maxSm.recordset[0].nk;
        await tQ(
          `INSERT INTO ShipmentMaster (ShipmentKey,OrderYear,OrderWeek,OrderYearWeek,CustKey,isFix,isDeleted,CreateID,CreateDtm)
           VALUES(@nk,@yr,@wk,@ywk,@ck,0,0,@uid,GETDATE())`,
          { nk: { type: sql.Int, value: newSk }, yr: { type: sql.NVarChar, value: orderYear },
            wk: { type: sql.NVarChar, value: week }, ywk: { type: sql.NVarChar, value: ywk },
            ck: { type: sql.Int, value: ck }, uid: { type: sql.NVarChar, value: uid } }
        );
        sk = newSk;
        console.log('[PATCH] ShipmentMaster created:', newSk);
      } else {
        sk = sm.recordset[0].ShipmentKey;
        console.log('[PATCH] ShipmentMaster found:', sk);
      }

      // ShipmentDetail: 있으면 UPDATE, qty=0이면 DELETE, 없으면 INSERT
      const sd = await tQ(
        `SELECT SdetailKey FROM ShipmentDetail WHERE ShipmentKey=@sk AND ProdKey=@pk`,
        { sk: { type: sql.Int, value: sk }, pk: { type: sql.Int, value: pk } }
      );

      if (sd.recordset.length > 0) {
        if (qty <= 0) {
          await tQ(`DELETE FROM ShipmentDetail WHERE ShipmentKey=@sk AND ProdKey=@pk`,
            { sk: { type: sql.Int, value: sk }, pk: { type: sql.Int, value: pk } });
        } else {
          await tQ(
            `UPDATE ShipmentDetail SET OutQuantity=@qty, BoxQuantity=@bq, BunchQuantity=@bnq, SteamQuantity=@sq,
             ShipmentDtm=GETDATE(), isFix=0,
             Descr=CASE WHEN @log='' THEN Descr ELSE ISNULL(Descr,'') + CHAR(10) + @log END
             WHERE ShipmentKey=@sk AND ProdKey=@pk`,
            { qty: { type: sql.Float, value: qty }, bq: { type: sql.Float, value: boxQty },
              bnq: { type: sql.Float, value: bunchQty }, sq: { type: sql.Float, value: steamQty },
              sk: { type: sql.Int, value: sk }, pk: { type: sql.Int, value: pk },
              log: { type: sql.NVarChar, value: logEntry } }
          );
        }
      } else if (qty > 0) {
        const maxSd = await tQ(`SELECT ISNULL(MAX(SdetailKey),0)+1 AS nk FROM ShipmentDetail`, {});
        const newSdk = maxSd.recordset[0].nk;
        await tQ(
          `INSERT INTO ShipmentDetail (SdetailKey,ShipmentKey,ProdKey,ShipmentDtm,OutQuantity,EstQuantity,BoxQuantity,BunchQuantity,SteamQuantity,isFix,Descr)
           VALUES(@dk,@sk,@pk,GETDATE(),@qty,@qty,@bq,@bnq,@sq,0,@log)`,
          { dk: { type: sql.Int, value: newSdk }, sk: { type: sql.Int, value: sk },
            pk: { type: sql.Int, value: pk }, qty: { type: sql.Float, value: qty },
            bq: { type: sql.Float, value: boxQty }, bnq: { type: sql.Float, value: bunchQty },
            sq: { type: sql.Float, value: steamQty }, log: { type: sql.NVarChar, value: logEntry } }
        );
      }
    });

    return res.status(200).json({ success: true, message: '출고수량 수정 완료' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ── POST: 주문 추가/수정 (OrderMaster + OrderDetail)
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
    const orderYear = new Date().getFullYear().toString();

    // Product 환산정보 조회
    const prodInfo = await query(
      `SELECT BunchOf1Box, SteamOf1Box FROM Product WHERE ProdKey=@pk`,
      { pk: { type: sql.Int, value: pk } }
    );
    const bunchOf1Box = prodInfo.recordset[0]?.BunchOf1Box || 1;
    const steamOf1Box = prodInfo.recordset[0]?.SteamOf1Box || 1;

    // 단위별 수량 환산
    let boxQty, bunchQty, steamQty;
    if (unit === '박스') {
      boxQty   = quantity;
      bunchQty = quantity * bunchOf1Box;
      steamQty = quantity * steamOf1Box;
    } else if (unit === '단') {
      bunchQty = quantity;
      boxQty   = bunchOf1Box > 0 ? quantity / bunchOf1Box : 0;
      steamQty = bunchOf1Box > 0 ? quantity * (steamOf1Box / bunchOf1Box) : 0;
    } else {
      steamQty = quantity;
      boxQty   = steamOf1Box > 0 ? quantity / steamOf1Box : 0;
      bunchQty = steamOf1Box > 0 ? quantity * (bunchOf1Box / steamOf1Box) : 0;
    }

    await withTransaction(async (tQ) => {
      // OrderMaster 찾기 또는 생성
      const om = await tQ(
        `SELECT OrderMasterKey FROM OrderMaster WITH (UPDLOCK, HOLDLOCK)
         WHERE CustKey=@ck AND OrderWeek=@wk AND isDeleted=0`,
        { ck: { type: sql.Int, value: ck }, wk: { type: sql.NVarChar, value: week } }
      );

      let mk;
      if (om.recordset.length === 0) {
        const maxOm = await tQ(`SELECT ISNULL(MAX(OrderMasterKey),0)+1 AS nk FROM OrderMaster`, {});
        const newMk = maxOm.recordset[0].nk;
        await tQ(
          `INSERT INTO OrderMaster (OrderMasterKey,OrderDtm,OrderYear,OrderWeek,CustKey,Manager,OrderCode,isDeleted,CreateID,CreateDtm)
           VALUES(@nk,CAST(GETDATE() AS DATE),@yr,@wk,@ck,@uid,'',0,@uid,GETDATE())`,
          { nk: { type: sql.Int, value: newMk }, yr: { type: sql.NVarChar, value: orderYear }, wk: { type: sql.NVarChar, value: week }, ck: { type: sql.Int, value: ck }, uid: { type: sql.NVarChar, value: uid } }
        );
        mk = newMk;
      } else {
        mk = om.recordset[0].OrderMasterKey;
      }

      // OrderDetail: 있으면 UPDATE, qty=0이면 삭제, 없으면 INSERT
      const od = await tQ(
        `SELECT OrderDetailKey FROM OrderDetail WHERE OrderMasterKey=@mk AND ProdKey=@pk AND isDeleted=0`,
        { mk: { type: sql.Int, value: mk }, pk: { type: sql.Int, value: pk } }
      );

      if (od.recordset.length > 0) {
        const existDk = od.recordset[0].OrderDetailKey;
        if (quantity <= 0) {
          // 기존 수량 조회 (변경내역용)
          const prev = await tQ(`SELECT OutQuantity FROM OrderDetail WHERE OrderDetailKey=@dk`, { dk: { type: sql.Int, value: existDk } });
          const prevQty = prev.recordset[0]?.OutQuantity || 0;
          await tQ(
            `UPDATE OrderDetail SET isDeleted=1 WHERE OrderMasterKey=@mk AND ProdKey=@pk`,
            { mk: { type: sql.Int, value: mk }, pk: { type: sql.Int, value: pk } }
          );
          // 변경내역: 삭제
          await tQ(
            `INSERT INTO OrderHistory (ChangeDtm,ChangeID,ChangeType,ColumName,BeforeValue,AfterValue,Descr,OrderDetailKey)
             VALUES(GETDATE(),@uid,N'삭제',N'주문수량',@bv,0,N'웹 주문추가',@dk)`,
            { uid: { type: sql.NVarChar, value: uid }, bv: { type: sql.Float, value: prevQty }, dk: { type: sql.Int, value: existDk } }
          );
        } else {
          // 기존 수량 조회 (변경내역용)
          const prev = await tQ(`SELECT OutQuantity FROM OrderDetail WHERE OrderDetailKey=@dk`, { dk: { type: sql.Int, value: existDk } });
          const prevQty = prev.recordset[0]?.OutQuantity || 0;
          await tQ(
            `UPDATE OrderDetail SET OutQuantity=@qty, BoxQuantity=@bq, BunchQuantity=@bnq, SteamQuantity=@sq
             WHERE OrderMasterKey=@mk AND ProdKey=@pk AND isDeleted=0`,
            {
              qty: { type: sql.Float, value: quantity }, bq:  { type: sql.Float, value: boxQty },
              bnq: { type: sql.Float, value: bunchQty }, sq:  { type: sql.Float, value: steamQty },
              mk:  { type: sql.Int,   value: mk },       pk:  { type: sql.Int,   value: pk },
            }
          );
          // 변경내역: 수정
          await tQ(
            `INSERT INTO OrderHistory (ChangeDtm,ChangeID,ChangeType,ColumName,BeforeValue,AfterValue,Descr,OrderDetailKey)
             VALUES(GETDATE(),@uid,N'수정',N'주문수량',@bv,@av,N'웹 주문추가',@dk)`,
            { uid: { type: sql.NVarChar, value: uid }, bv: { type: sql.Float, value: prevQty }, av: { type: sql.Float, value: quantity }, dk: { type: sql.Int, value: existDk } }
          );
        }
      } else if (quantity > 0) {
        const maxOd = await tQ(`SELECT ISNULL(MAX(OrderDetailKey),0)+1 AS nk FROM OrderDetail`, {});
        const newDk = maxOd.recordset[0].nk;
        await tQ(
          `INSERT INTO OrderDetail (OrderDetailKey,OrderMasterKey,ProdKey,OutQuantity,BoxQuantity,BunchQuantity,SteamQuantity,isDeleted,CreateID,CreateDtm)
           VALUES(@dk,@mk,@pk,@qty,@bq,@bnq,@sq,0,@uid,GETDATE())`,
          {
            dk:  { type: sql.Int,   value: newDk },    mk:  { type: sql.Int,   value: mk },
            pk:  { type: sql.Int,   value: pk },
            qty: { type: sql.Float, value: quantity }, bq:  { type: sql.Float, value: boxQty },
            bnq: { type: sql.Float, value: bunchQty }, sq:  { type: sql.Float, value: steamQty },
            uid: { type: sql.NVarChar, value: uid },
          }
        );
        // 변경내역: 신규
        await tQ(
          `INSERT INTO OrderHistory (ChangeDtm,ChangeID,ChangeType,ColumName,BeforeValue,AfterValue,Descr,OrderDetailKey)
           VALUES(GETDATE(),@uid,N'신규',N'주문수량',0,@av,N'웹 주문추가',@dk)`,
          { uid: { type: sql.NVarChar, value: uid }, av: { type: sql.Float, value: quantity }, dk: { type: sql.Int, value: newDk } }
        );
      }
    });

    return res.status(200).json({ success: true, message: '주문 추가/수정 완료' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ── PUT: 시작재고 저장
async function updateStartStock(req, res) {
  const { prodKey, week, stock } = req.body;
  if (!prodKey || !week) return res.status(400).json({ success: false, error: 'prodKey, week 필요' });
  try {
    const uid = req.user?.userId || 'system';
    const s = parseFloat(stock) || 0;
    await query(
      `MERGE StartStock AS t
       USING (SELECT @pk AS ProdKey, @wk AS OrderWeek) AS s
       ON t.ProdKey=s.ProdKey AND t.OrderWeek=s.OrderWeek
       WHEN MATCHED THEN UPDATE SET Stock=@s, CreateID=@uid, CreateDtm=GETDATE()
       WHEN NOT MATCHED THEN INSERT (ProdKey,OrderWeek,Stock,CreateID,CreateDtm) VALUES(@pk,@wk,@s,@uid,GETDATE());`,
      { pk: { type: sql.Int, value: parseInt(prodKey) }, wk: { type: sql.NVarChar, value: week },
        s: { type: sql.Float, value: s }, uid: { type: sql.NVarChar, value: uid } }
    );
    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
