import { query, sql } from './db.js';
import { roundQty } from './orderImportCompareLogic.js';

let ensurePromise = null;

async function runQuery(pool, text, params = {}) {
  if (pool && typeof pool.request === 'function') {
    const req = pool.request();
    for (const [name, { type, value }] of Object.entries(params)) {
      req.input(name, type, value);
    }
    return req.query(text);
  }
  return query(text, params);
}

const CREATE_TABLE_SQL = `
IF OBJECT_ID(N'dbo.WebOrderImportSnapshot', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WebOrderImportSnapshot (
    SnapshotId BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    OrderYear INT NOT NULL,
    OrderWeek NVARCHAR(20) NOT NULL,
    CustKey INT NOT NULL,
    CustName NVARCHAR(200) NULL,
    SnapshotKind NVARCHAR(30) NOT NULL DEFAULT N'UPLOAD_REGISTER',
    FileName NVARCHAR(300) NULL,
    SheetName NVARCHAR(200) NULL,
    SourceType NVARCHAR(40) NULL,
    ItemCount INT NOT NULL DEFAULT 0,
    TotalQty DECIMAL(18, 4) NOT NULL DEFAULT 0,
    ItemsJson NVARCHAR(MAX) NOT NULL,
    SheetPreviewJson NVARCHAR(MAX) NULL,
    CreatedBy NVARCHAR(100) NULL,
    CreatedAt DATETIME2(0) NOT NULL DEFAULT GETDATE(),
    IsDeleted BIT NOT NULL DEFAULT 0
  );
  CREATE INDEX IX_WebOrderImportSnapshot_Lookup
    ON dbo.WebOrderImportSnapshot (OrderYear, OrderWeek, CustKey, IsDeleted, CreatedAt);
END;
`;

export async function ensureOrderImportSnapshotTable(pool = null) {
  if (!pool && ensurePromise) return ensurePromise;
  const run = runQuery(pool, CREATE_TABLE_SQL, {}).catch((err) => {
    if (!pool) ensurePromise = null;
    throw err;
  });
  if (!pool) ensurePromise = run;
  return run;
}

function capSheetPreview(sheetPreview) {
  if (!sheetPreview || typeof sheetPreview !== 'object') return null;
  const rows = Array.isArray(sheetPreview.rows) ? sheetPreview.rows.slice(0, 200) : [];
  return {
    sheetName: String(sheetPreview.sheetName || '').slice(0, 200),
    sourceRange: String(sheetPreview.sourceRange || '').slice(0, 80),
    headerRow: sheetPreview.headerRow != null ? Number(sheetPreview.headerRow) : null,
    rowCount: Number(sheetPreview.rowCount || rows.length),
    columnCount: Math.min(Number(sheetPreview.columnCount || 0), 25),
    rows: rows.map((row) => ({
      rowNo: Number(row?.rowNo) || 0,
      cells: (Array.isArray(row?.cells) ? row.cells : [])
        .slice(0, 25)
        .map((cell) => String(cell ?? '').slice(0, 160)),
    })),
  };
}

function normalizeSnapshotItems(items) {
  return (Array.isArray(items) ? items : []).map((it, idx) => ({
    rowNo: it?.rowNo != null && Number(it.rowNo) > 0 ? Number(it.rowNo) : idx + 1,
    inputName: String(it?.inputName || '').slice(0, 300),
    colorOrDetail: String(it?.colorOrDetail || it?.color || it?.detailLabel || '').slice(0, 200),
    matchName: String(it?.matchName || '').slice(0, 300),
    prodKey: Number(it?.prodKey) > 0 ? Number(it.prodKey) : null,
    prodName: String(it?.prodName || '').slice(0, 300),
    displayName: String(it?.displayName || it?.prodName || '').slice(0, 300),
    flowerName: String(it?.flowerName || '').slice(0, 100),
    counName: String(it?.counName || '').slice(0, 100),
    qty: roundQty(Number(it?.qty) || 0),
    unit: String(it?.unit || '').slice(0, 20),
    rawUnit: String(it?.rawUnit || '').slice(0, 20),
    outQty: roundQty(it?.outQty != null ? Number(it.outQty) : Number(it?.qty) || 0),
    outUnit: String(it?.outUnit || it?.unit || '').slice(0, 20),
    bunchOf1Box: Number(it?.bunchOf1Box) || 0,
    steamOf1Box: Number(it?.steamOf1Box) || 0,
    unitPrice: Number(it?.unitPrice) || 0,
    note: String(it?.note || '').slice(0, 300),
    rawCells: Array.isArray(it?.rawCells)
      ? it.rawCells.slice(0, 25).map((c) => String(c ?? '').slice(0, 160))
      : null,
  }));
}

