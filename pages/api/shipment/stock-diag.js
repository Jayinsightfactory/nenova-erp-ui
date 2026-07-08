// pages/api/shipment/stock-diag.js
// 읽기 전용 잔량(재고 스냅샷) 진단.
// 전산(usp_StockCalculation) cascade 누락으로 ProductStock 스냅샷이 stale 한 품목을 찾는다.
// 전산 잔량 공식: NewStock = PrevStock(전차수 마감) + 입고 - 확정출고 + 재고조정
// 저장된 스냅샷이 이 계산값과 다르면 cascade 갱신 누락(stale) → usp_StockCalculation 재실행 필요.
//
// 사용법(GET): /api/shipment/stock-diag?week=24-01&year=2026&country=네덜란드&flower=안시리움
//  - week  필수 (예: 24-01)
//  - year  선택 (기본 현재연도)
//  - country/flower 선택 (LIKE 부분일치). 둘 다 없으면 전체(최대 1000건)
//  - staleOnly=1 이면 차이나는 품목만
//
// ⚠️ SELECT 전용. DB 수정 없음. 복구(EXEC usp_StockCalculation)는 전산/SSMS에서 실행.

import { withAuth } from '../../../lib/auth';
import { query, sql } from '../../../lib/db';
import { buildOrderYearWeek, normalizeOrderWeek, resolveActiveOrderYear } from '../../../lib/orderUtils';

