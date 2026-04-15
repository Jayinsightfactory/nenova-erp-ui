// pages/api/estimate/update-cost.js
// P3: 견적서 단가 수정 API — 수정 모드 3가지 지원
//   mode = 'once'    → ShipmentDetail.Cost UPDATE (해당 출고건만, 1회성)
//   mode = 'fixed'   → CustomerProdCost UPSERT (이후 모든 차수 고정)
//   mode = 'weekFav' → WeekProdCost UPSERT (해당 차수+거래처+품목만, 매차수 즐겨찾기)
//
// 14차 패턴 유지:
//   - ShipmentDetail.Amount/Vat 는 BunchQuantity × Cost / 1.1 (13/14차 데이터 패턴)
//   - once 모드 저장 시 Amount/Vat 동시 재계산

import { query, withTransaction, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

// ── WeekProdCost 테이블 idempotent 생성 (estimate/index.js 와 동일)
let _wpcEnsured = null;
async function ensureWeekProdCostTable() {
  if (_wpcEnsured) return _wpcEnsured;
  _wpcEnsured = (async () => {
    try {
      await query(
        `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='WeekProdCost')
         BEGIN
           CREATE TABLE WeekProdCost (
             AutoKey INT IDENTITY(1,1) PRIMARY KEY,
             OrderWeek NVARCHAR(10) NOT NULL,
             CustKey INT NOT NULL,
             ProdKey INT NOT NULL,
             Cost FLOAT NOT NULL,
             CreatedAt DATETIME DEFAULT GETDATE(),
             UpdatedAt DATETIME DEFAULT GETDATE(),
             UpdatedBy NVARCHAR(50)
           );
           CREATE UNIQUE INDEX IX_WeekProdCost_Lookup
             ON WeekProdCost(OrderWeek, CustKey, ProdKey);
         END`,
        {}
      );
    } catch (e) {
      console.warn('[update-cost] WeekProdCost 테이블 생성 스킵:', e.message);
    }
  })();
  return _wpcEnsured;
}

export default withAuth(async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  await ensureWeekProdCostTable();

  const { shipmentKey, prodKey, custKey, week, cost, mode } = req.body || {};
  const c = parseFloat(cost);

  if (!prodKey || !custKey || Number.isNaN(c) || c < 0) {
    return res.status(400).json({ success: false, error: 'prodKey, custKey, cost 필요' });
  }
  if (!['once', 'fixed', 'weekFav'].includes(mode)) {
    return res.status(400).json({ success: false, error: "mode 는 'once' | 'fixed' | 'weekFav'" });
  }
  if (mode === 'once' && !shipmentKey) {
    return res.status(400).json({ success: false, error: 'once 모드: shipmentKey 필요' });
  }
  if (mode === 'weekFav' && !week) {
    return res.status(400).json({ success: false, error: 'weekFav 모드: week 필요' });
  }

  const uid = req.user?.userId || 'system';

  try {
    if (mode === 'once') {
      // 1회성: 해당 ShipmentDetail 한 건의 Cost/Amount/Vat 재계산
      // Amount = BunchQuantity × Cost / 1.1, Vat = BunchQuantity × Cost / 11 (14차 패턴)
      await withTransaction(async (tQ) => {
        // 기존 수량 조회
        const r = await tQ(
          `SELECT SdetailKey, ISNULL(BunchQuantity,0) AS BunchQty
             FROM ShipmentDetail
            WHERE ShipmentKey=@sk AND ProdKey=@pk`,
          { sk: { type: sql.Int, value: parseInt(shipmentKey) },
            pk: { type: sql.Int, value: parseInt(prodKey) } }
        );
        if (r.recordset.length === 0) {
          throw new Error('해당 ShipmentDetail 없음');
        }
        for (const row of r.recordset) {
          const bunchQty = row.BunchQty || 0;
          const amount = Math.round(bunchQty * c / 1.1);
          const vat    = Math.round(bunchQty * c / 11);
          await tQ(
            `UPDATE ShipmentDetail
                SET Cost=@cost, Amount=@amount, Vat=@vat
              WHERE SdetailKey=@sdk`,
            { sdk:    { type: sql.Int,   value: row.SdetailKey },
              cost:   { type: sql.Float, value: c },
              amount: { type: sql.Float, value: amount },
              vat:    { type: sql.Float, value: vat } }
          );
        }
      });
      return res.status(200).json({ success: true, mode, message: '1회성 단가 수정 완료' });
    }

    if (mode === 'fixed') {
      // 고정: CustomerProdCost UPSERT (이후 차수 기본값)
      // 기존 ShipmentDetail.Cost 는 건드리지 않음 (이미 확정된 건은 그대로)
      await query(
        `MERGE INTO CustomerProdCost AS t
         USING (VALUES (@ck, @pk, @cost)) AS s(CustKey, ProdKey, Cost)
            ON t.CustKey=s.CustKey AND t.ProdKey=s.ProdKey
         WHEN MATCHED THEN UPDATE SET Cost=s.Cost
         WHEN NOT MATCHED THEN INSERT (CustKey, ProdKey, Cost) VALUES (s.CustKey, s.ProdKey, s.Cost);`,
        {
          ck:   { type: sql.Int,   value: parseInt(custKey) },
          pk:   { type: sql.Int,   value: parseInt(prodKey) },
          cost: { type: sql.Float, value: c },
        }
      );
      return res.status(200).json({ success: true, mode, message: '거래처 고정 단가 저장 완료' });
    }

    if (mode === 'weekFav') {
      // 매차수 즐겨찾기: WeekProdCost UPSERT (해당 차수만 고정)
      await query(
        `MERGE INTO WeekProdCost AS t
         USING (VALUES (@wk, @ck, @pk, @cost)) AS s(OrderWeek, CustKey, ProdKey, Cost)
            ON t.OrderWeek=s.OrderWeek AND t.CustKey=s.CustKey AND t.ProdKey=s.ProdKey
         WHEN MATCHED THEN
           UPDATE SET Cost=s.Cost, UpdatedAt=GETDATE(), UpdatedBy=@uid
         WHEN NOT MATCHED THEN
           INSERT (OrderWeek, CustKey, ProdKey, Cost, UpdatedBy)
           VALUES (s.OrderWeek, s.CustKey, s.ProdKey, s.Cost, @uid);`,
        {
          wk:   { type: sql.NVarChar, value: week },
          ck:   { type: sql.Int,      value: parseInt(custKey) },
          pk:   { type: sql.Int,      value: parseInt(prodKey) },
          cost: { type: sql.Float,    value: c },
          uid:  { type: sql.NVarChar, value: uid },
        }
      );
      return res.status(200).json({ success: true, mode, message: '차수별 단가(즐겨찾기) 저장 완료' });
    }
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
