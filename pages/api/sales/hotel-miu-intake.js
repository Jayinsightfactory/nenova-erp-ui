// 호텔+미우 주문입력 — 배치 원장·게시판 전용 매칭 overlay.
// Order/Shipment 쓰기는 /api/orders 가 담당한다. 이 API 는 WebHotelMiu* 만 쓴다.
import { withAuth } from '../../../lib/auth';
import { query, sql } from '../../../lib/db';
import { overlayMappingRecord, nextBatchNo, HOTEL_MIU_BATCH_DRAFT, HOTEL_MIU_BATCH_REGISTERED } from '../../../lib/hotelMiuIntake';

let ensurePromise = null;
function ensureTables() {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async () => {
    await query(`
      IF OBJECT_ID(N'dbo.WebHotelMiuIntakeBatch', N'U') IS NULL
      CREATE TABLE dbo.WebHotelMiuIntakeBatch (
        BatchKey INT IDENTITY(1,1) PRIMARY KEY,
        OrderYear NVARCHAR(4) NOT NULL,
        OrderWeek NVARCHAR(10) NOT NULL,
        CustKey INT NOT NULL,
        BatchNo INT NOT NULL,
        Status NVARCHAR(12) NOT NULL DEFAULT N'DRAFT',
        SourceNote NVARCHAR(200) NOT NULL DEFAULT N'',
        CreatedBy NVARCHAR(50) NULL,
        CreatedAt DATETIME NOT NULL DEFAULT GETDATE(),
        UpdatedBy NVARCHAR(50) NULL,
        UpdatedAt DATETIME NOT NULL DEFAULT GETDATE(),
        isDeleted BIT NOT NULL DEFAULT 0
      );
      IF OBJECT_ID(N'dbo.WebHotelMiuIntakeLine', N'U') IS NULL
      CREATE TABLE dbo.WebHotelMiuIntakeLine (
        LineKey INT IDENTITY(1,1) PRIMARY KEY,
        BatchKey INT NOT NULL,
        RawName NVARCHAR(200) NOT NULL,
        Unit NVARCHAR(10) NOT NULL DEFAULT N'',
        Qty FLOAT NOT NULL DEFAULT 0,
        ProdKey INT NULL,
        ProdName NVARCHAR(200) NULL,
        SourceType NVARCHAR(10) NOT NULL DEFAULT N'text',
        SortOrder INT NOT NULL DEFAULT 0
      );
      IF OBJECT_ID(N'dbo.WebHotelMiuProductMap', N'U') IS NULL
      CREATE TABLE dbo.WebHotelMiuProductMap (
        MapKey INT IDENTITY(1,1) PRIMARY KEY,
        InputToken NVARCHAR(200) NOT NULL,
        ProdKey INT NOT NULL,
        ProdName NVARCHAR(200) NOT NULL DEFAULT N'',
        DisplayName NVARCHAR(200) NOT NULL DEFAULT N'',
        FlowerName NVARCHAR(100) NOT NULL DEFAULT N'',
        CounName NVARCHAR(60) NOT NULL DEFAULT N'',
        Unit NVARCHAR(10) NOT NULL DEFAULT N'',
        UpdatedBy NVARCHAR(50) NULL,
        UpdatedAt DATETIME NOT NULL DEFAULT GETDATE(),
        isDeleted BIT NOT NULL DEFAULT 0
      );
      IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
         WHERE name = N'UX_WebHotelMiuIntakeBatch_YearWeekCustNo'
           AND object_id = OBJECT_ID(N'dbo.WebHotelMiuIntakeBatch')
      )
        CREATE UNIQUE INDEX UX_WebHotelMiuIntakeBatch_YearWeekCustNo
          ON dbo.WebHotelMiuIntakeBatch (OrderYear, OrderWeek, CustKey, BatchNo)
          WHERE isDeleted = 0;
    `, {});
  })().catch((e) => { ensurePromise = null; throw e; });
  return ensurePromise;
}

function text(v, fallback = '') { return String(v ?? fallback).trim(); }

async function listBatches(year, week, custKey) {
  const r = await query(
    `SELECT b.BatchKey, b.OrderYear, b.OrderWeek, b.CustKey, b.BatchNo, b.Status, b.SourceNote,
            CONVERT(varchar(19), b.CreatedAt, 120) AS CreatedAt, b.CreatedBy
       FROM WebHotelMiuIntakeBatch b
      WHERE b.OrderYear=@yr AND b.OrderWeek=@wk AND b.CustKey=@ck AND b.isDeleted=0
      ORDER BY b.BatchNo`,
    {
      yr: { type: sql.NVarChar, value: String(year) },
      wk: { type: sql.NVarChar, value: String(week) },
      ck: { type: sql.Int, value: Number(custKey) },
    }
  );
  const batches = [];
  for (const b of r.recordset) {
    const lines = await query(
      `SELECT LineKey, RawName, Unit, Qty, ProdKey, ProdName, SourceType, SortOrder
         FROM WebHotelMiuIntakeLine WHERE BatchKey=@bk ORDER BY SortOrder, LineKey`,
      { bk: { type: sql.Int, value: b.BatchKey } }
    );
    batches.push({
      batchKey: b.BatchKey,
      batchNo: b.BatchNo,
      status: b.Status,
      sourceNote: b.SourceNote,
      createdAt: b.CreatedAt,
      createdBy: b.CreatedBy,
      lines: lines.recordset.map((ln) => ({
        lineKey: ln.LineKey,
        inputName: ln.RawName,
        unit: ln.Unit,
        qty: Number(ln.Qty),
        prodKey: ln.ProdKey,
        prodName: ln.ProdName,
        sourceType: ln.SourceType,
      })),
    });
  }
  return batches;
}

