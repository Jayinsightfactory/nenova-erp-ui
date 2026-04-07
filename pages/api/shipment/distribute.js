// pages/api/shipment/distribute.js
// GET?type=products → 품목 목록 (왼쪽 패널)
// GET?type=cust     → 업체 기준 주문 품목 (업체 선택 시)
// POST              → _new_ShipmentDetail 저장

import { query, withTransaction, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

export default withAuth(async function handler(req, res) {
  if (req.method === 'GET')  return await getDistribute(req, res);
  if (req.method === 'POST') return await saveDistribute(req, res);
  return res.status(405).end();
});

async function getDistribute(req, res) {
  const { type, week, prodGroup, custKey } = req.query;

  try {
    // ── 품목 목록 (왼쪽 패널): 차수+품목그룹 기준 입고/출고/현재고
    if (type === 'products') {
      if (!week) return res.status(400).json({ success: false, error: 'week 필요' });

      let prodWhere = '';
      const params = { week: { type: sql.NVarChar, value: week } };
      if (prodGroup) {
        prodWhere = 'AND p.CountryFlower = @pg';
        params.pg = { type: sql.NVarChar, value: prodGroup };
      }

      const result = await query(
        `SELECT
          p.ProdKey, p.ProdName, p.FlowerName, p.CounName, p.CountryFlower,
          p.OutUnit, p.BunchOf1Box, p.SteamOf1Box, p.SteamOf1Bunch, p.Cost,
          ISNULL(sm2.StockKey, 0) AS StockKey,
          ISNULL(ps.Stock, 0) AS prevStock,
          ISNULL((
            SELECT SUM(wd2.OutQuantity) FROM WarehouseDetail wd2
            JOIN WarehouseMaster wm2 ON wd2.WarehouseKey = wm2.WarehouseKey
            WHERE wd2.ProdKey = p.ProdKey AND wm2.OrderWeek = @week AND wm2.isDeleted = 0
          ), 0) AS inQty,
          ISNULL((
            SELECT SUM(sd2.OutQuantity) FROM ShipmentDetail sd2
            JOIN ShipmentMaster sm3 ON sd2.ShipmentKey = sm3.ShipmentKey
            WHERE sd2.ProdKey = p.ProdKey AND sm3.OrderWeek = @week AND sm3.isDeleted = 0
          ), 0) AS outQty,
          ISNULL((
            SELECT SUM(od2.OutQuantity) FROM OrderDetail od2
            JOIN OrderMaster om2 ON od2.OrderMasterKey = om2.OrderMasterKey
            WHERE od2.ProdKey = p.ProdKey AND om2.OrderWeek = @week AND om2.isDeleted = 0
          ), 0) AS orderQty
         FROM Product p
         LEFT JOIN StockMaster sm2 ON sm2.OrderWeek = @week
         LEFT JOIN ProductStock ps ON p.ProdKey = ps.ProdKey AND ps.StockKey = sm2.StockKey
         WHERE p.isDeleted = 0 ${prodWhere}
           AND EXISTS (
             SELECT 1 FROM OrderDetail od3
             JOIN OrderMaster om3 ON od3.OrderMasterKey = om3.OrderMasterKey
             WHERE od3.ProdKey = p.ProdKey AND om3.OrderWeek = @week
               AND om3.isDeleted = 0 AND od3.isDeleted = 0
           )
         ORDER BY p.CounName, p.FlowerName, p.ProdName`,
        params
      );

      return res.status(200).json({ success: true, source: 'real_db', products: result.recordset });
    }

    // ── 거래처 분배 정보: 선택한 품목에 대해 각 거래처 주문수량/출고수량
    if (type === 'custDist') {
      const { prodKey } = req.query;
      if (!week || !prodKey) return res.status(400).json({ success: false, error: 'week, prodKey 필요' });

      const result = await query(
        `SELECT
          c.CustKey, c.CustName, c.OrderCode AS 주문코드,
          p.OutUnit AS 단위,
          ISNULL(od.BoxQuantity, 0) AS 주문Box,
          ISNULL(od.BunchQuantity, 0) AS 주문Bunch,
          ISNULL(od.SteamQuantity, 0) AS 주문Steam,
          ISNULL(od.OutQuantity, 0) AS 주문수량,
          ISNULL(sd.OutQuantity, 0) AS 출고수량,
          ISNULL(od.OutQuantity, 0) - ISNULL(sd.OutQuantity, 0) AS 차이,
          ISNULL(sd.BoxQuantity, 0) AS 출고Box,
          ISNULL(sd.BunchQuantity, 0) AS 출고Bunch,
          ISNULL(sd.SteamQuantity, 0) AS 출고Steam,
          ISNULL(p.Cost, 0) AS 단가,
          od.Descr AS 비고
         FROM OrderMaster om
         JOIN Customer c    ON om.CustKey = c.CustKey
         JOIN OrderDetail od ON om.OrderMasterKey = od.OrderMasterKey AND od.ProdKey = @pk AND od.isDeleted = 0
         JOIN Product p     ON od.ProdKey = p.ProdKey
         LEFT JOIN ShipmentMaster sm ON sm.CustKey = om.CustKey AND sm.OrderWeek = @week AND sm.isDeleted = 0
         LEFT JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey AND sd.ProdKey = @pk
         WHERE om.OrderWeek = @week AND om.isDeleted = 0
         ORDER BY c.CustArea, c.CustName`,
        {
          week: { type: sql.NVarChar, value: week },
          pk:   { type: sql.Int,      value: parseInt(prodKey) },
        }
      );

      // 집계
      const rows = result.recordset;
      const totalOrder = rows.reduce((a, b) => a + (b.주문수량 || 0), 0);
      const totalOut   = rows.reduce((a, b) => a + (b.출고수량 || 0), 0);

      return res.status(200).json({
        success: true, source: 'real_db',
        customers: rows,
        totalOrder, totalOut,
        remain: totalOrder - totalOut,
      });
    }

    // ── 업체 기준 주문 품목 목록
    if (type === 'custItems') {
      if (!week || !custKey) return res.status(400).json({ success: false, error: 'week, custKey 필요' });

      const result = await query(
        `SELECT
          p.ProdKey, p.ProdName, p.FlowerName, p.CounName, p.OutUnit, p.Cost,
          od.BoxQuantity, od.BunchQuantity, od.SteamQuantity, od.OutQuantity AS 주문수량,
          ISNULL(sd.OutQuantity, 0) AS 출고수량,
          od.OutQuantity - ISNULL(sd.OutQuantity, 0) AS 잔량,
          c.CustName, c.OrderCode
         FROM OrderMaster om
         JOIN Customer c    ON om.CustKey = c.CustKey
         JOIN OrderDetail od ON om.OrderMasterKey = od.OrderMasterKey AND od.isDeleted = 0
         JOIN Product p     ON od.ProdKey = p.ProdKey
         LEFT JOIN ShipmentMaster sm ON sm.CustKey = om.CustKey AND sm.OrderWeek = @week AND sm.isDeleted = 0
         LEFT JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey AND sd.ProdKey = p.ProdKey
         WHERE om.OrderWeek = @week AND om.CustKey = @ck AND om.isDeleted = 0
         ORDER BY p.CounName, p.FlowerName, p.ProdName`,
        {
          week: { type: sql.NVarChar, value: week },
          ck:   { type: sql.Int,      value: parseInt(custKey) },
        }
      );
      return res.status(200).json({ success: true, source: 'real_db', items: result.recordset });
    }

    // ── 거래처 목록 (드롭다운용)
    if (type === 'custList') {
      if (!week) return res.status(400).json({ success: false, error: 'week 필요' });
      const result = await query(
        `SELECT DISTINCT c.CustKey, c.CustName, c.CustArea, c.OrderCode
         FROM OrderMaster om
         JOIN Customer c ON om.CustKey = c.CustKey
         WHERE om.OrderWeek = @week AND om.isDeleted = 0 AND c.isDeleted = 0
         ORDER BY c.CustArea, c.CustName`,
        { week: { type: sql.NVarChar, value: week } }
      );
      return res.status(200).json({ success: true, customers: result.recordset });
    }

    return res.status(400).json({ success: false, error: 'type 파라미터 필요 (products|custDist|custItems|custList)' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ── 출고 분배 저장 (_new_ShipmentMaster + _new_ShipmentDetail)
// withTransaction + UPDLOCK으로 동시 저장 시 중복 ShipmentMaster 생성 방지
async function saveDistribute(req, res) {
  const { week, year, custKey, prodKey, outQty, outDate, cost } = req.body;
  try {
    const shipmentKey = await withTransaction(async (tQuery) => {
      // UPDLOCK, HOLDLOCK: 같은 CustKey+OrderWeek로 동시 접근 시 대기하여 중복 방지
      const smResult = await tQuery(
        `SELECT ShipmentKey FROM _new_ShipmentMaster WITH (UPDLOCK, HOLDLOCK)
         WHERE CustKey=@ck AND OrderWeek=@week`,
        { ck: { type: sql.Int, value: parseInt(custKey) }, week: { type: sql.NVarChar, value: week } }
      );

      let sk;
      if (smResult.recordset.length === 0) {
        const ins = await tQuery(
          `INSERT INTO _new_ShipmentMaster
             (OrderYear,OrderWeek,OrderYearWeek,CustKey,isFix,isDeleted,CreateID,CreateDtm)
           OUTPUT INSERTED.ShipmentKey
           VALUES (@yr,@wk,@ywk,@ck,0,0,@uid,GETDATE())`,
          {
            yr:  { type: sql.NVarChar, value: year || '' },
            wk:  { type: sql.NVarChar, value: week },
            ywk: { type: sql.NVarChar, value: (year||'')+week },
            ck:  { type: sql.Int,      value: parseInt(custKey) },
            uid: { type: sql.NVarChar, value: req.user.userId },
          }
        );
        sk = ins.recordset[0].ShipmentKey;
      } else {
        sk = smResult.recordset[0].ShipmentKey;
      }

      // 기존 동일 품목 삭제 후 재삽입
      await tQuery(
        `DELETE FROM _new_ShipmentDetail WHERE ShipmentKey=@sk AND ProdKey=@pk`,
        { sk: { type: sql.Int, value: sk }, pk: { type: sql.Int, value: parseInt(prodKey) } }
      );

      if (parseFloat(outQty) > 0) {
        const qty = parseFloat(outQty);
        const unitCost = parseFloat(cost) || 0;
        const amount = qty * unitCost;
        const vat = Math.round(amount / 11);
        await tQuery(
          `INSERT INTO _new_ShipmentDetail
             (ShipmentKey,CustKey,ProdKey,ShipmentDtm,OutQuantity,EstQuantity,
              Cost,Amount,Vat,CreateID,CreateDtm)
           VALUES (@sk,@ck,@pk,@dt,@qty,@qty,@cost,@amount,@vat,@uid,GETDATE())`,
          {
            sk:     { type: sql.Int,      value: sk },
            ck:     { type: sql.Int,      value: parseInt(custKey) },
            pk:     { type: sql.Int,      value: parseInt(prodKey) },
            dt:     { type: sql.DateTime, value: outDate ? new Date(outDate) : new Date() },
            qty:    { type: sql.Float,    value: qty },
            cost:   { type: sql.Float,    value: unitCost },
            amount: { type: sql.Float,    value: amount },
            vat:    { type: sql.Float,    value: vat },
            uid:    { type: sql.NVarChar, value: req.user.userId },
          }
        );
      }
      return sk;
    });

    return res.status(200).json({ success: true, source: 'test_table', shipmentKey, message: '출고 분배 저장 완료 (테스트)' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
