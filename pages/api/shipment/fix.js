// pages/api/shipment/fix.js
// POST { week, action: 'fix' | 'unfix' }
// 확정: isFix=1 + ProductStock 업데이트 + StockHistory 기록
// 확정취소: isFix=0

import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

export default withAuth(async function handler(req, res) {
  if (req.method === 'GET') return await validate(req, res);
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

// ── 확정 전 사전검증 (GET ?week=16-01)
// 1. 주문 없는데 출고 있는 품목 (ghost)
// 2. 같은 거래처+품목에 중복 출고 레코드
// 3. 마이너스 잔량 품목
async function validate(req, res) {
  const { week } = req.query;
  if (!week) return res.status(400).json({ success: false, error: 'week 필요' });
  try {
    const orderYear = deriveOrderYear(week);
    const orderWeek = deriveOrderWeek(week);
    const orderYearWeek = orderYear + String(orderWeek || '').replace('-', '');
    const wk = { type: sql.NVarChar, value: orderWeek };

    // 1. 주문 없는 출고 (OrderDetail 없는데 ShipmentDetail 있음)
    const ghostResult = await query(
      `SELECT DISTINCT p.ProdName, c.CustName, sd.OutQuantity,
         sm.ShipmentKey, sm.isFix, sm.WebCreated
       FROM ShipmentDetail sd
       JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
       JOIN Product p ON sd.ProdKey = p.ProdKey
       JOIN Customer c ON sm.CustKey = c.CustKey
       WHERE sm.OrderWeek = @wk AND sm.isDeleted = 0 AND sd.OutQuantity > 0
         AND NOT EXISTS (
           SELECT 1 FROM OrderDetail od
           JOIN OrderMaster om ON od.OrderMasterKey = om.OrderMasterKey
           WHERE om.CustKey = sm.CustKey AND om.OrderWeek = @wk
             AND od.ProdKey = sd.ProdKey AND om.isDeleted = 0 AND od.isDeleted = 0
         )
       ORDER BY c.CustName, p.ProdName`,
      { wk }
    );

    // 2. 중복 출고 (같은 거래처+품목+차수에 ShipmentDetail 2건 이상)
    const dupResult = await query(
      `SELECT p.ProdName, c.CustName,
         COUNT(sd.SdetailKey) AS cnt,
         SUM(sd.OutQuantity) AS totalQty,
         STRING_AGG(CAST(sd.ShipmentKey AS NVARCHAR(20)), ',') AS shipKeys
       FROM ShipmentDetail sd
       JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
       JOIN Product p ON sd.ProdKey = p.ProdKey
       JOIN Customer c ON sm.CustKey = c.CustKey
       WHERE sm.OrderWeek = @wk AND sm.isDeleted = 0 AND sd.OutQuantity > 0
       GROUP BY sm.CustKey, sd.ProdKey, p.ProdName, c.CustName
       HAVING COUNT(sd.SdetailKey) > 1
       ORDER BY c.CustName, p.ProdName`,
      { wk }
    );

    // 3. 마이너스 잔량
    const negResult = await query(
      `WITH out_qty AS (
         SELECT sd.ProdKey, SUM(ISNULL(sd.OutQuantity, 0)) AS outQty
         FROM ShipmentMaster sm
         JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
         WHERE sm.OrderWeek = @wk AND sm.isDeleted = 0 AND ISNULL(sd.OutQuantity, 0) > 0
         GROUP BY sd.ProdKey
       ),
       in_qty AS (
         SELECT wd.ProdKey, SUM(ISNULL(wd.OutQuantity, 0)) AS inQty
         FROM WarehouseMaster wm
         JOIN WarehouseDetail wd ON wd.WarehouseKey = wm.WarehouseKey
         WHERE wm.OrderWeek = @wk AND wm.isDeleted = 0
         GROUP BY wd.ProdKey
       )
       SELECT
         p.ProdKey,
         p.ProdName,
         p.FlowerName,
         p.CounName,
         ISNULL(prev.prevStock, 0) AS prevStock,
         ISNULL(iq.inQty, 0) AS inQty,
         ISNULL(oq.outQty, 0) AS outQty,
         ISNULL(prev.prevStock, 0) + ISNULL(iq.inQty, 0) - ISNULL(oq.outQty, 0) AS remain
       FROM out_qty oq
       JOIN Product p ON p.ProdKey = oq.ProdKey AND p.isDeleted = 0
       LEFT JOIN in_qty iq ON iq.ProdKey = oq.ProdKey
       OUTER APPLY (
         SELECT TOP 1 ps.Stock AS prevStock
         FROM ProductStock ps
         JOIN StockMaster sm2 ON ps.StockKey = sm2.StockKey
         WHERE ps.ProdKey = p.ProdKey
           AND ISNULL(CAST(sm2.OrderYear AS NVARCHAR(4)), @yr) + REPLACE(sm2.OrderWeek, '-', '') < @ywk
         ORDER BY ISNULL(CAST(sm2.OrderYear AS NVARCHAR(4)), @yr) + REPLACE(sm2.OrderWeek, '-', '') DESC
       ) prev
       WHERE ISNULL(prev.prevStock, 0) + ISNULL(iq.inQty, 0) - ISNULL(oq.outQty, 0) < 0
       ORDER BY p.FlowerName, p.ProdName`,
      {
        wk,
        yr:  { type: sql.NVarChar, value: orderYear },
        ywk: { type: sql.NVarChar, value: orderYearWeek },
      }
    );

    const negRows = negResult.recordset.map(r => ({
      ...r,
      remain: Math.round((Number(r.prevStock || 0) + Number(r.inQty || 0) - Number(r.outQty || 0)) * 1000) / 1000,
    }));

    // 4. 입고 없는 출고 (WarehouseDetail 없는데 ShipmentDetail.OutQuantity > 0)
    //    이 케이스가 견적서에서 "입고 0인데 출고 5" 처럼 보여 작업 오류 유발
    const noInResult = await query(
      `SELECT DISTINCT p.ProdName, p.FlowerName, p.CounName,
         SUM(sd.OutQuantity) AS outQty,
         ISNULL((SELECT SUM(wd.OutQuantity) FROM WarehouseDetail wd
           JOIN WarehouseMaster wm ON wd.WarehouseKey = wm.WarehouseKey
           WHERE wd.ProdKey = p.ProdKey AND wm.OrderWeek = @wk AND wm.isDeleted = 0), 0) AS inQty
       FROM ShipmentDetail sd
       JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
       JOIN Product p ON sd.ProdKey = p.ProdKey
       WHERE sm.OrderWeek = @wk AND sm.isDeleted = 0 AND sd.OutQuantity > 0
       GROUP BY p.ProdKey, p.ProdName, p.FlowerName, p.CounName
       HAVING ISNULL((SELECT SUM(wd.OutQuantity) FROM WarehouseDetail wd
           JOIN WarehouseMaster wm ON wd.WarehouseKey = wm.WarehouseKey
           WHERE wd.ProdKey = p.ProdKey AND wm.OrderWeek = @wk AND wm.isDeleted = 0), 0) = 0
       ORDER BY p.FlowerName, p.ProdName`,
      { wk }
    );

    const issues = ghostResult.recordset.length + dupResult.recordset.length + negRows.length + noInResult.recordset.length;
    return res.status(200).json({
      success: true,
      week: `${orderYear}-${orderWeek}`,
      issueCount: issues,
      ghost:    ghostResult.recordset,    // 주문 없는 출고
      noIncoming: noInResult.recordset,   // 입고 없는 출고 (4번째 검증)
      duplicate: dupResult.recordset,     // 중복 출고
      negative: negRows,                  // 마이너스 잔량
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ── OrderYear 추출 헬퍼: '2026-17-02' / '17-02' 둘 다 지원
function deriveOrderYear(week) {
  const m = (week || '').match(/^(\d{4})-/);
  if (m) return m[1];
  return String(new Date().getFullYear());
}
function deriveOrderWeek(week) {
  const m = (week || '').match(/^\d{4}-(\d{2}-\d{2})$/);
  return m ? m[1] : week;
}

// ── 확정 — 전산 SP usp_ShipmentFix 를 CountryFlower 단위 호출
//    (전산프로그램과 100% 동일 동작: Product.Stock 차감 + 잔량 마이너스 검증 + 출고일 검증)
async function fix(req, res, week, prodKeyFilter) {
  if (prodKeyFilter) {
    return res.status(400).json({
      success: false,
      error: '품목 단위 부분 확정은 지원하지 않습니다. 차수 전체를 확정하세요.',
    });
  }

  const orderYear = deriveOrderYear(week);
  const orderWeek = deriveOrderWeek(week);
  const uid       = req.user?.userId || 'admin';

  // 1. 이미 전체 확정된 경우 안내
  const already = await query(
    `SELECT COUNT(*) AS cnt FROM ShipmentMaster
      WHERE OrderWeek=@wk AND isFix=1 AND isDeleted=0`,
    { wk: { type: sql.NVarChar, value: orderWeek } }
  );

  // 2. 미확정(DetailFix=0) 출고가 있는 CountryFlower 목록
  const cfList = await query(
    `SELECT DISTINCT p.CountryFlower
       FROM ShipmentDetail sd
       JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
       JOIN Product p          ON sd.ProdKey = p.ProdKey AND p.isDeleted = 0
      WHERE sm.OrderWeek=@wk AND sm.isDeleted = 0
        AND ISNULL(sd.isFix, 0) = 0
        AND sd.OutQuantity > 0`,
    { wk: { type: sql.NVarChar, value: orderWeek } }
  );

  const flowers = cfList.recordset
    .map(r => r.CountryFlower)
    .filter(cf => cf && cf.trim());

  if (flowers.length === 0) {
    return res.status(400).json({
      success: false,
      error: already.recordset[0].cnt > 0
        ? `[${week}] 이미 모두 확정 상태입니다. 변경하려면 먼저 확정 취소 후 진행하세요.`
        : `[${week}] 확정할 미확정 출고가 없습니다.`,
    });
  }

  // 3. 카테고리별로 SP 호출 — SP 가 자체 트랜잭션 처리
  const results = [];
  const errors = [];
  for (const cf of flowers) {
    try {
      const r = await query(
        `DECLARE @r INT, @m NVARCHAR(MAX);
         EXEC dbo.usp_ShipmentFix
              @OrderYear     = @yr,
              @OrderWeek     = @wk,
              @CountryFlower = @cf,
              @iUserID       = @uid,
              @oResult       = @r OUTPUT,
              @oMessage      = @m OUTPUT;
         SELECT @r AS result, @m AS message;`,
        {
          yr:  { type: sql.NVarChar, value: orderYear },
          wk:  { type: sql.NVarChar, value: orderWeek },
          cf:  { type: sql.NVarChar, value: cf },
          uid: { type: sql.NVarChar, value: uid },
        }
      );
      const row = r.recordset?.[0] || {};
      if (row.result === 0) {
        results.push({ countryFlower: cf, ok: true, message: row.message });
      } else {
        errors.push({ countryFlower: cf, code: row.result, message: row.message || 'unknown' });
      }
    } catch (e) {
      errors.push({ countryFlower: cf, code: -1, message: e.message });
    }
  }

  if (errors.length > 0 && results.length === 0) {
    return res.status(400).json({
      success: false,
      error: '확정 실패 — ' + errors.map(e => `[${e.countryFlower}] ${e.message}`).join(' / '),
      errors,
    });
  }

  return res.status(200).json({
    success: errors.length === 0,
    message: `[${week}] ${results.length}개 카테고리 확정 완료` +
             (errors.length > 0 ? ` (${errors.length}개 실패)` : ''),
    results,
    errors,
  });
}

// ── 확정 취소 — 전산 SP usp_ShipmentFixCancel 를 CountryFlower 단위 호출
async function unfix(req, res, week, prodKeyFilter) {
  if (prodKeyFilter) {
    return res.status(400).json({
      success: false,
      error: '품목 단위 부분 취소는 지원하지 않습니다. 차수 전체를 취소하세요.',
    });
  }

  const orderYear = deriveOrderYear(week);
  const orderWeek = deriveOrderWeek(week);
  const uid       = req.user?.userId || 'admin';

  try {
    // 후속 차수 확정 상태 경고 (웹 자체 안전장치, SP 와 무관)
    const laterFix = await query(
      `SELECT TOP 5 OrderWeek FROM StockMaster
        WHERE OrderWeek > @wk AND isFix=1
        ORDER BY OrderWeek`,
      { wk: { type: sql.NVarChar, value: orderWeek } }
    );
    const laterFixed = laterFix.recordset.map(r => r.OrderWeek);
    if (laterFixed.length > 0 && !req.body.force) {
      return res.status(400).json({
        success: false,
        warning: 'LATER_FIXED_EXISTS',
        laterWeeks: laterFixed,
        error: `후속 차수가 확정 상태입니다: ${laterFixed.join(', ')}\n` +
               `이 차수만 풀면 후속 차수 재고가 옛 값 기반으로 남습니다.\n` +
               `강제 진행: body.force=true 추가`,
      });
    }

    // 확정(DetailFix=1) 상태인 CountryFlower 목록
    const cfList = await query(
      `SELECT DISTINCT p.CountryFlower
         FROM ShipmentDetail sd
         JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
         JOIN Product p          ON sd.ProdKey = p.ProdKey AND p.isDeleted = 0
        WHERE sm.OrderWeek=@wk AND sm.isDeleted = 0
          AND ISNULL(sd.isFix, 0) = 1`,
      { wk: { type: sql.NVarChar, value: orderWeek } }
    );

    const flowers = cfList.recordset
      .map(r => r.CountryFlower)
      .filter(cf => cf && cf.trim());

    if (flowers.length === 0) {
      return res.status(200).json({
        success: true,
        message: `[${week}] 확정 취소 대상 없음 (이미 모두 미확정 상태)`,
        results: [],
      });
    }

    // 카테고리별 SP 호출
    const results = [];
    const errors = [];
    for (const cf of flowers) {
      try {
        const r = await query(
          `DECLARE @r INT, @m NVARCHAR(MAX);
           EXEC dbo.usp_ShipmentFixCancel
                @OrderYear     = @yr,
                @OrderWeek     = @wk,
                @CountryFlower = @cf,
                @iUserID       = @uid,
                @oResult       = @r OUTPUT,
                @oMessage      = @m OUTPUT;
           SELECT @r AS result, @m AS message;`,
          {
            yr:  { type: sql.NVarChar, value: orderYear },
            wk:  { type: sql.NVarChar, value: orderWeek },
            cf:  { type: sql.NVarChar, value: cf },
            uid: { type: sql.NVarChar, value: uid },
          }
        );
        const row = r.recordset?.[0] || {};
        if (row.result === 0) {
          results.push({ countryFlower: cf, ok: true, message: row.message });
        } else {
          errors.push({ countryFlower: cf, code: row.result, message: row.message || 'unknown' });
        }
      } catch (e) {
        errors.push({ countryFlower: cf, code: -1, message: e.message });
      }
    }

    return res.status(200).json({
      success: errors.length === 0,
      message: `[${week}] ${results.length}개 카테고리 확정 취소` +
               (errors.length > 0 ? ` (${errors.length}개 실패)` : '') +
               (laterFixed.length > 0 ? ` ⚠ 후속차수 ${laterFixed.join(',')} 재확정 권장` : ''),
      results,
      errors,
      laterFixed,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