export async function saveOrderImportSnapshot(pool, payload) {
  await ensureOrderImportSnapshotTable(pool);

  const normalizedItems = normalizeSnapshotItems(payload?.items);
  const cappedPreview = capSheetPreview(payload?.sheetPreview);
  const itemCount = normalizedItems.length;
  const totalQty = roundQty(
    normalizedItems.reduce((sum, it) => sum + (Number(it.outQty ?? it.qty) || 0), 0),
  );

  const res = await runQuery(
    pool,
    `INSERT INTO dbo.WebOrderImportSnapshot (
       OrderYear, OrderWeek, CustKey, CustName, SnapshotKind,
       FileName, SheetName, SourceType, ItemCount, TotalQty,
       ItemsJson, SheetPreviewJson, CreatedBy
     )
     OUTPUT INSERTED.SnapshotId AS snapshotId,
            CONVERT(NVARCHAR(19), INSERTED.CreatedAt, 126) AS createdAt
     VALUES (
       @orderYear, @orderWeek, @custKey, @custName, @snapshotKind,
       @fileName, @sheetName, @sourceType, @itemCount, @totalQty,
       @itemsJson, @sheetPreviewJson, @createdBy
     )`,
    {
      orderYear: { type: sql.Int, value: Number(payload.orderYear) },
      orderWeek: { type: sql.NVarChar, value: String(payload.orderWeek || '').slice(0, 20) },
      custKey: { type: sql.Int, value: Number(payload.custKey) },
      custName: { type: sql.NVarChar, value: payload.custName ? String(payload.custName).slice(0, 200) : null },
      snapshotKind: { type: sql.NVarChar, value: String(payload.snapshotKind || 'UPLOAD_REGISTER').slice(0, 30) },
      fileName: { type: sql.NVarChar, value: payload.fileName ? String(payload.fileName).slice(0, 300) : null },
      sheetName: { type: sql.NVarChar, value: payload.sheetName ? String(payload.sheetName).slice(0, 200) : null },
      sourceType: { type: sql.NVarChar, value: payload.sourceType ? String(payload.sourceType).slice(0, 40) : null },
      itemCount: { type: sql.Int, value: itemCount },
      totalQty: { type: sql.Decimal(18, 4), value: totalQty },
      itemsJson: { type: sql.NVarChar, value: JSON.stringify(normalizedItems) },
      sheetPreviewJson: { type: sql.NVarChar, value: cappedPreview ? JSON.stringify(cappedPreview) : null },
      createdBy: { type: sql.NVarChar, value: payload.createdBy ? String(payload.createdBy).slice(0, 100) : null },
    },
  );

  const row = res?.recordset?.[0] || {};
  return {
    snapshotId: Number(row.snapshotId || 0),
    createdAt: row.createdAt || new Date().toISOString().slice(0, 19),
  };
}

function safeJsonParse(raw, fallback) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export async function listOrderImportSnapshots(pool, { orderYear, orderWeek, custKey }) {
  await ensureOrderImportSnapshotTable(pool);

  const res = await runQuery(
    pool,
    `SELECT SnapshotId, OrderYear, OrderWeek, CustKey, CustName, SnapshotKind,
            FileName, SheetName, SourceType, ItemCount, TotalQty,
            ItemsJson, SheetPreviewJson, CreatedBy,
            CONVERT(NVARCHAR(19), CreatedAt, 126) AS CreatedAt
       FROM dbo.WebOrderImportSnapshot
      WHERE OrderYear = @orderYear
        AND OrderWeek = @orderWeek
        AND CustKey = @custKey
        AND IsDeleted = 0
      ORDER BY CreatedAt ASC, SnapshotId ASC`,
    {
      orderYear: { type: sql.Int, value: Number(orderYear) },
      orderWeek: { type: sql.NVarChar, value: String(orderWeek || '') },
      custKey: { type: sql.Int, value: Number(custKey) },
    },
  );

  return (res?.recordset || []).map((row) => ({
    snapshotId: Number(row.SnapshotId),
    orderYear: Number(row.OrderYear),
    orderWeek: row.OrderWeek,
    custKey: Number(row.CustKey),
    custName: row.CustName || '',
    snapshotKind: row.SnapshotKind || 'UPLOAD_REGISTER',
    fileName: row.FileName || '',
    sheetName: row.SheetName || '',
    sourceType: row.SourceType || '',
    itemCount: Number(row.ItemCount || 0),
    totalQty: Number(row.TotalQty || 0),
    items: safeJsonParse(row.ItemsJson, []),
    sheetPreview: safeJsonParse(row.SheetPreviewJson, null),
    createdBy: row.CreatedBy || '',
    createdAt: row.CreatedAt || '',
  }));
}
