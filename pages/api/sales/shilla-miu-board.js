// 신라·미우 통합 게시판
// GET: 전산 주문/입고/확정분배 + 공급차수/사용차수 웹 매칭 조회
// POST: 라움·미우 분배수량과 매칭 하이라이트 저장 (ERP 원장은 변경하지 않음)

import { withAuth } from '../../../lib/auth';
import { query, withTransaction, sql } from '../../../lib/db';
import { buildBoardRows, buildMajorWeeks, normalizeMajorWeek, BOARD_DESTINATIONS } from '../../../lib/shillaMiuBoard';

let ensurePromise = null;
function ensureBoardTable() {
  if (ensurePromise) return ensurePromise;
  ensurePromise = query(`
    IF OBJECT_ID(N'dbo.WebShillaMiuBoardAllocation', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.WebShillaMiuBoardAllocation (
        BoardKey BIGINT IDENTITY(1,1) PRIMARY KEY,
        OrderYear NVARCHAR(4) NOT NULL,
        SupplyWeek NVARCHAR(4) NOT NULL,
        UseWeek NVARCHAR(4) NOT NULL,
        ProdKey INT NOT NULL,
        Destination NVARCHAR(10) NOT NULL,
        Qty DECIMAL(18,3) NOT NULL DEFAULT 0,
        Matched BIT NOT NULL DEFAULT 0,
        Memo NVARCHAR(500) NOT NULL DEFAULT N'',
        CreatedBy NVARCHAR(50) NULL,
        CreatedAt DATETIME NOT NULL DEFAULT GETDATE(),
        UpdatedBy NVARCHAR(50) NULL,
        UpdatedAt DATETIME NOT NULL DEFAULT GETDATE(),
        isDeleted BIT NOT NULL DEFAULT 0
      );
      CREATE INDEX IX_WebShillaMiuBoardAllocation_Scope
        ON dbo.WebShillaMiuBoardAllocation(OrderYear, UseWeek, ProdKey, Destination, isDeleted);
    END`, {}).catch((error) => { ensurePromise = null; throw error; });
  return ensurePromise;
}

function text(value, fallback = '') { return String(value ?? fallback).trim(); }

function buildWeekParams(weeks) {
  const params = { yr: { type: sql.NVarChar, value: '' } };
  const names = weeks.map((_, i) => `w${i}`);
  names.forEach((name, i) => { params[name] = { type: sql.NVarChar, value: weeks[i] }; });
  return { params, clause: names.map(name => `@${name}`).join(',') };
}

