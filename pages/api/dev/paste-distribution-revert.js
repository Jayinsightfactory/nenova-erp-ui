import { withAuth } from '../../../lib/auth';
import { query, withTransaction, sql } from '../../../lib/db';

function toInt(value, fallback = null) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function toFloat(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function sameQty(a, b) {
  return Math.abs(toFloat(a) - toFloat(b)) < 0.001;
}

function shipmentUnits(outQty, b1b, s1b) {
  const qty = toFloat(outQty);
  const bunchOf1Box = toFloat(b1b);
  const steamOf1Box = toFloat(s1b);
  return {
    box: qty,
    bunch: bunchOf1Box > 0 ? qty * bunchOf1Box : 0,
    steam: steamOf1Box > 0 ? qty * steamOf1Box : 0,
  };
}

function estimateQty(units) {
  if (toFloat(units.bunch) > 0) return toFloat(units.bunch);
  if (toFloat(units.steam) > 0) return toFloat(units.steam);
  return toFloat(units.box);
}

function amountFrom(estQty, cost) {
  const base = toFloat(estQty) * toFloat(cost);
  return {
    amount: Math.round(base / 1.1),
    vat: Math.round(base / 11),
  };
}

function normalizeWeek(value) {
  const v = String(value || '').trim();
  const m = v.match(/^\d{4}-(\d{2}-\d{2})$/);
  return m ? m[1] : v;
}

async function loadCandidates(q, source = {}) {
  const limit = Math.min(toInt(source.limit, 50) || 50, 200);
  const minutes = Math.min(toInt(source.minutes, 360) || 360, 1440);
  const week = normalizeWeek(source.week || '');
  const custKey = toInt(source.custKey, null);
  const prodKey = toInt(source.prodKey, null);
  const adjKeys = Array.isArray(source.adjKeys)
    ? source.adjKeys.map(x => toInt(x, null)).filter(Boolean)
    : [];

  const params = {
    limit: { type: sql.Int, value: limit },
    minutes: { type: sql.Int, value: minutes },
    week: { type: sql.NVarChar, value: week },
    custKey: { type: sql.Int, value: custKey },
    prodKey: { type: sql.Int, value: prodKey },
  };

  const where = [
    `(a.Memo LIKE N'%붙여넣기%' OR a.Memo LIKE N'%paste%')`,
    `a.CreateDtm >= DATEADD(MINUTE, -@minutes, GETDATE())`,
    `(@week = N'' OR a.OrderWeek = @week OR a.OrderYear + N'-' + a.OrderWeek = @week)`,
    `(@custKey IS NULL OR a.CustKey = @custKey)`,
    `(@prodKey IS NULL OR a.ProdKey = @prodKey)`,
  ];

  if (adjKeys.length > 0) {
    adjKeys.forEach((key, idx) => {
      params[`adj${idx}`] = { type: sql.Int, value: key };
    });
    where.push(`a.AdjKey IN (${adjKeys.map((_, idx) => `@adj${idx}`).join(',')})`);
  }

  const result = await q(
    `SELECT TOP (@limit)
       a.AdjKey,
       a.OrderYear,
       a.OrderWeek,
       a.ProdKey,
       p.ProdName,
       p.DisplayName,
       p.CounName,
       p.FlowerName,
       ISNULL(p.BunchOf1Box,0) AS BunchOf1Box,
       ISNULL(p.SteamOf1Box,0) AS SteamOf1Box,
       ISNULL(p.Cost,0) AS ProductCost,
       a.CustKey,
       c.CustName,
       a.AdjType,
       CONVERT(FLOAT, a.QtyDelta) AS QtyDelta,
       CONVERT(FLOAT, a.QtyBefore) AS QtyBefore,
       CONVERT(FLOAT, a.QtyAfter) AS QtyAfter,
       CONVERT(FLOAT, a.OrderQtyBefore) AS OrderQtyBefore,
       CONVERT(FLOAT, a.OrderQtyAfter) AS OrderQtyAfter,
       ISNULL(a.Memo,N'') AS Memo,
       ISNULL(a.CreateID,N'') AS CreateID,
       CONVERT(NVARCHAR(19), a.CreateDtm, 120) AS CreateDtm,
       ship.ShipmentKey,
       ship.SdetailKey,
       ISNULL(ship.MasterFix,0) AS MasterFix,
       ISNULL(ship.DetailFix,0) AS DetailFix,
       ISNULL(ship.CurrentOutQty,0) AS CurrentOutQty,
       ISNULL(ship.DetailCost,0) AS DetailCost,
       ISNULL(cpc.Cost,0) AS CustomerCost,
       CASE WHEN ship.SdetailKey IS NOT NULL
              AND ISNULL(ship.MasterFix,0)=0
              AND ISNULL(ship.DetailFix,0)=0
              AND ABS(ISNULL(ship.CurrentOutQty,0) - CONVERT(FLOAT, a.QtyAfter)) < 0.001
            THEN 1 ELSE 0 END AS SafeToApply
     FROM ShipmentAdjustment a
     JOIN Product p ON p.ProdKey = a.ProdKey
     JOIN Customer c ON c.CustKey = a.CustKey
     LEFT JOIN CustomerProdCost cpc ON cpc.CustKey = a.CustKey AND cpc.ProdKey = a.ProdKey
     OUTER APPLY (
       SELECT TOP 1
              sm.ShipmentKey,
              sd.SdetailKey,
              ISNULL(sm.isFix,0) AS MasterFix,
              ISNULL(sd.isFix,0) AS DetailFix,
              ISNULL(sd.OutQuantity,0) AS CurrentOutQty,
              ISNULL(sd.Cost,0) AS DetailCost
         FROM ShipmentMaster sm
         JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
        WHERE sm.CustKey = a.CustKey
          AND sm.OrderWeek = a.OrderWeek
          AND ISNULL(sm.isDeleted,0) = 0
          AND sd.ProdKey = a.ProdKey
        ORDER BY ABS(ISNULL(sd.OutQuantity,0) - CONVERT(FLOAT, a.QtyAfter)), sd.SdetailKey DESC
     ) ship
     WHERE ${where.join(' AND ')}
     ORDER BY a.CreateDtm DESC, a.AdjKey DESC`,
    params
  );

  return result.recordset || [];
}

async function appLog(step, detail, isError = false) {
  try {
    await query(
      `INSERT INTO AppLog (Category, Step, Detail, IsError)
       VALUES (N'pasteDistributionRevert', @step, @detail, @err)`,
      {
        step: { type: sql.NVarChar, value: String(step || '').slice(0, 100) },
        detail: { type: sql.NVarChar, value: String(detail || '').slice(0, 1000) },
        err: { type: sql.Bit, value: isError ? 1 : 0 },
      }
    );
  } catch {}
}

async function handler(req, res) {
  if (req.method === 'GET') {
    const rows = await loadCandidates(query, req.query || {});
    return res.status(200).json({ success: true, count: rows.length, rows });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  const source = req.body || {};
  const confirm = String(source.confirm || '').trim();
  const adjKeys = Array.isArray(source.adjKeys)
    ? source.adjKeys.map(x => toInt(x, null)).filter(Boolean)
    : [];

  if (confirm !== 'DELETE_PASTE_DISTRIBUTION') {
    return res.status(400).json({ success: false, error: 'confirm=DELETE_PASTE_DISTRIBUTION required' });
  }
  if (adjKeys.length === 0) {
    return res.status(400).json({ success: false, error: 'adjKeys required' });
  }

  const uid = req.user?.userId || 'admin';

  try {
    const result = await withTransaction(async (tQ) => {
      const candidates = await loadCandidates(tQ, { ...source, adjKeys, limit: Math.max(adjKeys.length, 50) });
      const applied = [];
      const skipped = [];

      for (const row of candidates) {
        if (!Number(row.SafeToApply)) {
          skipped.push({ ...row, reason: 'not_safe_to_apply' });
          continue;
        }

        const beforeQty = toFloat(row.QtyBefore);
        const afterQty = toFloat(row.QtyAfter);
        const currentQty = toFloat(row.CurrentOutQty);
        if (!sameQty(currentQty, afterQty)) {
          skipped.push({ ...row, reason: 'current_qty_changed' });
          continue;
        }

        const sdetailKey = Number(row.SdetailKey);
        if (!(sdetailKey > 0)) {
          skipped.push({ ...row, reason: 'missing_shipment_detail' });
          continue;
        }

        if (beforeQty <= 0) {
          await tQ(`DELETE FROM ShipmentDate WHERE SdetailKey=@dk`, {
            dk: { type: sql.Int, value: sdetailKey },
          });
          await tQ(`DELETE FROM ShipmentHistory WHERE SdetailKey=@dk`, {
            dk: { type: sql.Int, value: sdetailKey },
          });
          await tQ(`DELETE FROM ShipmentDetail WHERE SdetailKey=@dk`, {
            dk: { type: sql.Int, value: sdetailKey },
          });
          await tQ(`DELETE FROM ShipmentAdjustment WHERE AdjKey=@adjKey`, {
            adjKey: { type: sql.Int, value: Number(row.AdjKey) },
          });
          applied.push({ ...row, action: 'deleted_shipment_detail', revertedTo: 0 });
          continue;
        }

        const units = shipmentUnits(beforeQty, row.BunchOf1Box, row.SteamOf1Box);
        const estQty = estimateQty(units);
        const cost = toFloat(row.DetailCost) || toFloat(row.CustomerCost) || toFloat(row.ProductCost);
        const { amount, vat } = amountFrom(estQty, cost);

        await tQ(
          `UPDATE ShipmentDetail
              SET OutQuantity=@outQty,
                  EstQuantity=@estQty,
                  BoxQuantity=@box,
                  BunchQuantity=@bunch,
                  SteamQuantity=@steam,
                  Cost=@cost,
                  Amount=@amount,
                  Vat=@vat
            WHERE SdetailKey=@dk`,
          {
            dk: { type: sql.Int, value: sdetailKey },
            outQty: { type: sql.Float, value: beforeQty },
            estQty: { type: sql.Float, value: estQty },
            box: { type: sql.Float, value: units.box },
            bunch: { type: sql.Float, value: units.bunch },
            steam: { type: sql.Float, value: units.steam },
            cost: { type: sql.Float, value: cost },
            amount: { type: sql.Float, value: amount },
            vat: { type: sql.Float, value: vat },
          }
        );
        await tQ(`DELETE FROM ShipmentDate WHERE SdetailKey=@dk`, {
          dk: { type: sql.Int, value: sdetailKey },
        });
        await tQ(
          `INSERT INTO ShipmentDate (SdetailKey, ShipmentDtm, ShipmentQuantity, EstQuantity, Cost, Amount, Vat)
           SELECT @dk, ShipmentDtm, @outQty, @estQty, @cost, @amount, @vat
             FROM ShipmentDetail
            WHERE SdetailKey=@dk`,
          {
            dk: { type: sql.Int, value: sdetailKey },
            outQty: { type: sql.Float, value: beforeQty },
            estQty: { type: sql.Float, value: estQty },
            cost: { type: sql.Float, value: cost },
            amount: { type: sql.Float, value: amount },
            vat: { type: sql.Float, value: vat },
          }
        );
        await tQ(
          `DELETE FROM ShipmentHistory
            WHERE SdetailKey=@dk
              AND ISNULL(ChangeID,N'')=@createID
              AND ISNULL(ColumName,N'')=N'OutQuantity'
              AND ISNULL(BeforeValue,N'')=@beforeValue
              AND ISNULL(AfterValue,N'')=@afterValue`,
          {
            dk: { type: sql.Int, value: sdetailKey },
            createID: { type: sql.NVarChar, value: row.CreateID || uid },
            beforeValue: { type: sql.NVarChar, value: String(beforeQty) },
            afterValue: { type: sql.NVarChar, value: String(afterQty) },
          }
        );
        await tQ(`DELETE FROM ShipmentAdjustment WHERE AdjKey=@adjKey`, {
          adjKey: { type: sql.Int, value: Number(row.AdjKey) },
        });
        applied.push({ ...row, action: 'restored_shipment_detail', revertedTo: beforeQty });
      }

      return { candidates, applied, skipped };
    });

    await appLog('applied', `uid=${uid} adjKeys=${adjKeys.join(',')} applied=${result.applied.length} skipped=${result.skipped.length}`, result.skipped.length > 0);

    return res.status(200).json({
      success: true,
      requestedAdjKeys: adjKeys,
      appliedCount: result.applied.length,
      skippedCount: result.skipped.length,
      applied: result.applied,
      skipped: result.skipped,
    });
  } catch (err) {
    await appLog('error', err.message, true);
    return res.status(500).json({ success: false, error: err.message });
  }
}

export default withAuth(handler);
