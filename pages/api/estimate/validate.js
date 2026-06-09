// pages/api/estimate/validate.js
// 견적서·출고일 분배 불변조건 런타임 검증 (재발 방지)
// GET ?weeks=23-01,24-01  [&cust=주광]  [&shipmentKey=4850]
//
// 검증 항목:
//  1) ShipmentDate 자정 저장 (PeriodDay 정확매칭)
//  2) 출고일 분할 합계 = ShipmentDetail Est/Amount/Vat
//  3) byDate API(loadItems) 분할 수량 = SQL 기대값
//  4) 요일필터(목) 적용 시 분할 수량 < 총합 (분할 거래처)
//  5) Cost×Qty ≈ Amount+Vat (정상출고)

import { withAuth } from '../../../lib/auth';
import { query, sql } from '../../../lib/db';
import { normalizeOrderWeek } from '../../../lib/orderUtils';
import {
  filterItemsByWeekday,
  checkSplitSumInvariant,
  checkCostQtyInvariant,
  splitEstByDistributeUnits,
  weekdayKrFromYmd,
} from '../../../lib/estimateInvariants';
import { distributeUnits, amountVatFromCostEst } from '../../../lib/distributeUnits';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const weeks = parseWeeks(req.query?.weeks || req.query?.week || '');
  const custKw = String(req.query?.cust || '').trim();
  const skFilter = req.query?.shipmentKey ? parseInt(req.query.shipmentKey, 10) : null;

  if (!weeks.length) {
    return res.status(400).json({
      success: false,
      error: 'weeks 필요 (예: ?weeks=23-01,24-01 또는 ?week=23-01)',
    });
  }

  try {
    const checks = [];
    let pass = 0;
    let fail = 0;
    const add = (c) => {
      checks.push(c);
      if (c.ok) pass++; else fail++;
    };

    for (const week of weeks) {
      const wk = normalizeOrderWeek(week);
      const wkParams = { wk: { type: sql.NVarChar, value: wk }, cust: { type: sql.NVarChar, value: custKw ? `%${custKw}%` : '' } };

      // ── 1) ShipmentDate 자정 불일치
      const dateRows = await query(
        `SELECT sm.OrderWeek, c.CustName, sd.SdetailKey, p.ProdName,
                CONVERT(NVARCHAR(30), sdd.ShipmentDtm, 121) AS ShipDtm
           FROM ShipmentMaster sm
           JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
           JOIN ShipmentDate sdd ON sdd.SdetailKey = sd.SdetailKey
           JOIN Customer c ON c.CustKey = sm.CustKey
           JOIN Product p ON p.ProdKey = sd.ProdKey
          WHERE sm.OrderWeek = @wk AND ISNULL(sm.isDeleted,0)=0
            AND (@cust='' OR c.CustName LIKE @cust)
            AND CONVERT(TIME, sdd.ShipmentDtm) <> '00:00:00'
          ORDER BY c.CustName, p.ProdName`,
        wkParams
      );
      add({
        id: 'shipdate-midnight',
        week: wk,
        ok: (dateRows.recordset?.length || 0) === 0,
        broken: dateRows.recordset?.length || 0,
        samples: (dateRows.recordset || []).slice(0, 5),
      });

      // ── 2) 분할 SdetailKey — ShipmentQuantity 비중 합계 검증
      const splitRows = await query(
        `SELECT sm.OrderWeek, c.CustName, sd.SdetailKey, p.ProdName, p.EstUnit, p.OutUnit,
                ISNULL(p.BunchOf1Box,0) AS BunchOf1Box, ISNULL(p.SteamOf1Bunch,0) AS SteamOf1Bunch,
                ISNULL(p.SteamOf1Box,0) AS SteamOf1Box,
                sd.EstQuantity AS DetailEst, sd.Amount AS DetailAmt, sd.Vat AS DetailVat,
                sd.Cost,
                sdd.ShipmentQuantity AS DateShipQty,
                CONVERT(NVARCHAR(10), sdd.ShipmentDtm, 120) AS DateYmd,
                dagg.DateCount, dagg.SumShip
           FROM ShipmentMaster sm
           JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
           JOIN Customer c ON c.CustKey = sm.CustKey
           JOIN Product p ON p.ProdKey = sd.ProdKey
           JOIN ShipmentDate sdd ON sdd.SdetailKey = sd.SdetailKey
           CROSS APPLY (
             SELECT COUNT(*) AS DateCount, SUM(z.ShipmentQuantity) AS SumShip
               FROM ShipmentDate z WHERE z.SdetailKey = sd.SdetailKey
           ) dagg
          WHERE sm.OrderWeek = @wk AND ISNULL(sm.isDeleted,0)=0
            AND (@cust='' OR c.CustName LIKE @cust)
            AND dagg.DateCount > 1
          ORDER BY c.CustName, p.ProdName, sdd.ShipmentDtm`,
        wkParams
      );

      const bySd = {};
      for (const r of splitRows.recordset || []) {
        const k = r.SdetailKey;
        if (!bySd[k]) {
          bySd[k] = {
            meta: r,
            dateRows: [],
          };
        }
        bySd[k].dateRows.push(r);
      }

      for (const [sdKey, g] of Object.entries(bySd)) {
        if (skFilter) {
          const inSk = g.dateRows.some((r) => r.ShipmentKey === skFilter);
          if (!inSk && !(await sdInShipment(Number(sdKey), skFilter))) continue;
        }
        const product = {
          OutUnit: g.meta.OutUnit,
          EstUnit: g.meta.EstUnit,
          BunchOf1Box: g.meta.BunchOf1Box,
          SteamOf1Bunch: g.meta.SteamOf1Bunch,
          SteamOf1Box: g.meta.SteamOf1Box,
        };
        const parts = splitEstByDistributeUnits(
          g.dateRows.map((r) => ({ ShipmentQuantity: r.DateShipQty, ShipmentDtm: r.DateYmd })),
          product,
          Number(g.meta.Cost) || 0
        );
        const expSum = parts.reduce((s, p) => s + p.expQty, 0);
        const qtyOk = Math.abs(expSum - Number(g.meta.DetailEst)) <= 1;

        const apiRows = parts.map((p) => ({
          Quantity: p.expQty,
          Amount: p.expAmount,
          Vat: p.expVat,
          outDate: p.ShipmentDtm,
          Cost: Number(g.meta.Cost),
        }));
        const inv = checkSplitSumInvariant(apiRows, {
          EstQuantity: g.meta.DetailEst,
          Amount: g.meta.DetailAmt,
          Vat: g.meta.DetailVat,
        });

        add({
          id: 'split-sum',
          week: wk,
          custName: g.meta.CustName,
          prodName: g.meta.ProdName,
          sdetailKey: Number(sdKey),
          dateCount: g.dateRows.length,
          detailEst: g.meta.DetailEst,
          expSplitSum: expSum,
          ok: qtyOk && inv.ok,
          qtyOk,
          inv,
          dates: g.dateRows.map((r, i) => ({
            ymd: r.DateYmd,
            wd: weekdayKrFromYmd(r.DateYmd),
            shipQty: r.DateShipQty,
            expQty: parts[i]?.expQty,
            apiQty: apiRows.find((x) => x.outDate === r.DateYmd)?.Quantity,
          })),
        });
      }

      // ── 3) ShipmentKey 단위 byDate API 실측 (주요 거래처)
      const masters = await query(
        `SELECT sm.ShipmentKey, c.CustName
           FROM ShipmentMaster sm
           JOIN Customer c ON c.CustKey = sm.CustKey
          WHERE sm.OrderWeek = @wk AND ISNULL(sm.isDeleted,0)=0
            AND (@cust='' OR c.CustName LIKE @cust)
          ORDER BY c.CustName`,
        wkParams
      );

      for (const m of masters.recordset || []) {
        if (skFilter && m.ShipmentKey !== skFilter) continue;
        const sk = m.ShipmentKey;
        const apiByDate = await fetchEstimateItems(sk, true);
        const apiFlat = await fetchEstimateItems(sk, false);

        // 분할 품목: byDate 행 수 > flat 행 수
        const byDateNormals = (apiByDate || []).filter((i) => i.EstimateType === '정상출고');
        const flatNormals = (apiFlat || []).filter((i) => i.EstimateType === '정상출고');

        const byDateGrouped = groupBySdetail(byDateNormals);
        for (const [sdk, rows] of Object.entries(byDateGrouped)) {
          if (rows.length <= 1) continue;
          const flat = flatNormals.find((i) => i.SdetailKey === Number(sdk));
          if (!flat) continue;
          const inv = checkSplitSumInvariant(rows, flat);
          add({
            id: 'api-bydate-split',
            week: wk,
            custName: m.CustName,
            shipmentKey: sk,
            sdetailKey: Number(sdk),
            prodName: flat.ProdName,
            flatQty: flat.Quantity,
            splitRows: rows.length,
            ok: inv.ok,
            inv,
          });

          // 요일필터: 첫 출고일만 선택 시 수량 < 총합
          const firstWd = weekdayKrFromYmd(rows[0].outDate);
          if (firstWd) {
            const filtered = filterItemsByWeekday(rows, new Set([firstWd]));
            const fQty = filtered.reduce((s, r) => s + (Number(r.Quantity) || 0), 0);
            add({
              id: 'weekday-filter-partial',
              week: wk,
              custName: m.CustName,
              sdetailKey: Number(sdk),
              prodName: flat.ProdName,
              weekday: firstWd,
              filteredQty: fQty,
              totalQty: flat.Quantity,
              ok: fQty > 0 && fQty < flat.Quantity,
            });
          }
        }

        let costChecked = 0;
        let costFailed = 0;
        for (const row of byDateNormals) {
          const c = checkCostQtyInvariant(row);
          if (c.skip) continue;
          costChecked += 1;
          if (!c.ok) {
            costFailed += 1;
            if (costFailed <= 5) {
              add({
                id: 'cost-qty-amount',
                week: wk,
                custName: m.CustName,
                sdetailKey: row.SdetailKey,
                prodName: row.ProdName,
                outDate: row.outDate,
                ok: false,
                ...c,
              });
            }
          }
        }
        if (costChecked > 0) {
          add({
            id: 'cost-qty-summary',
            week: wk,
            custName: m.CustName,
            shipmentKey: sk,
            ok: costFailed === 0,
            checked: costChecked,
            failed: costFailed,
          });
        }
      }
    }

    return res.status(200).json({
      success: fail === 0,
      weeks,
      cust: custKw || null,
      passed: pass,
      failed: fail,
      checks: checks.filter((c) => c.id !== 'cost-qty-amount' || !c.ok).slice(0, 100),
      failedChecks: checks.filter((c) => !c.ok),
      hint: fail > 0
        ? '실패 항목 확인 후 estimate-period-repair 보정 또는 shipmentImport 재발방지 점검'
        : '모든 불변조건 통과',
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

function parseWeeks(raw) {
  if (!raw) return [];
  return String(raw).split(/[,\s]+/).map((w) => normalizeOrderWeek(w.trim())).filter(Boolean);
}

function groupBySdetail(items) {
  const g = {};
  for (const it of items || []) {
    const k = it.SdetailKey;
    if (k == null) continue;
    (g[k] = g[k] || []).push(it);
  }
  return g;
}

async function sdInShipment(sdetailKey, shipmentKey) {
  const r = await query(
    `SELECT 1 FROM ShipmentDetail WHERE SdetailKey=@dk AND ShipmentKey=@sk`,
    { dk: { type: sql.Int, value: sdetailKey }, sk: { type: sql.Int, value: shipmentKey } }
  );
  return (r.recordset?.length || 0) > 0;
}

/** estimate index loadItems(byDate) 와 동일 — ShipmentDate.ShipmentQuantity + distributeUnits */
async function fetchEstimateItems(shipmentKey, byDate) {
  const dateJoin = byDate ? `INNER JOIN ShipmentDate sdd ON sdd.SdetailKey = sd.SdetailKey` : ``;
  const outDateExpr = byDate ? `sdd.ShipmentDtm` : `sd.ShipmentDtm`;
  const extraCols = byDate
    ? `sdd.ShipmentQuantity AS DateShipQty,
       p.OutUnit, p.EstUnit, ISNULL(p.BunchOf1Box,0) AS BunchOf1Box,
       ISNULL(p.SteamOf1Bunch,0) AS SteamOf1Bunch, ISNULL(p.SteamOf1Box,0) AS SteamOf1Box,`
    : ``;
  const estQtyExpr = `CASE WHEN ISNULL(sd.EstQuantity,0) <> 0 THEN sd.EstQuantity
       WHEN ISNULL(sd.BunchQuantity,0) > 0 THEN sd.BunchQuantity
       WHEN ISNULL(sd.SteamQuantity,0) > 0 THEN sd.SteamQuantity
       ELSE sd.BoxQuantity END`;
  const r = await query(
    `SELECT sd.SdetailKey, sd.ProdKey, p.ProdName, p.EstUnit,
            ${extraCols}
            ISNULL(NULLIF(p.EstUnit, N''),
              CASE WHEN ISNULL(sd.BunchQuantity,0) > 0 THEN N'단'
                   WHEN ISNULL(sd.SteamQuantity,0) > 0 THEN N'송이'
                   ELSE N'박스' END) AS Unit,
            (${estQtyExpr}) AS Quantity,
            ISNULL(NULLIF(sd.Cost, 0), ISNULL(NULLIF(cpc.Cost, 0), ISNULL(p.Cost, 0))) AS Cost,
            ISNULL(NULLIF(sd.Amount, 0),
              ROUND(ISNULL(NULLIF(cpc.Cost, 0), ISNULL(p.Cost, 0)) * (${estQtyExpr}) / 1.1, 0)
            ) AS Amount,
            ISNULL(NULLIF(sd.Vat, 0),
              ROUND(ISNULL(NULLIF(cpc.Cost, 0), ISNULL(p.Cost, 0)) * (${estQtyExpr}) / 11, 0)
            ) AS Vat,
            N'정상출고' AS EstimateType,
            CONVERT(NVARCHAR(10), ${outDateExpr}, 120) AS outDate
       FROM ShipmentDetail sd
       ${dateJoin}
       LEFT JOIN ShipmentMaster smOuter ON sd.ShipmentKey = smOuter.ShipmentKey
       LEFT JOIN Product p ON p.ProdKey = sd.ProdKey
       LEFT JOIN CustomerProdCost cpc ON cpc.CustKey = smOuter.CustKey AND cpc.ProdKey = sd.ProdKey
      WHERE sd.ShipmentKey = @sk`,
    { sk: { type: sql.Int, value: shipmentKey } }
  );
  const rows = r.recordset || [];
  if (!byDate) return rows;
  return rows.map((row) => {
    const dateQty = Number(row.DateShipQty);
    if (!Number.isFinite(dateQty)) return row;
    const units = distributeUnits(dateQty, {
      OutUnit: row.OutUnit,
      EstUnit: row.EstUnit,
      BunchOf1Box: row.BunchOf1Box,
      SteamOf1Bunch: row.SteamOf1Bunch,
      SteamOf1Box: row.SteamOf1Box,
    });
    const cost = Number(row.Cost) || 0;
    const { amount, vat } = amountVatFromCostEst(cost, units.estQty);
    return {
      ...row,
      Unit: row.EstUnit || row.Unit,
      Quantity: units.estQty,
      Amount: amount,
      Vat: vat,
    };
  });
}