async function loadBoard({ year, weeks }) {
  const { params, clause } = buildWeekParams(weeks);
  params.yr.value = year;
  const baseProduct = `p.isDeleted = 0 AND LEFT(REPLACE(ISNULL(%s.OrderWeek, N''), N'-', N''), 2) IN (${clause})`;
  const order = await query(
    `SELECT LEFT(om.OrderWeek,2) AS week, p.ProdKey AS prodKey, p.CounName AS country,
            p.FlowerName AS flower, p.ProdName AS prodName, p.OutUnit AS unit,
            SUM(ISNULL(od.OutQuantity,0)) AS qty
       FROM OrderMaster om
       JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey AND ISNULL(od.isDeleted,0)=0
       JOIN Product p ON p.ProdKey=od.ProdKey AND ${baseProduct.replace('%s', 'om')}
      WHERE om.OrderYear=@yr AND ISNULL(om.isDeleted,0)=0
      GROUP BY LEFT(om.OrderWeek,2), p.ProdKey, p.CounName, p.FlowerName, p.ProdName, p.OutUnit`,
    params
  );
  const incoming = await query(
    `SELECT LEFT(wm.OrderWeek,2) AS week, p.ProdKey AS prodKey, p.CounName AS country,
            p.FlowerName AS flower, p.ProdName AS prodName, p.OutUnit AS unit,
            SUM(ISNULL(wd.OutQuantity,0)) AS qty
       FROM WarehouseMaster wm
       JOIN WarehouseDetail wd ON wd.WarehouseKey=wm.WarehouseKey
       JOIN Product p ON p.ProdKey=wd.ProdKey AND ${baseProduct.replace('%s', 'wm')}
      WHERE wm.OrderYear=@yr AND ISNULL(wm.isDeleted,0)=0
      GROUP BY LEFT(wm.OrderWeek,2), p.ProdKey, p.CounName, p.FlowerName, p.ProdName, p.OutUnit`,
    params
  );
  const shipments = await query(
    `SELECT LEFT(sm.OrderWeek,2) AS week, p.ProdKey AS prodKey, p.CounName AS country,
            p.FlowerName AS flower, p.ProdName AS prodName, p.OutUnit AS unit,
            SUM(CASE WHEN c.CustName LIKE N'%신라%' THEN ISNULL(sd.OutQuantity,0) ELSE 0 END) AS shillaQty,
            SUM(CASE WHEN c.CustName LIKE N'%라움%' OR c.CustName LIKE N'%트라움%' THEN ISNULL(sd.OutQuantity,0) ELSE 0 END) AS raumQty,
            SUM(CASE WHEN c.CustName LIKE N'%미우%' OR c.CustName LIKE N'%아이엠%' THEN ISNULL(sd.OutQuantity,0) ELSE 0 END) AS miuQty,
            SUM(CASE WHEN c.CustName NOT LIKE N'%신라%' AND c.CustName NOT LIKE N'%라움%'
                          AND c.CustName NOT LIKE N'%트라움%' AND c.CustName NOT LIKE N'%미우%'
                          AND c.CustName NOT LIKE N'%아이엠%' THEN ISNULL(sd.OutQuantity,0) ELSE 0 END) AS otherQty
       FROM ShipmentMaster sm
       JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
       JOIN Customer c ON c.CustKey=sm.CustKey AND ISNULL(c.isDeleted,0)=0
       JOIN Product p ON p.ProdKey=sd.ProdKey AND ${baseProduct.replace('%s', 'sm')}
      WHERE sm.OrderYear=@yr AND ISNULL(sm.isDeleted,0)=0 AND ISNULL(sd.isFix,0)=1
      GROUP BY LEFT(sm.OrderWeek,2), p.ProdKey, p.CounName, p.FlowerName, p.ProdName, p.OutUnit`,
    params
  );
  const firstYw = `${year}${weeks[0]}`;
  const opening = await query(
    `SELECT ps.ProdKey AS prodKey, p.CounName AS country, p.FlowerName AS flower,
            p.ProdName AS prodName, p.OutUnit AS unit, ISNULL(ps.Stock,0) AS qty
       FROM ProductStock ps
       JOIN Product p ON p.ProdKey=ps.ProdKey AND p.isDeleted=0
      WHERE ps.StockKey=(SELECT TOP 1 StockKey FROM StockMaster
                          WHERE OrderYearWeek < @yws
                          ORDER BY OrderYearWeek DESC, OrderWeek DESC, StockKey DESC)`,
    { yws: { type: sql.NVarChar, value: firstYw } }
  );
  const allocation = await query(
    `SELECT BoardKey AS boardKey, SupplyWeek AS supplyWeek, UseWeek AS useWeek,
            ProdKey AS prodKey, Destination AS destination, Qty AS qty,
            Matched AS matched, Memo AS memo
       FROM dbo.WebShillaMiuBoardAllocation
      WHERE OrderYear=@yr AND UseWeek IN (${clause}) AND ISNULL(isDeleted,0)=0
      ORDER BY UseWeek, ProdKey, Destination, SupplyWeek, BoardKey`,
    params
  );
  const rows = buildBoardRows({
    weeks,
    orders: order.recordset || [],
    incoming: incoming.recordset || [],
    shipments: shipments.recordset || [],
    openingStocks: opening.recordset || [],
    allocations: allocation.recordset || [],
  });
  return { rows, allocationCount: allocation.recordset?.length || 0 };
}

