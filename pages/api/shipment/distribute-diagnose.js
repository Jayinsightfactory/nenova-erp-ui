// pages/api/shipment/distribute-diagnose.js - compatibility checks for Nenova.exe distribute buttons
import { withAuth } from '../../../lib/auth';
import { query, withTransaction, sql } from '../../../lib/db';
import { normalizeOrderWeek } from '../../../lib/orderUtils';

function formatDateOnly(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function addDays(date, days) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

function calcBaseOutDate(week, year, baseDay) {
  const weekNum = parseInt(String(week || '').split('-')[0], 10);
  const yr = parseInt(year, 10) || new Date().getFullYear();
  if (!weekNum) return null;
  const start = new Date(yr, 0, (weekNum - 1) * 7 + 1, 12, 0, 0, 0);
  const daysBackToWednesday = (start.getDay() - 3 + 7) % 7;
  start.setDate(start.getDate() - daysBackToWednesday);
  const offsets = [0, 4, 5, 6, 1, 3, 2];
  start.setDate(start.getDate() + (offsets[Number(baseDay)] ?? 0));
  return start;
}

function buildBaseDateMap(week, year) {
  return [0, 1, 2, 3, 4, 5, 6].map(baseDay => {
    const expected = calcBaseOutDate(week, year, baseDay);
    return {
      baseDay,
      expected: formatDateOnly(expected),
      wrongPlus6: formatDateOnly(addDays(expected, 6)),
    };
  });
}

function baseDateValuesSql(dateMap) {
  return dateMap.map((_, i) => `(@bd${i}, CONVERT(date, @exp${i}), CONVERT(date, @wrong${i}))`).join(',');
}

function baseDateParams(dateMap) {
  const params = {};
  dateMap.forEach((row, i) => {
    params[`bd${i}`] = { type: sql.Int, value: row.baseDay };
    params[`exp${i}`] = { type: sql.NVarChar, value: row.expected };
    params[`wrong${i}`] = { type: sql.NVarChar, value: row.wrongPlus6 };
  });
  return params;
}

async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const rawWeek = req.query.week || req.body?.week || '';
  const week = normalizeOrderWeek(rawWeek || '');
  if (!week) return res.status(400).json({ success: false, error: 'week is required' });
  const orderYear = String(req.query.year || req.body?.year || (String(rawWeek).match(/^(\d{4})-/)?.[1]) || new Date().getFullYear());
  const dateMap = buildBaseDateMap(week, orderYear);
  const dateMapSql = baseDateValuesSql(dateMap);
  const dateParams = baseDateParams(dateMap);

  try {
    if (req.method === 'POST') {
      const action = String(req.body?.action || '').trim();
      if (!['repairMissingCustKey', 'repairShipmentDateBaseOutDay'].includes(action)) {
        return res.status(400).json({ success: false, error: '지원하지 않는 action 입니다.' });
      }

      if (action === 'repairShipmentDateBaseOutDay') {
        const repaired = await withTransaction(async (tQ) => {
          const fixed = await tQ(
            `SELECT TOP 1 1 AS fixed
               FROM ShipmentMaster
              WHERE OrderWeek=@wk AND ISNULL(isDeleted,0)=0 AND ISNULL(isFix,0)=1`,
            { wk: { type: sql.NVarChar, value: week } }
          );
          if (fixed.recordset.length) throw new Error('확정된 차수는 출고일을 보정할 수 없습니다. 확정취소 후 다시 진행하세요.');

          const before = await tQ(
            `WITH date_map(BaseOutDay, ExpectedDate, WrongDate) AS (
               SELECT * FROM (VALUES ${dateMapSql}) v(BaseOutDay, ExpectedDate, WrongDate)
             )
             SELECT COUNT(*) AS cnt
               FROM ShipmentMaster sm
               JOIN Customer c ON c.CustKey=sm.CustKey
               JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
               JOIN date_map dm ON dm.BaseOutDay=ISNULL(c.BaseOutDay,0)
              WHERE sm.OrderWeek=@wk AND ISNULL(sm.isDeleted,0)=0
                AND ISNULL(sd.OutQuantity,0) <> 0
                AND CONVERT(date, sd.ShipmentDtm)=dm.WrongDate
                AND (ISNULL(sd.Descr,N'') LIKE N'%엑셀업로드%' OR ISNULL(sm.WebCreated,0)=1)`,
            { wk: { type: sql.NVarChar, value: week }, ...dateParams }
          );

          const sample = await tQ(
            `WITH date_map(BaseOutDay, ExpectedDate, WrongDate) AS (
               SELECT * FROM (VALUES ${dateMapSql}) v(BaseOutDay, ExpectedDate, WrongDate)
             )
             SELECT TOP 100 sm.ShipmentKey, sd.SdetailKey, c.CustName, c.BaseOutDay,
                    p.ProdName, sd.OutQuantity,
                    CONVERT(NVARCHAR(10), sd.ShipmentDtm, 120) AS BeforeDate,
                    CONVERT(NVARCHAR(10), dm.ExpectedDate, 120) AS AfterDate
               FROM ShipmentMaster sm
               JOIN Customer c ON c.CustKey=sm.CustKey
               JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
               JOIN Product p ON p.ProdKey=sd.ProdKey
               JOIN date_map dm ON dm.BaseOutDay=ISNULL(c.BaseOutDay,0)
              WHERE sm.OrderWeek=@wk AND ISNULL(sm.isDeleted,0)=0
                AND ISNULL(sd.OutQuantity,0) <> 0
                AND CONVERT(date, sd.ShipmentDtm)=dm.WrongDate
                AND (ISNULL(sd.Descr,N'') LIKE N'%엑셀업로드%' OR ISNULL(sm.WebCreated,0)=1)
              ORDER BY c.CustArea, c.CustName, p.ProdName`,
            { wk: { type: sql.NVarChar, value: week }, ...dateParams }
          );

          const log = `\n엑셀업로드 출고일보정`;
          const detailUpdate = await tQ(
            `WITH date_map(BaseOutDay, ExpectedDate, WrongDate) AS (
               SELECT * FROM (VALUES ${dateMapSql}) v(BaseOutDay, ExpectedDate, WrongDate)
             )
             UPDATE sd
                SET sd.ShipmentDtm=dm.ExpectedDate,
                    sd.Descr=ISNULL(sd.Descr,N'') + @log
               FROM ShipmentDetail sd WITH (UPDLOCK, ROWLOCK)
               JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey
               JOIN Customer c ON c.CustKey=sm.CustKey
               JOIN date_map dm ON dm.BaseOutDay=ISNULL(c.BaseOutDay,0)
              WHERE sm.OrderWeek=@wk AND ISNULL(sm.isDeleted,0)=0
                AND ISNULL(sd.OutQuantity,0) <> 0
                AND CONVERT(date, sd.ShipmentDtm)=dm.WrongDate
                AND (ISNULL(sd.Descr,N'') LIKE N'%엑셀업로드%' OR ISNULL(sm.WebCreated,0)=1)`,
            { wk: { type: sql.NVarChar, value: week }, log: { type: sql.NVarChar, value: log }, ...dateParams }
          );

          const dateUpdate = await tQ(
            `WITH date_map(BaseOutDay, ExpectedDate, WrongDate) AS (
               SELECT * FROM (VALUES ${dateMapSql}) v(BaseOutDay, ExpectedDate, WrongDate)
             )
             UPDATE sdt
                SET sdt.ShipmentDtm=dm.ExpectedDate
               FROM ShipmentDate sdt WITH (UPDLOCK, ROWLOCK)
               JOIN ShipmentDetail sd ON sd.SdetailKey=sdt.SdetailKey
               JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey
               JOIN Customer c ON c.CustKey=sm.CustKey
               JOIN date_map dm ON dm.BaseOutDay=ISNULL(c.BaseOutDay,0)
              WHERE sm.OrderWeek=@wk AND ISNULL(sm.isDeleted,0)=0
                AND ISNULL(sd.OutQuantity,0) <> 0
                AND CONVERT(date, sdt.ShipmentDtm)=dm.WrongDate
                AND (ISNULL(sd.Descr,N'') LIKE N'%엑셀업로드%' OR ISNULL(sm.WebCreated,0)=1)`,
            { wk: { type: sql.NVarChar, value: week }, ...dateParams }
          );

          const after = await tQ(
            `WITH date_map(BaseOutDay, ExpectedDate, WrongDate) AS (
               SELECT * FROM (VALUES ${dateMapSql}) v(BaseOutDay, ExpectedDate, WrongDate)
             )
             SELECT COUNT(*) AS cnt
               FROM ShipmentMaster sm
               JOIN Customer c ON c.CustKey=sm.CustKey
               JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
               JOIN date_map dm ON dm.BaseOutDay=ISNULL(c.BaseOutDay,0)
              WHERE sm.OrderWeek=@wk AND ISNULL(sm.isDeleted,0)=0
                AND ISNULL(sd.OutQuantity,0) <> 0
                AND CONVERT(date, sd.ShipmentDtm)=dm.WrongDate
                AND (ISNULL(sd.Descr,N'') LIKE N'%엑셀업로드%' OR ISNULL(sm.WebCreated,0)=1)`,
            { wk: { type: sql.NVarChar, value: week }, ...dateParams }
          );

          return {
            before: Number(before.recordset[0]?.cnt || 0),
            detailUpdated: Number(detailUpdate.rowsAffected?.[0] || 0),
            dateUpdated: Number(dateUpdate.rowsAffected?.[0] || 0),
            after: Number(after.recordset[0]?.cnt || 0),
            sample: sample.recordset,
          };
        }, { retries: 5, baseDelay: 200 });

        return res.status(200).json({
          success: true,
          week,
          orderYear,
          action,
          message: `엑셀업로드 출고일 ${repaired.detailUpdated}건을 업체 기본 출고일 기준으로 보정했습니다.`,
          ...repaired,
        });
      }

      const repaired = await withTransaction(async (tQ) => {
        const before = await tQ(
          `SELECT COUNT(*) AS cnt
             FROM ShipmentMaster sm
             JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
            WHERE sm.OrderWeek=@wk AND ISNULL(sm.isDeleted,0)=0
              AND ISNULL(sd.OutQuantity,0) <> 0
              AND (sd.CustKey IS NULL OR sd.CustKey=0 OR sd.CustKey<>sm.CustKey)`,
          { wk: { type: sql.NVarChar, value: week } }
        );

        const sample = await tQ(
          `SELECT TOP 50 sm.ShipmentKey, sd.SdetailKey, sm.CustKey AS MasterCustKey,
                  sd.CustKey AS DetailCustKey, sd.ProdKey, p.ProdName, sd.OutQuantity
             FROM ShipmentMaster sm
             JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
             LEFT JOIN Product p ON p.ProdKey=sd.ProdKey
            WHERE sm.OrderWeek=@wk AND ISNULL(sm.isDeleted,0)=0
              AND ISNULL(sd.OutQuantity,0) <> 0
              AND (sd.CustKey IS NULL OR sd.CustKey=0 OR sd.CustKey<>sm.CustKey)
            ORDER BY sm.CustKey, sd.ProdKey`,
          { wk: { type: sql.NVarChar, value: week } }
        );

        const updateResult = await tQ(
          `UPDATE sd
              SET sd.CustKey = sm.CustKey
             FROM ShipmentDetail sd WITH (UPDLOCK, ROWLOCK)
             JOIN ShipmentMaster sm ON sd.ShipmentKey=sm.ShipmentKey
            WHERE sm.OrderWeek=@wk AND ISNULL(sm.isDeleted,0)=0
              AND ISNULL(sd.OutQuantity,0) <> 0
              AND (sd.CustKey IS NULL OR sd.CustKey=0 OR sd.CustKey<>sm.CustKey)`,
          { wk: { type: sql.NVarChar, value: week } }
        );

        const after = await tQ(
          `SELECT COUNT(*) AS cnt
             FROM ShipmentMaster sm
             JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
            WHERE sm.OrderWeek=@wk AND ISNULL(sm.isDeleted,0)=0
              AND ISNULL(sd.OutQuantity,0) <> 0
              AND (sd.CustKey IS NULL OR sd.CustKey=0 OR sd.CustKey<>sm.CustKey)`,
          { wk: { type: sql.NVarChar, value: week } }
        );

        return {
          before: Number(before.recordset[0]?.cnt || 0),
          updated: Number(updateResult.rowsAffected?.[0] || 0),
          after: Number(after.recordset[0]?.cnt || 0),
          sample: sample.recordset,
        };
      }, { retries: 5, baseDelay: 200 });

      return res.status(200).json({
        success: true,
        week,
        action,
        message: `출고상세 업체키 ${repaired.updated}건을 주문 업체 기준으로 정리했습니다.`,
        ...repaired,
      });
    }

    const duplicateMasters = await query(
      `SELECT CustKey, OrderWeek, COUNT(*) AS masterCount,
              MIN(ShipmentKey) AS minShipmentKey,
              MAX(ShipmentKey) AS maxShipmentKey
         FROM ShipmentMaster
        WHERE OrderWeek=@wk AND ISNULL(isDeleted,0)=0
        GROUP BY CustKey, OrderWeek
       HAVING COUNT(*) > 1
        ORDER BY CustKey`,
      { wk: { type: sql.NVarChar, value: week } }
    );

    const missingCustKey = await query(
      `SELECT TOP 200 sm.ShipmentKey, sd.SdetailKey, sm.CustKey AS MasterCustKey,
              sd.CustKey AS DetailCustKey, sd.ProdKey, p.ProdName, sd.OutQuantity
         FROM ShipmentMaster sm
         JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
         LEFT JOIN Product p ON p.ProdKey=sd.ProdKey
        WHERE sm.OrderWeek=@wk AND ISNULL(sm.isDeleted,0)=0
          AND ISNULL(sd.OutQuantity,0) <> 0
          AND (sd.CustKey IS NULL OR sd.CustKey=0 OR sd.CustKey<>sm.CustKey)
        ORDER BY sm.CustKey, sd.ProdKey`,
      { wk: { type: sql.NVarChar, value: week } }
    );

    const shipmentDateMismatch = await query(
      `SELECT TOP 200 sm.ShipmentKey, sd.SdetailKey, sm.CustKey, sd.ProdKey, p.ProdName,
              sd.OutQuantity,
              ISNULL(SUM(sdt.ShipmentQuantity),0) AS ShipmentDateQty,
              CONVERT(NVARCHAR(10), sd.ShipmentDtm, 120) AS ShipmentDtm,
              MIN(CONVERT(NVARCHAR(10), sdt.ShipmentDtm, 120)) AS ShipmentDateDtm,
              SUM(CASE WHEN sdt.ShipmentDtm IS NULL
                         OR sd.ShipmentDtm IS NULL
                         OR CONVERT(date, sdt.ShipmentDtm) <> CONVERT(date, sd.ShipmentDtm)
                       THEN 1 ELSE 0 END) AS DateMismatchCount
         FROM ShipmentMaster sm
         JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
         LEFT JOIN ShipmentDate sdt ON sdt.SdetailKey=sd.SdetailKey
         LEFT JOIN Product p ON p.ProdKey=sd.ProdKey
        WHERE sm.OrderWeek=@wk AND ISNULL(sm.isDeleted,0)=0
          AND ISNULL(sd.OutQuantity,0) <> 0
        GROUP BY sm.ShipmentKey, sd.SdetailKey, sm.CustKey, sd.ProdKey, p.ProdName,
                 sd.OutQuantity, sd.ShipmentDtm
       HAVING ISNULL(SUM(sdt.ShipmentQuantity),0) <> ISNULL(sd.OutQuantity,0)
           OR sd.ShipmentDtm IS NULL
           OR SUM(CASE WHEN sdt.ShipmentDtm IS NULL
                         OR sd.ShipmentDtm IS NULL
                         OR CONVERT(date, sdt.ShipmentDtm) <> CONVERT(date, sd.ShipmentDtm)
                       THEN 1 ELSE 0 END) > 0
        ORDER BY sm.CustKey, sd.ProdKey`,
      { wk: { type: sql.NVarChar, value: week } }
    );

    const shipmentDateBaseMismatch = await query(
      `WITH date_map(BaseOutDay, ExpectedDate, WrongDate) AS (
         SELECT * FROM (VALUES ${dateMapSql}) v(BaseOutDay, ExpectedDate, WrongDate)
       )
       SELECT TOP 200 sm.ShipmentKey, sd.SdetailKey, sm.CustKey, c.CustName, c.BaseOutDay,
              sd.ProdKey, p.ProdName, sd.OutQuantity,
              CONVERT(NVARCHAR(10), sd.ShipmentDtm, 120) AS ShipmentDtm,
              CONVERT(NVARCHAR(10), dm.ExpectedDate, 120) AS ExpectedDtm
         FROM ShipmentMaster sm
         JOIN Customer c ON c.CustKey=sm.CustKey
         JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
         JOIN Product p ON p.ProdKey=sd.ProdKey
         JOIN date_map dm ON dm.BaseOutDay=ISNULL(c.BaseOutDay,0)
        WHERE sm.OrderWeek=@wk AND ISNULL(sm.isDeleted,0)=0
          AND ISNULL(sd.OutQuantity,0) <> 0
          AND CONVERT(date, sd.ShipmentDtm)=dm.WrongDate
          AND (ISNULL(sd.Descr,N'') LIKE N'%엑셀업로드%' OR ISNULL(sm.WebCreated,0)=1)
        ORDER BY c.CustArea, c.CustName, p.ProdName`,
      { wk: { type: sql.NVarChar, value: week }, ...dateParams }
    );

    const estMismatch = await query(
      `SELECT TOP 200 sm.ShipmentKey, sd.SdetailKey, sm.CustKey, sd.ProdKey, p.ProdName,
              sd.OutQuantity, sd.EstQuantity
         FROM ShipmentMaster sm
         JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
         LEFT JOIN Product p ON p.ProdKey=sd.ProdKey
        WHERE sm.OrderWeek=@wk AND ISNULL(sm.isDeleted,0)=0
          AND ISNULL(sd.OutQuantity,0) <> ISNULL(sd.EstQuantity,0)
        ORDER BY sm.CustKey, sd.ProdKey`,
      { wk: { type: sql.NVarChar, value: week } }
    );

    const keyNumbering = await query(
      `SELECT v.Category,
              ISNULL(kn.LastKeyNo,0) AS LastKeyNo,
              v.ActualMaxKey,
              CASE WHEN ISNULL(kn.LastKeyNo,0) < v.ActualMaxKey THEN 1 ELSE 0 END AS NeedsSync,
              CASE WHEN ISNULL(kn.LastKeyNo,0) < v.ActualMaxKey
                   THEN v.ActualMaxKey - ISNULL(kn.LastKeyNo,0)
                   ELSE 0 END AS Gap
         FROM (
           SELECT N'ShipmentMasterKey' AS Category, ISNULL(MAX(ShipmentKey),0) AS ActualMaxKey FROM ShipmentMaster
           UNION ALL
           SELECT N'ShipmentDetailKey' AS Category, ISNULL(MAX(SdetailKey),0) AS ActualMaxKey FROM ShipmentDetail
           UNION ALL
           SELECT N'OrderMasterKey' AS Category, ISNULL(MAX(OrderMasterKey),0) AS ActualMaxKey FROM OrderMaster
           UNION ALL
           SELECT N'OrderDetailKey' AS Category, ISNULL(MAX(OrderDetailKey),0) AS ActualMaxKey FROM OrderDetail
         ) v
         LEFT JOIN KeyNumbering kn ON kn.Category = v.Category
        ORDER BY v.Category`
    );

    const procedures = await query(
      `SELECT v.ProcedureName,
              CASE WHEN OBJECT_ID(N'dbo.' + v.ProcedureName, N'P') IS NULL THEN 0 ELSE 1 END AS ExistsInDb
         FROM (VALUES
           (N'usp_DistributeTotal'),
           (N'usp_DistributeOne'),
           (N'usp_DistributeClear'),
           (N'usp_ShipmentFix'),
           (N'usp_ShipmentFixCancel'),
           (N'usp_StockCalculation')
         ) v(ProcedureName)
        ORDER BY v.ProcedureName`
    );

    const keyNeedsSync = keyNumbering.recordset.filter(r => Number(r.NeedsSync) === 1);

    return res.status(200).json({
      success: true,
      week,
      summary: {
        duplicateMasters: duplicateMasters.recordset.length,
        missingCustKey: missingCustKey.recordset.length,
        shipmentDateMismatch: shipmentDateMismatch.recordset.length,
        shipmentDateBaseMismatch: shipmentDateBaseMismatch.recordset.length,
        estMismatch: estMismatch.recordset.length,
        keyNumberingNeedsSync: keyNeedsSync.length,
        missingProcedures: procedures.recordset.filter(r => Number(r.ExistsInDb) !== 1).length,
      },
      duplicateMasters: duplicateMasters.recordset,
      missingCustKey: missingCustKey.recordset,
      shipmentDateMismatch: shipmentDateMismatch.recordset,
      shipmentDateBaseMismatch: shipmentDateBaseMismatch.recordset,
      estMismatch: estMismatch.recordset,
      keyNumbering: keyNumbering.recordset,
      procedures: procedures.recordset,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

export default withAuth(handler);