const MANUAL_STOCK_CHANGE_FILTER =
  `(sh.ChangeType IS NULL OR sh.ChangeType NOT IN (N'확정', N'확정취소', N'입고', N'출고'))`;

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'GET only' });

  const rawWeek = String(req.query.week || '').trim();
  if (!rawWeek) return res.status(400).json({ success: false, error: 'week 필요 (예: 24-01)' });

  let week, year, yws;
  try {
    week = normalizeOrderWeek(rawWeek);
    year = resolveActiveOrderYear(rawWeek, req.query.year);
    yws = buildOrderYearWeek(year, week);
  } catch (e) {
    return res.status(400).json({ success: false, error: `차수 형식 오류: ${e.message}` });
  }

  const country = String(req.query.country || '').trim();
  const flower = String(req.query.flower || '').trim();
  const staleOnly = req.query.staleOnly === '1' || req.query.staleOnly === 'true';

  const conds = ['ISNULL(p.isDeleted,0)=0'];
  const params = { yws: { type: sql.NVarChar, value: yws } };
  if (country) {
    conds.push('p.CounName LIKE @country');
    params.country = { type: sql.NVarChar, value: `%${country}%` };
  }
  if (flower) {
    conds.push('(p.FlowerName LIKE @flower OR p.ProdName LIKE @flower)');
    params.flower = { type: sql.NVarChar, value: `%${flower}%` };
  }

  try {
    const result = await query(
      `SELECT TOP 1000
          p.ProdKey, p.CounName AS country, p.FlowerName AS flower, p.ProdName AS prodName,
          ISNULL(p.OutUnit,'') AS outUnit,
          cur.Stock  AS storedStock,
          cur.OrderWeek AS storedWeek,
          prev.Stock AS prevStock,
          prev.OrderWeek AS prevWeek,
          ISNULL(inc.q,0)  AS incoming,
          ISNULL(o.q,0)    AS confirmedOut,
          ISNULL(adj.q,0)  AS stockAdjust
        FROM Product p
        OUTER APPLY (
          SELECT TOP 1 ps.Stock, sm.OrderWeek
            FROM ProductStock ps
            JOIN StockMaster sm ON sm.StockKey = ps.StockKey
           WHERE ps.ProdKey = p.ProdKey AND sm.OrderYearWeek = @yws
           ORDER BY ps.StockKey DESC
        ) cur
        OUTER APPLY (
          SELECT TOP 1 ps.Stock, sm.OrderWeek
            FROM ProductStock ps
            JOIN StockMaster sm ON sm.StockKey = ps.StockKey
           WHERE ps.ProdKey = p.ProdKey AND sm.OrderYearWeek < @yws
           ORDER BY sm.OrderYearWeek DESC, sm.OrderWeek DESC, ps.StockKey DESC
        ) prev
        OUTER APPLY (
          SELECT SUM(ISNULL(wd.OutQuantity,0)) AS q
            FROM WarehouseDetail wd
            JOIN WarehouseMaster wm ON wm.WarehouseKey = wd.WarehouseKey AND ISNULL(wm.isDeleted,0)=0
           WHERE wd.ProdKey = p.ProdKey
             AND (wm.OrderYear + REPLACE(wm.OrderWeek,'-','')) = @yws
        ) inc
        OUTER APPLY (
          SELECT SUM(ISNULL(sd.OutQuantity,0)) AS q
            FROM ShipmentDetail sd
            JOIN ShipmentMaster sm2 ON sm2.ShipmentKey = sd.ShipmentKey AND ISNULL(sm2.isDeleted,0)=0
           WHERE sd.ProdKey = p.ProdKey
             AND ISNULL(sd.isFix,0)=1
             AND (sm2.OrderYear + REPLACE(sm2.OrderWeek,'-','')) = @yws
        ) o
        OUTER APPLY (
          SELECT SUM(ISNULL(sh.AfterValue,0) - ISNULL(sh.BeforeValue,0)) AS q
            FROM StockHistory sh
           WHERE sh.ProdKey = p.ProdKey
             AND (sh.OrderYear + REPLACE(sh.OrderWeek,'-','')) = @yws
             AND ${MANUAL_STOCK_CHANGE_FILTER}
        ) adj
        WHERE ${conds.join(' AND ')}
        ORDER BY p.CounName, p.FlowerName, p.ProdName`,
      params
    );

    const rows = (result.recordset || []).map(r => {
      const prev = Number(r.prevStock || 0);
      const incoming = Number(r.incoming || 0);
      const confirmedOut = Number(r.confirmedOut || 0);
      const adjust = Number(r.stockAdjust || 0);
      const expected = prev + incoming - confirmedOut + adjust;
      const hasSnapshot = r.storedStock != null;
      const stored = hasSnapshot ? Number(r.storedStock) : null;
      const diff = hasSnapshot ? stored - expected : null;
      const stale = hasSnapshot ? Math.abs(diff) >= 1 : false;
      return {
        prodKey: r.ProdKey,
        country: r.country,
        flower: r.flower,
        prodName: r.prodName,
        outUnit: r.outUnit,
        storedStock: stored,
        prevStock: prev,
        prevWeek: r.prevWeek || '',
        incoming,
        confirmedOut,
        stockAdjust: adjust,
        expected,
        diff,
        noSnapshot: !hasSnapshot,
        stale,
      };
    });

    const filtered = staleOnly ? rows.filter(r => r.stale || r.noSnapshot) : rows;
    const staleRows = rows.filter(r => r.stale);
    const noSnapRows = rows.filter(r => r.noSnapshot);

    const repairTemplate = staleRows.map(r =>
      `EXEC dbo.usp_StockCalculation @OrderYear='${year}', @OrderWeek='${week}', @ProdKey=${r.prodKey}, @iUserID='<로그인 사용자>';  -- ${r.prodName} (저장 ${r.storedStock} → 계산 ${r.expected})`
    );

    return res.status(200).json({
      success: true,
      year,
      week,
      yearWeekKey: yws,
      formula: '계산잔량 = 전차수마감 + 입고 - 확정출고 + 재고조정',
      counts: { matched: rows.length, stale: staleRows.length, noSnapshot: noSnapRows.length },
      rows: filtered,
      repairTemplate,
      note: 'stale=저장 스냅샷이 계산값과 다름(전산 cascade 누락). 복구는 전산/SSMS에서 usp_StockCalculation 실행. storedStock=null(noSnapshot)이면 24-01 스냅샷 자체가 없음 → 차수 키 형식 확인 필요.',
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}

export default withAuth(handler);