async function saveAllocations(req, res) {
  await ensureBoardTable();
  const year = text(req.body?.year);
  if (!/^\d{4}$/.test(year)) return res.status(400).json({ success: false, error: '연도가 올바르지 않습니다.' });
  const allocations = Array.isArray(req.body?.allocations) ? req.body.allocations : [];
  if (!allocations.length) return res.status(400).json({ success: false, error: '저장할 분배가 없습니다.' });
  const actor = text(req.user?.userName || req.user?.userId, 'user').slice(0, 50);
  const normalized = allocations.map((item) => {
    const destination = text(item.destination).toUpperCase();
    const supplyWeek = normalizeMajorWeek(item.supplyWeek);
    const useWeek = normalizeMajorWeek(item.useWeek);
    const prodKey = Number(item.prodKey);
    const qty = Number(item.qty ?? 0);
    if (!BOARD_DESTINATIONS.includes(destination)) throw new Error('라움·미우 분배만 저장할 수 있습니다.');
    if (!Number.isInteger(prodKey) || prodKey <= 0) throw new Error('품목키가 올바르지 않습니다.');
    if (!Number.isFinite(qty) || qty < 0) throw new Error('분배수량은 0 이상이어야 합니다.');
    return { supplyWeek, useWeek, prodKey, destination, qty, matched: item.matched ? 1 : 0, memo: text(item.memo).slice(0, 500) };
  });
  await withTransaction(async (tQuery) => {
    for (const item of normalized) {
      const exists = await tQuery(
        `SELECT TOP 1 BoardKey FROM dbo.WebShillaMiuBoardAllocation WITH (UPDLOCK, HOLDLOCK)
          WHERE OrderYear=@yr AND SupplyWeek=@sw AND UseWeek=@uw AND ProdKey=@pk
            AND Destination=@dest AND ISNULL(isDeleted,0)=0`,
        { yr: { type: sql.NVarChar, value: year }, sw: { type: sql.NVarChar, value: item.supplyWeek }, uw: { type: sql.NVarChar, value: item.useWeek }, pk: { type: sql.Int, value: item.prodKey }, dest: { type: sql.NVarChar, value: item.destination } }
      );
      const common = {
        yr: { type: sql.NVarChar, value: year }, sw: { type: sql.NVarChar, value: item.supplyWeek }, uw: { type: sql.NVarChar, value: item.useWeek }, pk: { type: sql.Int, value: item.prodKey }, dest: { type: sql.NVarChar, value: item.destination }, qty: { type: sql.Decimal(18, 3), value: item.qty }, matched: { type: sql.Bit, value: item.matched }, memo: { type: sql.NVarChar, value: item.memo }, actor: { type: sql.NVarChar, value: actor },
      };
      if (exists.recordset[0]?.BoardKey) {
        await tQuery(
          `UPDATE dbo.WebShillaMiuBoardAllocation
              SET Qty=@qty, Matched=@matched, Memo=@memo, UpdatedBy=@actor, UpdatedAt=GETDATE(), isDeleted=0
            WHERE BoardKey=@key`,
          { ...common, key: { type: sql.BigInt, value: exists.recordset[0].BoardKey } }
        );
      } else {
        await tQuery(
          `INSERT INTO dbo.WebShillaMiuBoardAllocation
             (OrderYear,SupplyWeek,UseWeek,ProdKey,Destination,Qty,Matched,Memo,CreatedBy,UpdatedBy)
           VALUES (@yr,@sw,@uw,@pk,@dest,@qty,@matched,@memo,@actor,@actor)`,
          common
        );
      }
    }
  });
  return res.status(200).json({ success: true, saved: normalized.length });
}

export default withAuth(async function handler(req, res) {
  try {
    if (req.method === 'POST') return saveAllocations(req, res);
    if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'GET/POST only' });
    await ensureBoardTable();
    const year = text(req.query.year, String(new Date().getFullYear()));
    if (!/^\d{4}$/.test(year)) return res.status(400).json({ success: false, error: '연도가 올바르지 않습니다.' });
    const weeks = buildMajorWeeks(req.query.startWeek || '1', req.query.endWeek || req.query.startWeek || '1');
    const data = await loadBoard({ year, weeks });
    return res.status(200).json({ success: true, year, weeks, ...data });
  } catch (error) {
    return res.status(/차수|연도|수량|품목|분배/.test(error.message) ? 400 : 500).json({ success: false, error: error.message });
  }
});
