// Nenova.exe FormShipmentDistribution 농장분배 parity API
//
// GET  ?year=2026&week=29-02&custKey=...&prodKey=...&sdetailKey=...
// POST { year, week, custKey, prodKey, sdetailKey, assignments:[{farmKey,shipmentQuantity}] }
//
// EXE는 FarmKey를 ViewWarehouse.FarmName -> Farm.FarmKey로 얻은 뒤
// ShipmentFarm(FarmKey, ShipmentQuantity, SdetailKey)를 같은 저장 흐름에 넣는다.
// dnSpy의 grdViewShipment_FocusedRowChanged 는 ViewWarehouse 를 선택 차수/연도로
// 제한하지 않고 ProdKey만 제한한다. 과거 입고차수의 농장도 현재 품목의 후보이므로
// 웹도 같은 범위를 사용해야 27-02 입고농장을 29-02 출고에 배정할 수 있다.

import { query, withTransaction, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { withActionLog } from '../../../lib/withActionLog';
import {
  assertFarmAssignmentTotal,
  normalizeFarmAssignments,
} from '../../../lib/shipmentFarmAssignments.js';

function int(value, name) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name}이(가) 올바르지 않습니다.`);
  return n;
}

function text(value, name) {
  const v = String(value ?? '').trim();
  if (!v) throw new Error(`${name}이(가) 필요합니다.`);
  return v;
}

async function resolveDetail({ sdetailKey, year, week, custKey, prodKey }, q = query) {
  const params = {
    dk: { type: sql.Int, value: Number(sdetailKey || 0) },
    yr: { type: sql.NVarChar, value: year },
    wk: { type: sql.NVarChar, value: week },
    ck: { type: sql.Int, value: custKey },
    pk: { type: sql.Int, value: prodKey },
  };
  const where = sdetailKey
    ? 'sd.SdetailKey=@dk'
    : 'sm.OrderYear=@yr AND sm.OrderWeek=@wk AND sm.CustKey=@ck AND sd.ProdKey=@pk';
  const result = await q(
    `SELECT TOP 1 sd.SdetailKey, sd.ProdKey, sm.CustKey, sm.OrderYear, sm.OrderWeek,
            ISNULL(sd.OutQuantity,0) AS OutQuantity,
            ISNULL(sm.isFix,0) AS MasterFix, ISNULL(sd.isFix,0) AS DetailFix
       FROM ShipmentDetail sd
       JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey
      WHERE ${where} AND ISNULL(sm.isDeleted,0)=0
      ORDER BY ISNULL(sm.isFix,0) DESC, sd.SdetailKey ASC`,
    params,
  );
  return result.recordset[0] || null;
}

async function loadFarmRows({ year, week, prodKey, sdetailKey }, q = query) {
  const result = await q(
    `WITH WarehouseSummary AS (
       SELECT vw.OrderYear, vw.OrderWeek, vw.FarmName, vw.OrderCode, vw.ProdKey,
              SUM(vw.OutQuantity) AS wOutQuantity
         FROM ViewWarehouse vw
        WHERE vw.ProdKey=@pk
        GROUP BY vw.OrderYear, vw.OrderWeek, vw.FarmName, vw.OrderCode, vw.ProdKey
     ), CurrentFarm AS (
       SELECT sf.FarmKey, SUM(ISNULL(sf.ShipmentQuantity,0)) AS sOutQuantity
         FROM ShipmentFarm sf
        WHERE sf.SdetailKey=@dk
        GROUP BY sf.FarmKey
     )
     SELECT ws.FarmName,
            ISNULL(f.FarmKey,0) AS FarmKey,
            ISNULL(f.FarmCode,SUBSTRING(ws.FarmName,1,1)) AS FarmCode,
            ws.OrderCode,
            ws.wOutQuantity,
            ISNULL(cf.sOutQuantity,0) AS sOutQuantity,
            ws.wOutQuantity-ISNULL(cf.sOutQuantity,0) AS Remainuantity
       FROM WarehouseSummary ws
       LEFT JOIN Farm f ON ws.FarmName=f.FarmName AND ISNULL(f.isDeleted,0)=0
       LEFT JOIN CurrentFarm cf ON cf.FarmKey=f.FarmKey
      ORDER BY ws.FarmName, ws.OrderCode`,
    {
      yr: { type: sql.NVarChar, value: year },
      wk: { type: sql.NVarChar, value: week },
      pk: { type: sql.Int, value: prodKey },
      dk: { type: sql.Int, value: Number(sdetailKey || 0) },
    },
  );
  return result.recordset || [];
}

async function getFarmDistribution(req, res) {
  try {
    const year = text(req.query.year, '연도');
    const week = text(req.query.week, '차수');
    const prodKey = int(req.query.prodKey, 'ProdKey');
    const custKey = req.query.custKey ? int(req.query.custKey, 'CustKey') : null;
    const detail = await resolveDetail({
      sdetailKey: req.query.sdetailKey,
      year, week, custKey, prodKey,
    });
    const sdetailKey = detail?.SdetailKey || Number(req.query.sdetailKey || 0);
    const farms = await loadFarmRows({ year, week, prodKey, sdetailKey });
    return res.status(200).json({
      success: true,
      source: 'nenova-exe-form-shipment-distribution',
      detail: detail ? {
        sdetailKey: detail.SdetailKey,
        outQuantity: Number(detail.OutQuantity || 0),
        orderYear: String(detail.OrderYear),
        orderWeek: detail.OrderWeek,
      } : null,
      farms,
    });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
}

async function saveFarmDistribution(req, res) {
  try {
    const year = text(req.body?.year, '연도');
    const week = text(req.body?.week, '차수');
    const custKey = int(req.body?.custKey, 'CustKey');
    const prodKey = int(req.body?.prodKey, 'ProdKey');
    const sdetailKey = int(req.body?.sdetailKey, 'SdetailKey');
    const assignments = normalizeFarmAssignments(req.body?.assignments);
    if (!assignments) throw new Error('농장배정 목록이 필요합니다.');

    const detail = await resolveDetail({ sdetailKey, year, week, custKey, prodKey });
    if (!detail) throw new Error('대상 ShipmentDetail을 찾을 수 없습니다.');
    if (String(detail.OrderYear) !== year || String(detail.OrderWeek) !== week ||
        Number(detail.CustKey) !== custKey || Number(detail.ProdKey) !== prodKey) {
      throw new Error('연도·차수·업체·품목 업무키가 일치하지 않습니다.');
    }
    if (Number(detail.MasterFix) === 1 || Number(detail.DetailFix) === 1) {
      throw new Error('확정된 출고는 먼저 확정취소 후 농장배정을 수정하세요.');
    }
    assertFarmAssignmentTotal(assignments, detail.OutQuantity);

    const candidateResult = await query(
      `SELECT DISTINCT f.FarmKey, ISNULL(f.FarmCode,SUBSTRING(vw.FarmName,1,1)) AS FarmCode,
              vw.FarmName
         FROM ViewWarehouse vw
         JOIN Farm f ON vw.FarmName=f.FarmName
        WHERE vw.ProdKey=@pk
          AND ISNULL(f.isDeleted,0)=0`,
      {
        yr: { type: sql.NVarChar, value: year },
        wk: { type: sql.NVarChar, value: week },
        pk: { type: sql.Int, value: prodKey },
      },
    );
    const candidates = new Map(candidateResult.recordset.map((row) => [Number(row.FarmKey), row]));
    for (const row of assignments) {
      if (!candidates.has(row.farmKey)) {
        throw new Error(`FarmKey ${row.farmKey}는 해당 연도·차수·품목의 입고농장에서 찾을 수 없습니다.`);
      }
    }

    const result = await withTransaction(async (tQ) => {
      await tQ(
        'DELETE FROM ShipmentFarm WHERE SdetailKey=@dk',
        { dk: { type: sql.Int, value: sdetailKey } },
      );
      for (const row of assignments) {
        // ClassShipmentFarm.Insert()와 동일하게 SfarmKey는 DB 기본 채번에 맡긴다.
        await tQ(
          `INSERT INTO ShipmentFarm (FarmKey, ShipmentQuantity, SdetailKey)
           VALUES (@fk,@qty,@dk)`,
          {
            fk: { type: sql.Int, value: row.farmKey },
            qty: { type: sql.Float, value: row.shipmentQuantity },
            dk: { type: sql.Int, value: sdetailKey },
          },
        );
      }
      const descr = assignments
        .map((row) => `${candidates.get(row.farmKey)?.FarmCode || row.farmKey}:${row.shipmentQuantity}`)
        .join('/');
      await tQ(
        'UPDATE ShipmentDetail SET Descr=@descr WHERE SdetailKey=@dk',
        {
          descr: { type: sql.NVarChar, value: descr },
          dk: { type: sql.Int, value: sdetailKey },
        },
      );
      return { count: assignments.length, descr };
    });

    return res.status(200).json({
      success: true,
      source: 'nenova-exe-form-shipment-distribution',
      sdetailKey,
      ...result,
    });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
}

export default withAuth(withActionLog(async function handler(req, res) {
  if (req.method === 'GET') return getFarmDistribution(req, res);
  if (req.method === 'POST') return saveFarmDistribution(req, res);
  return res.status(405).end();
}, { actionType: 'SHIPMENT_WRITE', affectedTable: 'ShipmentFarm', riskLevel: 'HIGH' }));

