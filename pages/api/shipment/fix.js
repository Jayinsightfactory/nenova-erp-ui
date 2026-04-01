// pages/api/shipment/fix.js
// POST { week, action: 'fix' | 'unfix' }
// 확정: isFix=1 + ProductStock 업데이트 + StockHistory 기록
// 확정취소: isFix=0

import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

export default withAuth(async function handler(req, res) {
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

// ── 확정 ──────────────────────────────────────────────
async function fix(req, res, week, prodKeyFilter) {
  // 1. 이미 확정된 항목 확인
  const already = await query(
    `SELECT COUNT(*) AS cnt FROM ShipmentMaster WHERE OrderWeek=@wk AND isFix=1 AND isDeleted=0`,
    { wk: { type: sql.NVarChar, value: week } }
  );
  if (already.recordset[0].cnt > 0 && !prodKeyFilter) {
    return res.status(400).json({ success: false, error: `[${week}] 이미 확정된 항목이 있습니다. 먼저 확정취소 후 진행하세요.` });
  }

  // 2. 해당 차수 StockMaster 확인/생성
  let smResult = await query(
    `SELECT StockKey FROM StockMaster WHERE OrderWeek=@wk`,
    { wk: { type: sql.NVarChar, value: week } }
  );

  let stockKey;
  if (smResult.recordset.length === 0) {
    const ins = await query(
      `INSERT INTO StockMaster (OrderWeek, isFix) OUTPUT INSERTED.StockKey VALUES (@wk, 1)`,
      { wk: { type: sql.NVarChar, value: week } }
    );
    stockKey = ins.recordset[0].StockKey;
  } else {
    stockKey = smResult.recordset[0].StockKey;
    await query(`UPDATE StockMaster SET isFix=1 WHERE StockKey=@sk`,
      { sk: { type: sql.Int, value: stockKey } });
  }

  // 3. 이전 차수 StockKey 조회 (전재고 기준)
  const prevSM = await query(
    `SELECT TOP 1 StockKey FROM StockMaster
     WHERE OrderWeek < @wk AND isFix=1
     ORDER BY OrderWeek DESC`,
    { wk: { type: sql.NVarChar, value: week } }
  );
  const prevStockKey = prevSM.recordset[0]?.StockKey || null;

  // 4. 해당 차수 출고 집계 (품목별)
  let shipWhere = 'WHERE sm.OrderWeek=@wk AND sm.isDeleted=0';
  const shipParams = { wk: { type: sql.NVarChar, value: week } };
  if (prodKeyFilter) {
    shipWhere += ' AND sd.ProdKey=@pk';
    shipParams.pk = { type: sql.Int, value: parseInt(prodKeyFilter) };
  }

  const outResult = await query(
    `SELECT sd.ProdKey, SUM(sd.OutQuantity) AS outQty
     FROM ShipmentDetail sd
     JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
     ${shipWhere}
     GROUP BY sd.ProdKey`,
    shipParams
  );

  // 5. 해당 차수 입고 집계 (품목별)
  let inWhere = 'WHERE wm.OrderWeek=@wk AND wm.isDeleted=0';
  const inParams = { wk: { type: sql.NVarChar, value: week } };
  if (prodKeyFilter) {
    inWhere += ' AND wd.ProdKey=@pk';
    inParams.pk = { type: sql.Int, value: parseInt(prodKeyFilter) };
  }

  const inResult = await query(
    `SELECT wd.ProdKey, SUM(wd.OutQuantity) AS inQty
     FROM WarehouseDetail wd
     JOIN WarehouseMaster wm ON wd.WarehouseKey = wm.WarehouseKey
     ${inWhere}
     GROUP BY wd.ProdKey`,
    inParams
  );

  // 품목별 맵 구성
  const outMap = {};
  outResult.recordset.forEach(r => { outMap[r.ProdKey] = r.outQty || 0; });

  const inMap = {};
  inResult.recordset.forEach(r => { inMap[r.ProdKey] = r.inQty || 0; });

  // 관련 품목 전체 목록
  const allProdKeys = [...new Set([
    ...Object.keys(outMap).map(Number),
    ...Object.keys(inMap).map(Number),
  ])];

  let updatedCount = 0;
  const historyItems = [];

  for (const pk of allProdKeys) {
    // 전재고 조회
    let prevStock = 0;
    if (prevStockKey) {
      const ps = await query(
        `SELECT Stock FROM ProductStock WHERE ProdKey=@pk AND StockKey=@sk`,
        { pk: { type: sql.Int, value: pk }, sk: { type: sql.Int, value: prevStockKey } }
      );
      prevStock = ps.recordset[0]?.Stock || 0;
    }

    const inQty  = inMap[pk]  || 0;
    const outQty = outMap[pk] || 0;
    const newStock = prevStock + inQty - outQty;

    // ProductStock upsert
    const exists = await query(
      `SELECT StockKey FROM ProductStock WHERE ProdKey=@pk AND StockKey=@sk`,
      { pk: { type: sql.Int, value: pk }, sk: { type: sql.Int, value: stockKey } }
    );

    if (exists.recordset.length === 0) {
      await query(
        `INSERT INTO ProductStock (ProdKey, StockKey, Stock) VALUES (@pk, @sk, @stock)`,
        { pk: { type: sql.Int, value: pk }, sk: { type: sql.Int, value: stockKey }, stock: { type: sql.Float, value: newStock } }
      );
    } else {
      await query(
        `UPDATE ProductStock SET Stock=@stock WHERE ProdKey=@pk AND StockKey=@sk`,
        { pk: { type: sql.Int, value: pk }, sk: { type: sql.Int, value: stockKey }, stock: { type: sql.Float, value: newStock } }
      );
    }

    // StockHistory 기록
    await query(
      `INSERT INTO StockHistory
         (ChangeDtm, OrderYear, OrderWeek, ChangeID, ChangeType, ColumName,
          BeforeValue, AfterValue, Descr, ProdKey)
       VALUES (GETDATE(), @yr, @wk, @uid, '확정', '수량', @before, @after, @descr, @pk)`,
      {
        yr:     { type: sql.NVarChar, value: week.split('-')[0] || '2026' },
        wk:     { type: sql.NVarChar, value: week },
        uid:    { type: sql.NVarChar, value: req.user.userId },
        before: { type: sql.Float,    value: prevStock },
        after:  { type: sql.Float,    value: newStock },
        descr:  { type: sql.NVarChar, value: `확정: 전재고${prevStock} + 입고${inQty} - 출고${outQty} = ${newStock}` },
        pk:     { type: sql.Int,      value: pk },
      }
    );

    historyItems.push({ prodKey: pk, prevStock, inQty, outQty, newStock });
    updatedCount++;
  }

  // 6. ShipmentMaster isFix = 1
  let fixWhere = 'WHERE OrderWeek=@wk AND isDeleted=0';
  const fixParams = { wk: { type: sql.NVarChar, value: week } };
  await query(`UPDATE ShipmentMaster SET isFix=1 ${fixWhere}`, fixParams);

  return res.status(200).json({
    success: true,
    message: `[${week}] 확정 완료 — ${updatedCount}개 품목 재고 업데이트`,
    stockKey,
    updatedCount,
    items: historyItems,
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
