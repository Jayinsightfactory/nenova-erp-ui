/**
 * 견적 인쇄 비고 정리 — nenova.exe FormPrintEstimate 는 ShipmentDate.Descr / Estimate.Descr 를 그대로 출력.
 * GET  ?week=25-01&cust=미카엘  — 대상 행 미리보기
 * POST { week, cust, apply:true } — 운영 로그 제거 (ShipmentHistory 보존)
 */
import { query, withTransaction, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { sanitizeDescrTextForPrint } from '../../../lib/estimateInvariants.js';

function toInt(value, fallback = 500) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 2000) : fallback;
}

function needsCleanup(descr) {
  const raw = String(descr || '').trim();
  if (!raw) return false;
  return sanitizeDescrTextForPrint(raw) !== raw;
}

async function loadTargets({ week, cust, shipmentKey, limit }) {
  const params = { limit: { type: sql.Int, value: limit } };
  const where = ['ISNULL(sm.isDeleted,0)=0'];
  if (week) {
    where.push('sm.OrderWeek LIKE @week');
    params.week = { type: sql.NVarChar, value: week.includes('%') ? week : `${week}%` };
  }
  if (cust) {
    where.push('c.CustName LIKE @cust');
    params.cust = { type: sql.NVarChar, value: cust.includes('%') ? cust : `%${cust}%` };
  }
  if (shipmentKey) {
    where.push('sm.ShipmentKey = @sk');
    params.sk = { type: sql.Int, value: parseInt(shipmentKey, 10) };
  }

  const detailRows = await query(
    `SELECT TOP (@limit)
            sd.SdetailKey, sm.ShipmentKey, sm.OrderWeek, c.CustName, p.ProdName,
            ISNULL(sd.Descr,'') AS Descr, N'ShipmentDetail' AS Source
       FROM ShipmentDetail sd
       JOIN ShipmentMaster sm ON sm.ShipmentKey = sd.ShipmentKey
       JOIN Customer c ON c.CustKey = sm.CustKey
       JOIN Product p ON p.ProdKey = sd.ProdKey
      WHERE ${where.join(' AND ')}
        AND ISNULL(sd.Descr,'') <> ''
      ORDER BY sm.OrderWeek, c.CustName, p.ProdName`,
    params
  );

  const dateRows = await query(
    `SELECT TOP (@limit)
            sdt.SdateKey, sd.SdetailKey, sm.ShipmentKey, sm.OrderWeek, c.CustName, p.ProdName,
            ISNULL(sdt.Descr,'') AS Descr, N'ShipmentDate' AS Source
       FROM ShipmentDate sdt
       JOIN ShipmentDetail sd ON sd.SdetailKey = sdt.SdetailKey
       JOIN ShipmentMaster sm ON sm.ShipmentKey = sd.ShipmentKey
       JOIN Customer c ON c.CustKey = sm.CustKey
       JOIN Product p ON p.ProdKey = sd.ProdKey
      WHERE ${where.join(' AND ')}
        AND ISNULL(sdt.Descr,'') <> ''
      ORDER BY sm.OrderWeek, c.CustName, p.ProdName`,
    params
  );

  const estRows = await query(
    `SELECT TOP (@limit)
            e.EstimateKey, sm.ShipmentKey, sm.OrderWeek, c.CustName, p.ProdName,
            ISNULL(e.Descr,'') AS Descr, N'Estimate' AS Source
       FROM Estimate e
       JOIN ShipmentMaster sm ON sm.ShipmentKey = e.ShipmentKey
       JOIN Customer c ON c.CustKey = sm.CustKey
       JOIN Product p ON p.ProdKey = e.ProdKey
      WHERE ${where.join(' AND ')}
        AND ISNULL(e.Descr,'') <> ''
      ORDER BY sm.OrderWeek, c.CustName, p.ProdName`,
    params
  );

  const mapRow = (row) => {
    const before = String(row.Descr || '');
    const after = sanitizeDescrTextForPrint(before);
    return {
      ...row,
      DescrBefore: before,
      DescrAfter: after,
      willChange: before !== after,
    };
  };

  const all = [
    ...(detailRows.recordset || []).map(mapRow),
    ...(dateRows.recordset || []).map(mapRow),
    ...(estRows.recordset || []).map(mapRow),
  ].filter((r) => r.willChange);

  return all;
}

async function applyCleanup(targets) {
  let updated = 0;
  await withTransaction(async (tQ) => {
    for (const row of targets) {
      if (!row.willChange) continue;
      if (row.Source === 'ShipmentDetail') {
        await tQ(
          `UPDATE ShipmentDetail SET Descr = @descr WHERE SdetailKey = @id`,
          {
            id: { type: sql.Int, value: row.SdetailKey },
            descr: { type: sql.NVarChar, value: row.DescrAfter },
          }
        );
        updated += 1;
      } else if (row.Source === 'ShipmentDate') {
        await tQ(
          `UPDATE ShipmentDate SET Descr = @descr WHERE SdateKey = @id`,
          {
            id: { type: sql.Int, value: row.SdateKey },
            descr: { type: sql.NVarChar, value: row.DescrAfter },
          }
        );
        updated += 1;
      } else if (row.Source === 'Estimate') {
        await tQ(
          `UPDATE Estimate SET Descr = @descr WHERE EstimateKey = @id`,
          {
            id: { type: sql.Int, value: row.EstimateKey },
            descr: { type: sql.NVarChar, value: row.DescrAfter },
          }
        );
        updated += 1;
      }
    }
  });
  return updated;
}

async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const q = req.method === 'GET' ? req.query : req.body || {};
  const week = String(q.week || '').trim();
  const cust = String(q.cust || q.customer || '').trim();
  const shipmentKey = q.shipmentKey ? parseInt(q.shipmentKey, 10) : null;
  const limit = toInt(q.limit);
  const apply = req.method === 'POST' && (q.apply === true || q.apply === '1' || q.apply === 1);

  if (!week && !cust && !shipmentKey) {
    return res.status(400).json({
      success: false,
      error: 'week, cust, 또는 shipmentKey 중 하나는 필요합니다.',
    });
  }

  try {
    const targets = await loadTargets({ week, cust, shipmentKey, limit });
    let updated = 0;
    if (apply && targets.length > 0) {
      updated = await applyCleanup(targets);
    }

    return res.status(200).json({
      success: true,
      apply,
      week: week || null,
      cust: cust || null,
      shipmentKey: shipmentKey || null,
      candidateCount: targets.length,
      updated,
      samples: targets.slice(0, 30).map((r) => ({
        source: r.Source,
        shipmentKey: r.ShipmentKey,
        orderWeek: r.OrderWeek,
        custName: r.CustName,
        prodName: r.ProdName,
        before: String(r.DescrBefore || '').slice(0, 120),
        after: String(r.DescrAfter || '').slice(0, 120),
      })),
      note: 'nenova.exe 견적 인쇄는 sdd.Descr/Estimate.Descr 를 그대로 씁니다. 재수정 시 비고가 다시 쌓이면 dnSpy 패치가 필요합니다.',
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

export default withAuth(handler);
