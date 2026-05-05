// pages/api/shipment/fix.js
// POST { week, action: 'fix' | 'unfix' }
// 확정: isFix=1 + ProductStock 업데이트 + StockHistory 기록
// 확정취소: isFix=0

import { query, withTransaction, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

export default withAuth(async function handler(req, res) {
  if (req.method === 'GET') return await validate(req, res);
  if (req.method !== 'POST') return res.status(405).end();
  const { week, prodKey, action } = req.body;
  if (!week) return res.status(400).json({ success: false, error: 'week 필요' });
  if (!['fix', 'unfix'].includes(action)) return res.status(400).json({ success: false, error: 'action은 fix 또는 unfix' });

  try {
    if (action === 'unfix') return await unfix(req, res, week, prodKey);
    return await fix(req, res, week, prodKey);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── 확정 전 사전검증 (GET ?week=16-01)
// 1. 주문 없는데 출고 있는 품목 (ghost)
// 2. 같은 거래처+품목에 중복 출고 레코드
// 3. 마이너스 잔량 품목
async function validate(req, res) {
  const { week } = req.query;
  if (!week) return res.status(400).json({ success: false, error: 'week 필요' });
  try {
    const wk = { type: sql.NVarChar, value: week };

    // 1. 주문 없는 출고 (OrderDetail 없는데 ShipmentDetail 있음)
    const ghostResult = await query(
      `SELECT DISTINCT p.ProdName, c.CustName, sd.OutQuantity,
         sm.ShipmentKey, sm.isFix, sm.WebCreated
       FROM ShipmentDetail sd
       JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
       JOIN Product p ON sd.ProdKey = p.ProdKey
       JOIN Customer c ON sm.CustKey = c.CustKey
       WHERE sm.OrderWeek = @wk AND sm.isDeleted = 0 AND sd.OutQuantity > 0
         AND NOT EXISTS (
           SELECT 1 FROM OrderDetail od
           JOIN OrderMaster om ON od.OrderMasterKey = om.OrderMasterKey
           WHERE om.CustKey = sm.CustKey AND om.OrderWeek = @wk
             AND od.ProdKey = sd.ProdKey AND om.isDeleted = 0 AND od.isDeleted = 0
         )
       ORDER BY c.CustName, p.ProdName`,
      { wk }
    );

    // 2. 중복 출고 (같은 거래처+품목+차수에 ShipmentDetail 2건 이상)
    const dupResult = await query(
      `SELECT p.ProdName, c.CustName,
         COUNT(sd.SdetailKey) AS cnt,
         SUM(sd.OutQuantity) AS totalQty,
         STRING_AGG(CAST(sd.ShipmentKey AS NVARCHAR(20)), ',') AS shipKeys
       FROM ShipmentDetail sd
       JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
       JOIN Product p ON sd.ProdKey = p.ProdKey
       JOIN Customer c ON sm.CustKey = c.CustKey
       WHERE sm.OrderWeek = @wk AND sm.isDeleted = 0 AND sd.OutQuantity > 0
       GROUP BY sm.CustKey, sd.ProdKey, p.ProdName, c.CustName
       HAVING COUNT(sd.SdetailKey) > 1
       ORDER BY c.CustName, p.ProdName`,
      { wk }
    );

    // 3. 마이너스 잔량
    const negResult = await query(
      `SELECT p.ProdName, p.FlowerName, p.CounName,
         ISNULL((SELECT TOP 1 ps.Stock FROM ProductStock ps
           JOIN StockMaster sm2 ON ps.StockKey = sm2.StockKey
           WHERE ps.ProdKey = p.ProdKey AND sm2.OrderWeek < @wk
           ORDER BY sm2.OrderWeek DESC), 0) AS prevStock,
         ISNULL((SELECT SUM(wd.OutQuantity) FROM WarehouseDetail wd
           JOIN WarehouseMaster wm ON wd.WarehouseKey = wm.WarehouseKey
           WHERE wd.ProdKey = p.ProdKey AND wm.OrderWeek = @wk AND wm.isDeleted = 0), 0) AS inQty,
         ISNULL((SELECT SUM(sd.OutQuantity) FROM ShipmentDetail sd
           JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
           WHERE sd.ProdKey = p.ProdKey AND sm.OrderWeek = @wk AND sm.isDeleted = 0), 0) AS outQty
       FROM Product p
       WHERE p.isDeleted = 0
         AND EXISTS (SELECT 1 FROM ShipmentDetail sd2
           JOIN ShipmentMaster sm3 ON sd2.ShipmentKey = sm3.ShipmentKey
           WHERE sd2.ProdKey = p.ProdKey AND sm3.OrderWeek = @wk AND sm3.isDeleted = 0 AND sd2.OutQuantity > 0)
       HAVING
         ISNULL((SELECT TOP 1 ps.Stock FROM ProductStock ps
           JOIN StockMaster sm2 ON ps.StockKey = sm2.StockKey
           WHERE ps.ProdKey = p.ProdKey AND sm2.OrderWeek < @wk
           ORDER BY sm2.OrderWeek DESC), 0)
         + ISNULL((SELECT SUM(wd.OutQuantity) FROM WarehouseDetail wd
           JOIN WarehouseMaster wm ON wd.WarehouseKey = wm.WarehouseKey
           WHERE wd.ProdKey = p.ProdKey AND wm.OrderWeek = @wk AND wm.isDeleted = 0), 0)
         - ISNULL((SELECT SUM(sd.OutQuantity) FROM ShipmentDetail sd
           JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
           WHERE sd.ProdKey = p.ProdKey AND sm.OrderWeek = @wk AND sm.isDeleted = 0), 0) < 0
       ORDER BY p.FlowerName, p.ProdName`,
      { wk }
    );

    const negRows = negResult.recordset.map(r => ({
      ...r,
      remain: Math.round((r.prevStock + r.inQty - r.outQty) * 1000) / 1000,
    }));

    // 4. 입고 없는 출고 (WarehouseDetail 없는데 ShipmentDetail.OutQuantity > 0)
    //    이 케이스가 견적서에서 "입고 0인데 출고 5" 처럼 보여 작업 오류 유발
    const noInResult = await query(
      `SELECT DISTINCT p.ProdName, p.FlowerName, p.CounName,
         SUM(sd.OutQuantity) AS outQty,
         ISNULL((SELECT SUM(wd.OutQuantity) FROM WarehouseDetail wd
           JOIN WarehouseMaster wm ON wd.WarehouseKey = wm.WarehouseKey
           WHERE wd.ProdKey = p.ProdKey AND wm.OrderWeek = @wk AND wm.isDeleted = 0), 0) AS inQty
       FROM ShipmentDetail sd
       JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
       JOIN Product p ON sd.ProdKey = p.ProdKey
       WHERE sm.OrderWeek = @wk AND sm.isDeleted = 0 AND sd.OutQuantity > 0
       GROUP BY p.ProdKey, p.ProdName, p.FlowerName, p.CounName
       HAVING ISNULL((SELECT SUM(wd.OutQuantity) FROM WarehouseDetail wd
           JOIN WarehouseMaster wm ON wd.WarehouseKey = wm.WarehouseKey
           WHERE wd.ProdKey = p.ProdKey AND wm.OrderWeek = @wk AND wm.isDeleted = 0), 0) = 0
       ORDER BY p.FlowerName, p.ProdName`,
      { wk }
    );

    const issues = ghostResult.recordset.length + dupResult.recordset.length + negRows.length + noInResult.recordset.length;
    return res.status(200).json({
      success: true,
      week,
      issueCount: issues,
      ghost:    ghostResult.recordset,    // 주문 없는 출고
      noIncoming: noInResult.recordset,   // 입고 없는 출고 (4번째 검증)
      duplicate: dupResult.recordset,     // 중복 출고
      negative: negRows,                  // 마이너스 잔량
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ── 확정 (withTransaction으로 전체 묶음 → 동시 확정 시 재고 중복/누락 방지)
async function fix(req, res, week, prodKeyFilter) {
  // 1. 이미 확정된 항목 확인 (트랜잭션 밖에서 빠른 체크)
  const already = await query(
    `SELECT COUNT(*) AS cnt FROM ShipmentMaster WHERE OrderWeek=@wk AND isFix=1 AND isDeleted=0`,
    { wk: { type: sql.NVarChar, value: week } }
  );
  if (already.recordset[0].cnt > 0 && !prodKeyFilter) {
    return res.status(400).json({ success: false, error: `[${week}] 이미 확정된 항목이 있습니다. 먼저 확정취소 후 진행하세요.` });
  }

  // 2~6. 전체 재고 계산 + 저장을 하나의 트랜잭션으로
  const { stockKey, updatedCount, historyItems } = await withTransaction(async (tQuery) => {
    // StockMaster 확인/생성 (UPDLOCK으로 동시 접근 차단)
    let smResult = await tQuery(
      `SELECT StockKey FROM StockMaster WITH (UPDLOCK, HOLDLOCK) WHERE OrderWeek=@wk`,
      { wk: { type: sql.NVarChar, value: week } }
    );

    let sk;
    if (smResult.recordset.length === 0) {
      const ins = await tQuery(
        `INSERT INTO StockMaster (OrderWeek, isFix) OUTPUT INSERTED.StockKey VALUES (@wk, 1)`,
        { wk: { type: sql.NVarChar, value: week } }
      );
      sk = ins.recordset[0].StockKey;
    } else {
      sk = smResult.recordset[0].StockKey;
      await tQuery(`UPDATE StockMaster SET isFix=1 WHERE StockKey=@sk`,
        { sk: { type: sql.Int, value: sk } });
    }

    // 이전 차수 StockKey (확정된 차수)
    const prevSM = await tQuery(
      `SELECT TOP 1 StockKey FROM StockMaster WHERE OrderWeek < @wk AND isFix=1 ORDER BY OrderWeek DESC`,
      { wk: { type: sql.NVarChar, value: week } }
    );
    const prevStockKey = prevSM.recordset[0]?.StockKey || null;

    // 시작재고 StockKey (isFix=2: 차수피벗에서 수동 입력한 시작재고 우선 사용)
    const startSM = await tQuery(
      `SELECT StockKey FROM StockMaster WHERE OrderWeek=@wk AND isFix=2`,
      { wk: { type: sql.NVarChar, value: week } }
    );
    const startStockKey = startSM.recordset[0]?.StockKey || null;

    // 출고 집계
    let shipWhere = 'WHERE sm.OrderWeek=@wk AND sm.isDeleted=0';
    const shipParams = { wk: { type: sql.NVarChar, value: week } };
    if (prodKeyFilter) { shipWhere += ' AND sd.ProdKey=@pk'; shipParams.pk = { type: sql.Int, value: parseInt(prodKeyFilter) }; }
    const outResult = await tQuery(
      `SELECT sd.ProdKey, SUM(sd.OutQuantity) AS outQty FROM ShipmentDetail sd
       JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey ${shipWhere} GROUP BY sd.ProdKey`,
      shipParams
    );

    // 입고 집계
    let inWhere = 'WHERE wm.OrderWeek=@wk AND wm.isDeleted=0';
    const inParams = { wk: { type: sql.NVarChar, value: week } };
    if (prodKeyFilter) { inWhere += ' AND wd.ProdKey=@pk'; inParams.pk = { type: sql.Int, value: parseInt(prodKeyFilter) }; }
    const inResult = await tQuery(
      `SELECT wd.ProdKey, SUM(wd.OutQuantity) AS inQty FROM WarehouseDetail wd
       JOIN WarehouseMaster wm ON wd.WarehouseKey = wm.WarehouseKey ${inWhere} GROUP BY wd.ProdKey`,
      inParams
    );

    const outMap = {}; outResult.recordset.forEach(r => { outMap[r.ProdKey] = r.outQty || 0; });
    const inMap  = {}; inResult.recordset.forEach(r => { inMap[r.ProdKey]  = r.inQty  || 0; });
    const allProdKeys = [...new Set([...Object.keys(outMap).map(Number), ...Object.keys(inMap).map(Number)])];

    let cnt = 0; const items = [];
    for (const pk of allProdKeys) {
      let prevStock = 0;
      // 시작재고(isFix=2) 우선 — 없으면 이전 확정 차수 재고 사용
      if (startStockKey) {
        const ss = await tQuery(
          `SELECT Stock FROM ProductStock WHERE ProdKey=@pk AND StockKey=@sk`,
          { pk: { type: sql.Int, value: pk }, sk: { type: sql.Int, value: startStockKey } }
        );
        if (ss.recordset.length > 0) {
          prevStock = ss.recordset[0].Stock || 0;
        } else if (prevStockKey) {
          const ps = await tQuery(
            `SELECT Stock FROM ProductStock WHERE ProdKey=@pk AND StockKey=@sk`,
            { pk: { type: sql.Int, value: pk }, sk: { type: sql.Int, value: prevStockKey } }
          );
          prevStock = ps.recordset[0]?.Stock || 0;
        }
      } else if (prevStockKey) {
        const ps = await tQuery(
          `SELECT Stock FROM ProductStock WHERE ProdKey=@pk AND StockKey=@sk`,
          { pk: { type: sql.Int, value: pk }, sk: { type: sql.Int, value: prevStockKey } }
        );
        prevStock = ps.recordset[0]?.Stock || 0;
      }

      const inQty = inMap[pk] || 0;
      const outQty = outMap[pk] || 0;
      const newStock = prevStock + inQty - outQty;

      // MERGE로 ProductStock upsert (동시 실행 안전)
      await tQuery(
        `MERGE INTO ProductStock WITH (HOLDLOCK) AS t
         USING (VALUES (@pk, @sk)) AS s(ProdKey, StockKey) ON t.ProdKey=s.ProdKey AND t.StockKey=s.StockKey
         WHEN MATCHED THEN UPDATE SET Stock=@stock
         WHEN NOT MATCHED THEN INSERT (ProdKey, StockKey, Stock) VALUES (@pk, @sk, @stock);`,
        { pk: { type: sql.Int, value: pk }, sk: { type: sql.Int, value: sk }, stock: { type: sql.Float, value: newStock } }
      );

      await tQuery(
        `INSERT INTO StockHistory (ChangeDtm,OrderYear,OrderWeek,ChangeID,ChangeType,ColumName,BeforeValue,AfterValue,Descr,ProdKey)
         VALUES (GETDATE(),@yr,@wk,@uid,'확정','수량',@before,@after,@descr,@pk)`,
        {
          yr: { type: sql.NVarChar, value: week.split('-')[0] || '2026' }, wk: { type: sql.NVarChar, value: week },
          uid: { type: sql.NVarChar, value: req.user.userId }, before: { type: sql.Float, value: prevStock },
          after: { type: sql.Float, value: newStock },
          descr: { type: sql.NVarChar, value: `확정: 전재고${prevStock}+입고${inQty}-출고${outQty}=${newStock}` },
          pk: { type: sql.Int, value: pk },
        }
      );
      items.push({ prodKey: pk, prevStock, inQty, outQty, newStock }); cnt++;
    }

    await tQuery(`UPDATE ShipmentMaster SET isFix=1 WHERE OrderWeek=@wk AND isDeleted=0`,
      { wk: { type: sql.NVarChar, value: week } });

    return { stockKey: sk, updatedCount: cnt, historyItems: items };
  });

  return res.status(200).json({
    success: true,
    message: `[${week}] 확정 완료 — ${updatedCount}개 품목 재고 업데이트`,
    stockKey, updatedCount, items: historyItems,
  });
}

// ── 확정 취소 ──────────────────────────────────────────
async function unfix(req, res, week, prodKeyFilter) {
  // ShipmentMaster isFix = 0
  await query(
    `UPDATE ShipmentMaster SET isFix=0 WHERE OrderWeek=@wk AND isDeleted=0`,
    { wk: { type: sql.NVarChar, value: week } }
  );

  // StockMaster isFix = 0
  await query(
    `UPDATE StockMaster SET isFix=0 WHERE OrderWeek=@wk`,
    { wk: { type: sql.NVarChar, value: week } }
  );

  // StockHistory 확정취소 기록
  await query(
    `INSERT INTO StockHistory
       (ChangeDtm, OrderYear, OrderWeek, ChangeID, ChangeType, ColumName,
        BeforeValue, AfterValue, Descr, ProdKey)
     VALUES (GETDATE(), @yr, @wk, @uid, '확정취소', '수량', 0, 0, '확정 취소', 0)`,
    {
      yr:  { type: sql.NVarChar, value: week.split('-')[0] || '2026' },
      wk:  { type: sql.NVarChar, value: week },
      uid: { type: sql.NVarChar, value: req.user.userId },
    }
  );

  return res.status(200).json({
    success: true,
    message: `[${week}] 확정 취소 완료`,
  });
}
