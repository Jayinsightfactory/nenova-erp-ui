// pages/api/shipment/distribute.js
// GET?type=products → 품목 목록 (왼쪽 패널)
// GET?type=cust     → 업체 기준 주문 품목 (업체 선택 시)
// POST              → _new_ShipmentDetail 저장

import { query, withTransaction, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { withActionLog } from '../../../lib/withActionLog';

// MAX(Key)+1 안전 INSERT — HOLDLOCK + PK 충돌 방지
async function safeNextKey(tQ, table, keyCol) {
  const r = await tQ(
    `SELECT ISNULL(MAX(${keyCol}),0)+1 AS nk FROM ${table} WITH (UPDLOCK, HOLDLOCK)`, {}
  );
  return r.recordset[0].nk;
}

export default withAuth(withActionLog(async function handler(req, res) {
  if (req.method === 'GET')  return await getDistribute(req, res);
  if (req.method === 'POST') return await saveDistribute(req, res);
  return res.status(405).end();
}, { actionType: 'SHIPMENT_WRITE', affectedTable: 'ShipmentMaster/Detail', riskLevel: 'HIGH' }));

function normWeek(w) {
  if (!w) return w;
  const m = String(w).match(/^\d{4}-(\d{2}-\d{2})$/);
  return m ? m[1] : w;
}

async function getDistribute(req, res) {
  const { type, prodGroup, custKey } = req.query;
  const week = normWeek(req.query.week);

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
          p.ProdKey, p.ProdName, p.DisplayName, p.FlowerName, p.CounName, p.CountryFlower,
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
            SELECT SUM(CASE WHEN p2.OutUnit='단'  THEN ISNULL(od2.BunchQuantity,0)
                            WHEN p2.OutUnit='송이' THEN ISNULL(od2.SteamQuantity,0)
                            ELSE ISNULL(od2.BoxQuantity,0) END)
            FROM OrderDetail od2
            JOIN OrderMaster om2 ON od2.OrderMasterKey = om2.OrderMasterKey
            JOIN Product p2 ON od2.ProdKey = p2.ProdKey
            WHERE od2.ProdKey = p.ProdKey AND om2.OrderWeek = @week AND om2.isDeleted = 0
              AND od2.isDeleted = 0
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
          CASE WHEN p.OutUnit='단'  THEN ISNULL(od.BunchQuantity,0)
               WHEN p.OutUnit='송이' THEN ISNULL(od.SteamQuantity,0)
               ELSE ISNULL(od.BoxQuantity,0) END AS 주문수량,
          ISNULL(sd.OutQuantity, 0) AS 출고수량,
          (CASE WHEN p.OutUnit='단'  THEN ISNULL(od.BunchQuantity,0)
                WHEN p.OutUnit='송이' THEN ISNULL(od.SteamQuantity,0)
                ELSE ISNULL(od.BoxQuantity,0) END - ISNULL(sd.OutQuantity, 0)) AS 차이,
          ISNULL(sd.BoxQuantity, 0) AS 출고Box,
          ISNULL(sd.BunchQuantity, 0) AS 출고Bunch,
          ISNULL(sd.SteamQuantity, 0) AS 출고Steam,
          ISNULL(sd.Cost, ISNULL(cpc.Cost, p.Cost)) AS 단가,
          od.Descr AS 비고
         FROM OrderMaster om
         JOIN Customer c    ON om.CustKey = c.CustKey
         JOIN OrderDetail od ON om.OrderMasterKey = od.OrderMasterKey AND od.ProdKey = @pk AND od.isDeleted = 0
         JOIN Product p     ON od.ProdKey = p.ProdKey
         LEFT JOIN ShipmentMaster sm ON sm.CustKey = om.CustKey AND sm.OrderWeek = @week AND sm.isDeleted = 0
         LEFT JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey AND sd.ProdKey = @pk
         LEFT JOIN CustomerProdCost cpc ON cpc.CustKey = c.CustKey AND cpc.ProdKey = @pk
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
          p.ProdKey, p.ProdName, p.DisplayName, p.FlowerName, p.CounName, p.OutUnit,
          ISNULL(sd.Cost, ISNULL(cpc.Cost, p.Cost)) AS Cost,
          od.BoxQuantity, od.BunchQuantity, od.SteamQuantity,
          ISNULL(od.OutQuantity,
            CASE WHEN p.OutUnit='단'  THEN ISNULL(od.BunchQuantity,0)
                 WHEN p.OutUnit='송이' THEN ISNULL(od.SteamQuantity,0)
                 ELSE ISNULL(od.BoxQuantity,0) END) AS 주문수량,
          ISNULL(sd.OutQuantity, 0) AS 출고수량,
          (ISNULL(od.OutQuantity,
            CASE WHEN p.OutUnit='단'  THEN ISNULL(od.BunchQuantity,0)
                 WHEN p.OutUnit='송이' THEN ISNULL(od.SteamQuantity,0)
                 ELSE ISNULL(od.BoxQuantity,0) END) - ISNULL(sd.OutQuantity, 0)) AS 잔량,
          c.CustName, c.OrderCode
         FROM OrderMaster om
         JOIN Customer c    ON om.CustKey = c.CustKey
         JOIN OrderDetail od ON om.OrderMasterKey = od.OrderMasterKey AND od.isDeleted = 0
         JOIN Product p     ON od.ProdKey = p.ProdKey
         LEFT JOIN ShipmentMaster sm ON sm.CustKey = om.CustKey AND sm.OrderWeek = @week AND sm.isDeleted = 0
         LEFT JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey AND sd.ProdKey = p.ProdKey
         LEFT JOIN CustomerProdCost cpc ON cpc.CustKey = om.CustKey AND cpc.ProdKey = p.ProdKey
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

    // ── 출고일 지정 데이터 (ShipmentDetail.ShipmentDtm 기준 거래처별 출고일 집계)
    if (type === 'dates') {
      if (!week) return res.status(400).json({ success: false, error: 'week 필요' });
      const result = await query(
        `SELECT
          c.CustKey, c.CustName, c.CustArea, c.BaseOutDay,
          CONVERT(NVARCHAR(10), sd.ShipmentDtm, 120) AS OutDate,
          COUNT(sd.SdetailKey) AS itemCount,
          SUM(sd.OutQuantity) AS totalQty,
          STUFF((SELECT ', ' + LEFT(p2.ProdName, 15)
                 FROM ShipmentDetail sd2
                 JOIN Product p2 ON sd2.ProdKey = p2.ProdKey
                 WHERE sd2.ShipmentKey = sm.ShipmentKey
                   AND CONVERT(NVARCHAR(10), sd2.ShipmentDtm, 120) = CONVERT(NVARCHAR(10), sd.ShipmentDtm, 120)
                   AND sd2.OutQuantity > 0
                 FOR XML PATH('')), 1, 2, '') AS prodNames
         FROM ShipmentMaster sm
         JOIN Customer c ON sm.CustKey = c.CustKey
         JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
         JOIN Product p ON sd.ProdKey = p.ProdKey
         WHERE sm.OrderWeek = @week AND sm.isDeleted = 0 AND sd.OutQuantity > 0
         GROUP BY c.CustKey, c.CustName, c.CustArea, c.BaseOutDay,
                  sm.ShipmentKey, CONVERT(NVARCHAR(10), sd.ShipmentDtm, 120)
         ORDER BY c.CustArea, c.CustName, CONVERT(NVARCHAR(10), sd.ShipmentDtm, 120)`,
        { week: { type: sql.NVarChar, value: week } }
      );
      return res.status(200).json({ success: true, source: 'real_db', dates: result.recordset });
    }

    // ── 출고 분배 집계 (품목×거래처 피벗)
    if (type === 'summary') {
      if (!week) return res.status(400).json({ success: false, error: 'week 필요' });

      let prodWhere = '';
      const params = { week: { type: sql.NVarChar, value: week } };
      if (prodGroup) {
        prodWhere = 'AND p.CountryFlower = @pg';
        params.pg = { type: sql.NVarChar, value: prodGroup };
      }

      // 거래처 목록
      const custResult = await query(
        `SELECT DISTINCT c.CustKey, c.CustName, c.CustArea
         FROM OrderMaster om
         JOIN Customer c ON om.CustKey = c.CustKey
         WHERE om.OrderWeek = @week AND om.isDeleted = 0 AND c.isDeleted = 0
         ORDER BY c.CustArea, c.CustName`,
        { week: { type: sql.NVarChar, value: week } }
      );

      // 품목별 거래처별 주문/출고 수량
      const dataResult = await query(
        `SELECT
          p.ProdKey, p.ProdName, p.DisplayName, p.FlowerName, p.CounName,
          om.CustKey,
          CASE WHEN p.OutUnit='단'  THEN ISNULL(od.BunchQuantity,0)
               WHEN p.OutUnit='송이' THEN ISNULL(od.SteamQuantity,0)
               ELSE ISNULL(od.BoxQuantity,0) END AS orderQty,
          ISNULL(sd.OutQuantity, 0) AS outQty
         FROM OrderMaster om
         JOIN OrderDetail od ON om.OrderMasterKey = od.OrderMasterKey AND od.isDeleted = 0
         JOIN Product p ON od.ProdKey = p.ProdKey
         LEFT JOIN ShipmentMaster sm ON sm.CustKey = om.CustKey AND sm.OrderWeek = @week AND sm.isDeleted = 0
         LEFT JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey AND sd.ProdKey = p.ProdKey
         WHERE om.OrderWeek = @week AND om.isDeleted = 0 AND p.isDeleted = 0 ${prodWhere}
         ORDER BY p.CounName, p.FlowerName, p.ProdName`,
        params
      );

      return res.status(200).json({
        success: true, source: 'real_db',
        customers: custResult.recordset,
        data: dataResult.recordset,
      });
    }

    return res.status(400).json({ success: false, error: 'type 파라미터 필요 (products|custDist|custItems|custList|dates|summary)' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

async function distLog(category, step, detail) {
  try {
    await query(
      `INSERT INTO AppLog (Category, Step, Detail, IsError) VALUES (@cat, @step, @detail, 0)`,
      { cat: { type: sql.NVarChar, value: category },
        step: { type: sql.NVarChar, value: step },
        detail: { type: sql.NVarChar, value: String(detail) } }
    );
  } catch { /* AppLog 없으면 무시 */ }
}

// ── 출고 분배 저장 (ShipmentMaster + ShipmentDetail — 실제 DB)
// delta=true 시: newQty = oldQty + outQty (음수 델타로 감소 가능)
// delta=false(기본): newQty = outQty (절대값)
async function saveDistribute(req, res) {
  const { year, custKey, prodKey, outQty, outDate, cost, delta } = req.body;
  const week = normWeek(req.body.week);
  const isDelta = delta === true || delta === 'true';
  try {
    const uid = req.user?.userId || 'system';
    const userName = req.user?.userName || uid;
    const orderYear = year || new Date().getFullYear().toString();
    const ywk = orderYear + (week||'').replace('-','');

    // Product 환산정보
    const prodInfo = await query(
      `SELECT BunchOf1Box, SteamOf1Box FROM Product WHERE ProdKey=@pk`,
      { pk: { type: sql.Int, value: parseInt(prodKey) } }
    );
    // BunchOf1Box/SteamOf1Box null 시 0 사용 (기본값 1은 잘못된 환산 유발)
    const bunchOf1Box = prodInfo.recordset[0]?.BunchOf1Box ?? 0;
    const steamOf1Box = prodInfo.recordset[0]?.SteamOf1Box ?? 0;

    const shipmentKey = await withTransaction(async (tQuery) => {
      // WebCreated=1인 마스터 우선 조회, 없으면 레거시 마스터 사용
      const smResult = await tQuery(
        `SELECT ShipmentKey, WebCreated FROM ShipmentMaster WITH (UPDLOCK, HOLDLOCK)
         WHERE CustKey=@ck AND OrderWeek=@week AND isDeleted=0
         ORDER BY WebCreated DESC`,
        { ck: { type: sql.Int, value: parseInt(custKey) }, week: { type: sql.NVarChar, value: week } }
      );

      let sk;
      if (smResult.recordset.length === 0) {
        sk = await safeNextKey(tQuery, 'ShipmentMaster', 'ShipmentKey');
        await tQuery(
          `INSERT INTO ShipmentMaster (ShipmentKey,OrderYear,OrderWeek,OrderYearWeek,CustKey,isFix,isDeleted,WebCreated,CreateID,CreateDtm)
           VALUES (@nk,@yr,@wk,@ywk,@ck,0,0,1,@uid,GETDATE())`,
          { nk: { type: sql.Int, value: sk }, yr: { type: sql.NVarChar, value: orderYear },
            wk: { type: sql.NVarChar, value: week }, ywk: { type: sql.NVarChar, value: ywk },
            ck: { type: sql.Int, value: parseInt(custKey) }, uid: { type: sql.NVarChar, value: uid } }
        );
      } else {
        sk = smResult.recordset[0].ShipmentKey;
        // 레거시 마스터라면 WebCreated=1로 소유권 인수
        if (!smResult.recordset[0].WebCreated) {
          await tQuery(
            `UPDATE ShipmentMaster SET WebCreated=1 WHERE ShipmentKey=@sk`,
            { sk: { type: sql.Int, value: sk } }
          );
        }
      }

      // 기존 수량 조회 (이력용)
      const oldSd = await tQuery(
        `SELECT SdetailKey, OutQuantity FROM ShipmentDetail WHERE ShipmentKey=@sk AND ProdKey=@pk`,
        { sk: { type: sql.Int, value: sk }, pk: { type: sql.Int, value: parseInt(prodKey) } }
      );
      const oldQty = oldSd.recordset[0]?.OutQuantity || 0;
      const inputQty = parseFloat(outQty) || 0;
      const newQty = isDelta ? oldQty + inputQty : inputQty;

      await distLog('distribute', '시작', `ck=${custKey} pk=${prodKey} wk=${week} old=${oldQty} input=${inputQty} delta=${isDelta} new=${newQty}`);

      // 기존 삭제
      await tQuery(
        `DELETE FROM ShipmentDetail WHERE ShipmentKey=@sk AND ProdKey=@pk`,
        { sk: { type: sql.Int, value: sk }, pk: { type: sql.Int, value: parseInt(prodKey) } }
      );

      if (newQty > 0) {
        const qty = newQty;
        const unitCost = parseFloat(cost) || 0;
        const boxQty   = qty;
        const bunchQty = bunchOf1Box > 0 ? qty * bunchOf1Box : 0;
        const steamQty = steamOf1Box > 0 ? qty * steamOf1Box : 0;
        // Amount: 단 환산값 있으면 단 기준, 없으면 박스 기준
        const amtBase = bunchQty > 0 ? bunchQty : boxQty;
        const amount = Math.round(amtBase * unitCost / 1.1);
        const vat    = Math.round(amtBase * unitCost / 11);
        const now = new Date();
        const timeStr = `${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
        const logEntry = isDelta
          ? `[${timeStr} ${userName}] ${oldQty}+${inputQty}=${qty}(출고분배델타)`
          : `[${timeStr} ${userName}] ${oldQty}>${qty}(출고분배)`;

        const newSdk = await safeNextKey(tQuery, 'ShipmentDetail', 'SdetailKey');
        await tQuery(
          `INSERT INTO ShipmentDetail
             (SdetailKey,ShipmentKey,ProdKey,ShipmentDtm,OutQuantity,EstQuantity,
              BoxQuantity,BunchQuantity,SteamQuantity,Cost,Amount,Vat,isFix,Descr)
           VALUES (@dk,@sk,@pk,@dt,@qty,@qty,@bq,@bnq,@sq,@cost,@amount,@vat,0,@log)`,
          {
            dk:     { type: sql.Int,      value: newSdk },
            sk:     { type: sql.Int,      value: sk },
            pk:     { type: sql.Int,      value: parseInt(prodKey) },
            dt:     { type: sql.DateTime, value: outDate ? new Date(outDate) : new Date() },
            qty:    { type: sql.Float,    value: qty },
            bq:     { type: sql.Float,    value: boxQty },
            bnq:    { type: sql.Float,    value: bunchQty },
            sq:     { type: sql.Float,    value: steamQty },
            cost:   { type: sql.Float,    value: unitCost },
            amount: { type: sql.Float,    value: amount },
            vat:    { type: sql.Float,    value: vat },
            log:    { type: sql.NVarChar, value: logEntry },
          }
        );
      }
      return sk;
    });

    await distLog('distribute', '완료', `sk=${shipmentKey} ck=${custKey} pk=${prodKey} wk=${week} newQty=${isDelta ? (parseFloat(outQty)||0) + (req.body._oldQty||0) : outQty}`);
    return res.status(200).json({ success: true, shipmentKey, oldQty: 0, newQty: parseFloat(outQty)||0, message: '출고 분배 저장 완료' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