export default withAuth(async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const year = text(req.query.year);
      const week = text(req.query.week);
      const custKey = Number(req.query.custKey);
      if (!year || !week || !custKey) return res.status(400).json({ success: false, error: 'year, week, custKey 필요' });
      const exists = await query(`SELECT 1 AS ok FROM sys.tables WHERE name=N'WebHotelMiuIntakeBatch'`, {});
      if (!exists.recordset.length) return res.status(200).json({ success: true, batches: [] });
      const batches = await listBatches(year, week, custKey);
      return res.status(200).json({ success: true, batches });
    }

    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
    await ensureTables();
    const actor = req.user?.userName || req.user?.userId || 'user';
    const action = text(req.body?.action);

    if (action === 'saveMapping') {
      const rec = overlayMappingRecord(req.body?.inputName, req.body?.prod || req.body, req.body?.unit);
      if (!rec) return res.status(400).json({ success: false, error: 'inputName, prodKey 필요' });
      await query(
        `UPDATE WebHotelMiuProductMap SET isDeleted=1, UpdatedAt=GETDATE(), UpdatedBy=@by
          WHERE InputToken=@tok AND isDeleted=0`,
        { tok: { type: sql.NVarChar, value: rec.token }, by: { type: sql.NVarChar, value: actor } }
      );
      await query(
        `INSERT INTO WebHotelMiuProductMap
           (InputToken, ProdKey, ProdName, DisplayName, FlowerName, CounName, Unit, UpdatedBy)
         VALUES (@tok,@pk,@pn,@dn,@fn,@cn,@un,@by)`,
        {
          tok: { type: sql.NVarChar, value: rec.token },
          pk: { type: sql.Int, value: rec.value.prodKey },
          pn: { type: sql.NVarChar, value: rec.value.prodName },
          dn: { type: sql.NVarChar, value: rec.value.displayName },
          fn: { type: sql.NVarChar, value: rec.value.flowerName },
          cn: { type: sql.NVarChar, value: rec.value.counName },
          un: { type: sql.NVarChar, value: rec.value.unit },
          by: { type: sql.NVarChar, value: actor },
        }
      );
      return res.status(200).json({ success: true, token: rec.token });
    }

    if (action === 'recordBatch' || action === 'updateBatch') {
      const year = text(req.body?.year);
      const week = text(req.body?.week);
      const custKey = Number(req.body?.custKey);
      const lines = Array.isArray(req.body?.lines) ? req.body.lines : [];
      if (!year || !week || !custKey) {
        return res.status(400).json({ success: false, error: 'year, week, custKey 필요' });
      }
      if (action === 'recordBatch' && !lines.length) {
        return res.status(400).json({ success: false, error: 'year, week, custKey, lines 필요' });
      }
      if (action === 'updateBatch') {
        const batchKey = Number(req.body?.batchKey);
        if (!batchKey) return res.status(400).json({ success: false, error: 'batchKey 필요' });
        const owned = await query(
          `SELECT BatchKey, Status FROM WebHotelMiuIntakeBatch
            WHERE BatchKey=@bk AND OrderYear=@yr AND OrderWeek=@wk AND CustKey=@ck AND isDeleted=0`,
          {
            bk: { type: sql.Int, value: batchKey },
            yr: { type: sql.NVarChar, value: year },
            wk: { type: sql.NVarChar, value: week },
            ck: { type: sql.Int, value: custKey },
          }
        );
        if (!owned.recordset[0]) {
          return res.status(404).json({ success: false, error: '해당 연도·차수·업체의 입력이 아닙니다.' });
        }
        await query(`DELETE FROM WebHotelMiuIntakeLine WHERE BatchKey=@bk`, { bk: { type: sql.Int, value: batchKey } });
        if (!lines.length) {
          await query(
            `UPDATE WebHotelMiuIntakeBatch
                SET isDeleted=1, UpdatedAt=GETDATE(), UpdatedBy=@by
              WHERE BatchKey=@bk AND OrderYear=@yr AND OrderWeek=@wk AND CustKey=@ck AND isDeleted=0`,
            {
              bk: { type: sql.Int, value: batchKey },
              yr: { type: sql.NVarChar, value: year },
              wk: { type: sql.NVarChar, value: week },
              ck: { type: sql.Int, value: custKey },
              by: { type: sql.NVarChar, value: actor },
            }
          );
          return res.status(200).json({ success: true, batchKey, deleted: true, batches: await listBatches(year, week, custKey) });
        }
        for (let i = 0; i < lines.length; i += 1) {
          const ln = lines[i];
          await query(
            `INSERT INTO WebHotelMiuIntakeLine (BatchKey, RawName, Unit, Qty, ProdKey, ProdName, SourceType, SortOrder)
             VALUES (@bk,@nm,@un,@qty,@pk,@pn,@st,@ord)`,
            {
              bk: { type: sql.Int, value: batchKey },
              nm: { type: sql.NVarChar, value: text(ln.inputName) },
              un: { type: sql.NVarChar, value: text(ln.unit) },
              qty: { type: sql.Float, value: Number(ln.qty || 0) },
              pk: { type: sql.Int, value: ln.prodKey ? Number(ln.prodKey) : null },
              pn: { type: sql.NVarChar, value: text(ln.prodName) },
              st: { type: sql.NVarChar, value: text(ln.sourceType, 'text') },
              ord: { type: sql.Int, value: i },
            }
          );
        }
        await query(
          `UPDATE WebHotelMiuIntakeBatch SET UpdatedAt=GETDATE(), UpdatedBy=@by WHERE BatchKey=@bk`,
          { bk: { type: sql.Int, value: batchKey }, by: { type: sql.NVarChar, value: actor } }
        );
        return res.status(200).json({ success: true, batchKey, batches: await listBatches(year, week, custKey) });
      }

      const status = String(req.body?.status || HOTEL_MIU_BATCH_DRAFT).toUpperCase() === HOTEL_MIU_BATCH_REGISTERED
        ? HOTEL_MIU_BATCH_REGISTERED
        : HOTEL_MIU_BATCH_DRAFT;
      const existing = await listBatches(year, week, custKey);
      const batchNo = nextBatchNo(existing);
      const ins = await query(
        `INSERT INTO WebHotelMiuIntakeBatch (OrderYear, OrderWeek, CustKey, BatchNo, Status, SourceNote, CreatedBy, UpdatedBy)
         OUTPUT INSERTED.BatchKey
         VALUES (@yr,@wk,@ck,@no,@st,@note,@by,@by)`,
        {
          yr: { type: sql.NVarChar, value: year },
          wk: { type: sql.NVarChar, value: week },
          ck: { type: sql.Int, value: custKey },
          no: { type: sql.Int, value: batchNo },
          st: { type: sql.NVarChar, value: status },
          note: { type: sql.NVarChar, value: text(req.body?.sourceNote, `${batchNo}합산`) },
          by: { type: sql.NVarChar, value: actor },
        }
      );
      const batchKey = ins.recordset[0].BatchKey;
      for (let i = 0; i < lines.length; i += 1) {
        const ln = lines[i];
        await query(
          `INSERT INTO WebHotelMiuIntakeLine (BatchKey, RawName, Unit, Qty, ProdKey, ProdName, SourceType, SortOrder)
           VALUES (@bk,@nm,@un,@qty,@pk,@pn,@st,@ord)`,
          {
            bk: { type: sql.Int, value: batchKey },
            nm: { type: sql.NVarChar, value: text(ln.inputName) },
            un: { type: sql.NVarChar, value: text(ln.unit) },
            qty: { type: sql.Float, value: Number(ln.qty || 0) },
            pk: { type: sql.Int, value: ln.prodKey ? Number(ln.prodKey) : null },
            pn: { type: sql.NVarChar, value: text(ln.prodName) },
            st: { type: sql.NVarChar, value: text(ln.sourceType, 'text') },
            ord: { type: sql.Int, value: i },
          }
        );
      }
      return res.status(200).json({
        success: true,
        batchKey,
        batchNo,
        status,
        batches: await listBatches(year, week, custKey),
      });
    }

    if (action === 'markRegistered') {
      const year = text(req.body?.year);
      const week = text(req.body?.week);
      const custKey = Number(req.body?.custKey);
      const keys = (Array.isArray(req.body?.batchKeys) ? req.body.batchKeys : [])
        .map((k) => Number(k)).filter(Boolean);
      if (!year || !week || !custKey || !keys.length) {
        return res.status(400).json({ success: false, error: 'year, week, custKey, batchKeys 필요' });
      }
      for (const batchKey of keys) {
        await query(
          `UPDATE WebHotelMiuIntakeBatch
              SET Status=@st, UpdatedAt=GETDATE(), UpdatedBy=@by
            WHERE BatchKey=@bk AND OrderYear=@yr AND OrderWeek=@wk AND CustKey=@ck
              AND isDeleted=0 AND Status=@draft`,
          {
            st: { type: sql.NVarChar, value: HOTEL_MIU_BATCH_REGISTERED },
            draft: { type: sql.NVarChar, value: HOTEL_MIU_BATCH_DRAFT },
            by: { type: sql.NVarChar, value: actor },
            bk: { type: sql.Int, value: batchKey },
            yr: { type: sql.NVarChar, value: year },
            wk: { type: sql.NVarChar, value: week },
            ck: { type: sql.Int, value: custKey },
          }
        );
      }
      return res.status(200).json({ success: true, batches: await listBatches(year, week, custKey) });
    }

    return res.status(400).json({ success: false, error: '알 수 없는 action' });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});
