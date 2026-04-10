// pages/api/shipment/stock-status.js
// GET  ?weekFrom&weekTo&view=products|customers|managers|pivot  → 조회
// PATCH { custKey, prodKey, week, outQty }                       → 출고수량 수정
// POST  { action:'addOrder', custKey, prodKey, week, qty }       → 주문 추가/수정

import { query, withTransaction, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

export default withAuth(async function handler(req, res) {
  if (req.method === 'PATCH') return await updateOutQty(req, res);
  if (req.method === 'POST')  return await addOrder(req, res);
  if (req.method !== 'GET')   return res.status(405).end();

  // 차수 파라미터
  let { weekFrom, weekTo, week, view, prodKey } = req.query;
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
          c.CustKey, c.CustName, c.CustArea, c.Manager,
          p.ProdKey, p.ProdName, p.FlowerName, p.CounName, p.OutUnit,
          om.OrderWeek,
          ISNULL(od.OutQuantity,   0) AS custOrderQty,
          ISNULL(sd.OutQuantity,   0) AS outQty,
          CONVERT(NVARCHAR(16), sd.ShipmentDtm, 120) AS outCreateDtm,
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
          c.CustKey, c.CustName, c.CustArea,
          p.ProdKey, p.ProdName, p.FlowerName, p.CounName, p.OutUnit,
          om.OrderWeek,
          ISNULL(od.OutQuantity, 0) AS custOrderQty,
          ISNULL(sd.OutQuantity, 0) AS outQty,
          CONVERT(NVARCHAR(16), sd.ShipmentDtm, 120) AS outCreateDtm,
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
  const { custKey, prodKey, week, outQty } = req.body;
  if (!custKey || !prodKey || !week) {
    return res.status(400).json({ success: false, error: 'custKey, prodKey, week 필요' });
  }
  try {
    const qty = parseFloat(outQty) || 0;
    const ck  = parseInt(custKey);
    const pk  = parseInt(prodKey);
    const uid = req.user?.userId || 'system';

    await withTransaction(async (tQ) => {
      // ShipmentMaster 찾기 또는 생성
      const sm = await tQ(
        `SELECT ShipmentKey FROM ShipmentMaster WITH (UPDLOCK, HOLDLOCK)
         WHERE CustKey=@ck AND OrderWeek=@wk AND isDeleted=0`,
        { ck: { type: sql.Int, value: ck }, wk: { type: sql.NVarChar, value: week } }
      );

      let sk;
      if (sm.recordset.length === 0) {
        const ins = await tQ(
          `INSERT INTO ShipmentMaster (OrderWeek,CustKey,isFix,isDeleted,CreateID,CreateDtm)
           OUTPUT INSERTED.ShipmentKey VALUES(@wk,@ck,0,0,@uid,GETDATE())`,
          { wk: { type: sql.NVarChar, value: week }, ck: { type: sql.Int, value: ck }, uid: { type: sql.NVarChar, value: uid } }
        );
        sk = ins.recordset[0].ShipmentKey;
      } else {
        sk = sm.recordset[0].ShipmentKey;
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
            `UPDATE ShipmentDetail SET OutQuantity=@qty, ShipmentDtm=GETDATE()
             WHERE ShipmentKey=@sk AND ProdKey=@pk`,
            { qty: { type: sql.Float, value: qty }, sk: { type: sql.Int, value: sk },
              pk: { type: sql.Int, value: pk } }
          );
        }
      } else if (qty > 0) {
        await tQ(
          `INSERT INTO ShipmentDetail (ShipmentKey,CustKey,ProdKey,ShipmentDtm,OutQuantity,EstQuantity)
           VALUES(@sk,@ck,@pk,GETDATE(),@qty,@qty)`,
          { sk: { type: sql.Int, value: sk }, ck: { type: sql.Int, value: ck },
            pk: { type: sql.Int, value: pk }, qty: { type: sql.Float, value: qty } }
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

    // 단위별 수량 분배 (박스/단/송이)
    const boxQty   = unit === '박스' ? quantity : 0;
    const bunchQty = unit === '단'   ? quantity : 0;
    const steamQty = unit === '송이' ? quantity : 0;

    await withTransaction(async (tQ) => {
      // OrderMaster 찾기 또는 생성
      const om = await tQ(
        `SELECT OrderMasterKey FROM OrderMaster WITH (UPDLOCK, HOLDLOCK)
         WHERE CustKey=@ck AND OrderWeek=@wk AND isDeleted=0`,
        { ck: { type: sql.Int, value: ck }, wk: { type: sql.NVarChar, value: week } }
      );

      let mk;
      if (om.recordset.length === 0) {
        const ins = await tQ(
          `INSERT INTO OrderMaster (OrderDtm,OrderWeek,CustKey,isDeleted,CreateID,CreateDtm)
           OUTPUT INSERTED.OrderMasterKey VALUES(GETDATE(),@wk,@ck,0,@uid,GETDATE())`,
          { wk: { type: sql.NVarChar, value: week }, ck: { type: sql.Int, value: ck }, uid: { type: sql.NVarChar, value: uid } }
        );
        mk = ins.recordset[0].OrderMasterKey;
      } else {
        mk = om.recordset[0].OrderMasterKey;
      }

      // OrderDetail: 있으면 UPDATE, qty=0이면 삭제, 없으면 INSERT
      const od = await tQ(
        `SELECT OrderDetailKey FROM OrderDetail WHERE OrderMasterKey=@mk AND ProdKey=@pk AND isDeleted=0`,
        { mk: { type: sql.Int, value: mk }, pk: { type: sql.Int, value: pk } }
      );

      if (od.recordset.length > 0) {
        if (quantity <= 0) {
          await tQ(
            `UPDATE OrderDetail SET isDeleted=1 WHERE OrderMasterKey=@mk AND ProdKey=@pk`,
            { mk: { type: sql.Int, value: mk }, pk: { type: sql.Int, value: pk } }
          );
        } else {
          await tQ(
            `UPDATE OrderDetail SET OutQuantity=@qty, BoxQuantity=@bq, BunchQuantity=@bnq, SteamQuantity=@sq
             WHERE OrderMasterKey=@mk AND ProdKey=@pk AND isDeleted=0`,
            {
              qty: { type: sql.Float, value: quantity }, bq:  { type: sql.Float, value: boxQty },
              bnq: { type: sql.Float, value: bunchQty }, sq:  { type: sql.Float, value: steamQty },
              mk:  { type: sql.Int,   value: mk },       pk:  { type: sql.Int,   value: pk },
            }
          );
        }
      } else if (quantity > 0) {
        await tQ(
          `INSERT INTO OrderDetail (OrderMasterKey,ProdKey,OutQuantity,BoxQuantity,BunchQuantity,SteamQuantity,isDeleted,CreateID,CreateDtm)
           VALUES(@mk,@pk,@qty,@bq,@bnq,@sq,0,@uid,GETDATE())`,
          {
            mk:  { type: sql.Int,   value: mk },      pk:  { type: sql.Int,   value: pk },
            qty: { type: sql.Float, value: quantity }, bq:  { type: sql.Float, value: boxQty },
            bnq: { type: sql.Float, value: bunchQty }, sq:  { type: sql.Float, value: steamQty },
            uid: { type: sql.NVarChar, value: uid },
          }
        );
      }
    });

    return res.status(200).json({ success: true, message: '주문 추가/수정 완료' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
