// pages/api/shipment/stock-status.js
// GET  ?weekFrom&weekTo&view=products|customers|managers|pivot  → 조회
// PATCH { custKey, prodKey, week, outQty, descrLog }             → 출고수량 수정 + 비고 로그
// POST  { action:'addOrder', custKey, prodKey, week, qty }       → 주문 추가/수정
// DELETE { custKey, prodKey, week, lineIdx }                     → 수정내역 특정 줄 삭제

import { query, withTransaction, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

export default withAuth(async function handler(req, res) {
  if (req.method === 'PATCH')  return await updateOutQty(req, res);
  if (req.method === 'POST')   return await addOrder(req, res);
  if (req.method === 'DELETE') return await deleteDescrLine(req, res);
  if (req.method === 'PUT')    return await saveStartStock(req, res);
  if (req.method !== 'GET')    return res.status(405).end();

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
          ISNULL(c.Descr, '') AS CustDescr,
          p.ProdKey, p.ProdName, p.FlowerName, p.CounName, p.OutUnit,
          om.OrderWeek,
          ISNULL(od.OutQuantity,   0) AS custOrderQty,
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
  const { custKey, prodKey, week, outQty, shipDate, descrLog } = req.body;
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
        const jan4 = new Date(yr, 0, 4);
        const dow = jan4.getDay() || 7;
        const monday = new Date(jan4);
        monday.setDate(jan4.getDate() - dow + 1 + (weekNum - 1) * 7);
        // 수요일 = Monday + 2
        const wednesday = new Date(monday);
        wednesday.setDate(monday.getDate() + 2);
        // BaseOutDay → 수요일 기준 오프셋 (DB 실데이터 기반)
        //   0=수(+0), 1=일(+4), 2=월(+5), 3=화(+6), 4=목(+1), 5=토(+3), 6=금(+2)
        const offsets = [0, 4, 5, 6, 1, 3, 2];
        const offset = offsets[baseDay] ?? 0;
        wednesday.setDate(wednesday.getDate() + offset);
        return wednesday.toISOString().slice(0, 10);
      } catch { return null; }
    }

    const computedDate = calcShipDate(week, baseOutDay);
    const finalDate = computedDate || shipDate || null;
    const shipDtmExpr = finalDate ? `CAST(@shipDate AS DATETIME)` : `GETDATE()`;
    const shipDtmParam = finalDate ? { shipDate: { type: sql.NVarChar, value: finalDate } } : {};

    await withTransaction(async (tQ) => {
      // ShipmentMaster 찾기 또는 생성
      const sm = await tQ(
        `SELECT ShipmentKey FROM ShipmentMaster WITH (UPDLOCK, HOLDLOCK)
         WHERE CustKey=@ck AND OrderWeek=@wk AND isDeleted=0`,
        { ck: { type: sql.Int, value: ck }, wk: { type: sql.NVarChar, value: week } }
      );

      let sk;
      if (sm.recordset.length === 0) {
        // ShipmentKey는 IDENTITY 아님 → MAX+1 직접 할당
        const maxSmKey = await tQ(
          `SELECT ISNULL(MAX(ShipmentKey),0)+1 AS nextKey FROM ShipmentMaster WITH (UPDLOCK)`
        );
        const newSk = maxSmKey.recordset[0].nextKey;
        await tQ(
          `INSERT INTO ShipmentMaster (ShipmentKey,OrderWeek,CustKey,isFix,isDeleted,CreateID,CreateDtm)
           VALUES(@newSk,@wk,@ck,0,0,@uid,GETDATE())`,
          { newSk: { type: sql.Int,     value: newSk },
            wk:    { type: sql.NVarChar, value: week  },
            ck:    { type: sql.Int,     value: ck    },
            uid:   { type: sql.NVarChar, value: uid   } }
        );
        sk = newSk;
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
            `UPDATE ShipmentDetail SET OutQuantity=@qty, EstQuantity=@qty, ShipmentDtm=${shipDtmExpr}
             WHERE ShipmentKey=@sk AND ProdKey=@pk`,
            { qty: { type: sql.Float, value: qty }, sk: { type: sql.Int, value: sk },
              pk: { type: sql.Int, value: pk }, ...shipDtmParam }
          );
        }
      } else if (qty > 0) {
        // SdetailKey는 IDENTITY 아님 → MAX+1 직접 할당
        const maxSdk = await tQ(
          `SELECT ISNULL(MAX(SdetailKey),0)+1 AS nextKey FROM ShipmentDetail WITH (UPDLOCK)`
        );
        const nk = maxSdk.recordset[0].nextKey;
        await tQ(
          `INSERT INTO ShipmentDetail (SdetailKey,ShipmentKey,CustKey,ProdKey,ShipmentDtm,OutQuantity,EstQuantity)
           VALUES(@nk,@sk,@ck,@pk,${shipDtmExpr},@qty,@qty)`,
          { nk:  { type: sql.Int,   value: nk  },
            sk:  { type: sql.Int,   value: sk  },
            ck:  { type: sql.Int,   value: ck  },
            pk:  { type: sql.Int,   value: pk  },
            qty: { type: sql.Float, value: qty },
            ...shipDtmParam }
        );
      }
    });

    // descrLog 있으면 ShipmentDetail.Descr에 추가
    if (descrLog && qty > 0) {
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
  const { custKey, prodKey, week, lineIdx } = req.body;
  if (custKey === undefined || !prodKey || !week || lineIdx === undefined) {
    return res.status(400).json({ success: false, error: 'custKey, prodKey, week, lineIdx 필요' });
  }
  try {
    const ck = parseInt(custKey);
    const pk = parseInt(prodKey);
    const idx = parseInt(lineIdx);
    // 현재 Descr 조회
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
        // OrderDetailKey = MAX+1 (IDENTITY가 아닌 테이블 대응)
        const maxKey = await tQ(
          `SELECT ISNULL(MAX(OrderDetailKey),0)+1 AS nextKey FROM OrderDetail WITH (UPDLOCK)`,
          {}
        );
        const nextKey = maxKey.recordset[0].nextKey;
        await tQ(
          `INSERT INTO OrderDetail (OrderDetailKey,OrderMasterKey,ProdKey,OutQuantity,BoxQuantity,BunchQuantity,SteamQuantity,isDeleted,CreateID,CreateDtm)
           VALUES(@nk,@mk,@pk,@qty,@bq,@bnq,@sq,0,@uid,GETDATE())`,
          {
            nk:  { type: sql.Int,   value: nextKey },
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
