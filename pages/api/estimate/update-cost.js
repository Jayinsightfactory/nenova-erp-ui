// pages/api/estimate/update-cost.js
// P3: 견적서 단가 수정 API — atomic 워크플로우
//
// 흐름:
//   1) UPDATE ShipmentMaster SET isFix=0  (확정 해제)
//   2) 각 아이템에 대해 ShipmentDetail.Cost/Amount/Vat UPDATE
//      (Amount = ROUND(Bunch × Cost / 1.1), Vat = ROUND(Bunch × Cost / 11) — 14차 패턴)
//   3) mode 별 부가 저장 (fixed → CustomerProdCost, weekFav → WeekProdCost)
//   4) UPDATE ShipmentMaster SET isFix=1  (재확정)
//   5) 전 과정 단일 트랜잭션 — 중간 실패 시 전체 롤백
//
// Request body:
//   {
//     shipmentKey: 1234,                    // 대상 견적서(차수+거래처)
//     items: [                              // 여러 줄 동시 수정 가능
//       { sdetailKey: 555, cost: 1500 },
//       ...
//     ],
//     mode: 'once' | 'fixed' | 'weekFav',   // 저장 모드
//     week?: '15-02',                       // mode=weekFav 일 때 필요
//     custKey?: 42,                         // mode=fixed/weekFav 일 때 필요
//   }

import { withTransaction, sql, query } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

// ── WeekProdCost 테이블 idempotent 생성 (최초 1회)
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

  const { shipmentKey, items, mode, week, custKey } = req.body || {};

  if (!shipmentKey) {
    return res.status(400).json({ success: false, error: 'shipmentKey 필요' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, error: 'items 배열 필요' });
  }
  if (!['once', 'fixed', 'weekFav'].includes(mode)) {
    return res.status(400).json({ success: false, error: "mode 는 'once' | 'fixed' | 'weekFav'" });
  }
  if (mode === 'weekFav' && !week) {
    return res.status(400).json({ success: false, error: 'weekFav 모드: week 필요' });
  }
  if ((mode === 'fixed' || mode === 'weekFav') && !custKey) {
    return res.status(400).json({ success: false, error: 'fixed/weekFav: custKey 필요' });
  }

  // items 유효성 검사
  for (const it of items) {
    if (!it.sdetailKey || Number.isNaN(parseFloat(it.cost)) || parseFloat(it.cost) < 0) {
      return res.status(400).json({
        success: false,
        error: `items 각 항목은 { sdetailKey, cost(>=0) } 형식 필요`,
      });
    }
  }

  if (mode === 'weekFav') {
    await ensureWeekProdCostTable();
  }

  const uid = req.user?.userId || 'system';
  const userName = req.user?.userName || uid;
  const sk = parseInt(shipmentKey);

  try {
    const result = await withTransaction(async (tQ) => {
      // ── 1단계: ShipmentMaster 존재 확인 + 현재 상태 저장
      const smRow = await tQ(
        `SELECT ShipmentKey, CustKey, OrderWeek, ISNULL(isFix,0) AS isFix
           FROM ShipmentMaster WITH (UPDLOCK, HOLDLOCK)
          WHERE ShipmentKey=@sk AND ISNULL(isDeleted,0)=0`,
        { sk: { type: sql.Int, value: sk } }
      );
      if (smRow.recordset.length === 0) {
        throw new Error('ShipmentMaster 없음 또는 삭제됨');
      }
      const sm = smRow.recordset[0];
      const wasFixed = sm.isFix === 1;
      const smCustKey = sm.CustKey;
      const smWeek = sm.OrderWeek;

      // ── 2단계: 확정 해제 (원래 확정본이었다면)
      if (wasFixed) {
        await tQ(
          `UPDATE ShipmentMaster SET isFix=0 WHERE ShipmentKey=@sk`,
          { sk: { type: sql.Int, value: sk } }
        );
      }

      // ── 3단계: 각 ShipmentDetail 의 Cost/Amount/Vat 재계산 UPDATE
      const changes = [];
      for (const it of items) {
        const sdk = parseInt(it.sdetailKey);
        const newCost = parseFloat(it.cost);

        // 기존 값 조회 (ShipmentDetail 이 지정한 ShipmentKey 에 속하는지 검증)
        const cur = await tQ(
          `SELECT SdetailKey, ProdKey, ISNULL(BunchQuantity,0) AS BunchQty,
                  ISNULL(Cost,0) AS OldCost, ISNULL(Amount,0) AS OldAmount,
                  ISNULL(Vat,0) AS OldVat
             FROM ShipmentDetail
            WHERE SdetailKey=@sdk AND ShipmentKey=@sk`,
          { sdk: { type: sql.Int, value: sdk }, sk: { type: sql.Int, value: sk } }
        );
        if (cur.recordset.length === 0) {
          throw new Error(`SdetailKey=${sdk} 가 ShipmentKey=${sk} 에 없음`);
        }
        const row = cur.recordset[0];
        const bunchQty = row.BunchQty;
        const newAmount = Math.round(bunchQty * newCost / 1.1);
        const newVat    = Math.round(bunchQty * newCost / 11);

        const now = new Date();
        const ts = `${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
        const logLine = `\n[${ts} ${userName}] 단가 ${row.OldCost}→${newCost} (${mode})`;

        await tQ(
          `UPDATE ShipmentDetail
              SET Cost=@cost, Amount=@amount, Vat=@vat,
                  Descr = ISNULL(Descr,'') + @log
            WHERE SdetailKey=@sdk`,
          {
            sdk:    { type: sql.Int,      value: sdk },
            cost:   { type: sql.Float,    value: newCost },
            amount: { type: sql.Float,    value: newAmount },
            vat:    { type: sql.Float,    value: newVat },
            log:    { type: sql.NVarChar, value: logLine },
          }
        );

        changes.push({
          sdetailKey: sdk,
          prodKey: row.ProdKey,
          oldCost: row.OldCost,
          newCost,
          oldAmount: row.OldAmount,
          newAmount,
          oldVat: row.OldVat,
          newVat,
          bunchQty,
        });
      }

      // ── 4단계: 모드별 부가 저장 (CustomerProdCost / WeekProdCost)
      if (mode === 'fixed') {
        // 수정된 모든 품목을 거래처별 고정 단가에 UPSERT
        for (const ch of changes) {
          await tQ(
            `MERGE INTO CustomerProdCost AS t
             USING (VALUES (@ck, @pk, @cost)) AS s(CustKey, ProdKey, Cost)
                ON t.CustKey=s.CustKey AND t.ProdKey=s.ProdKey
             WHEN MATCHED THEN UPDATE SET Cost=s.Cost
             WHEN NOT MATCHED THEN INSERT (CustKey, ProdKey, Cost) VALUES (s.CustKey, s.ProdKey, s.Cost);`,
            {
              ck:   { type: sql.Int,   value: parseInt(custKey) },
              pk:   { type: sql.Int,   value: ch.prodKey },
              cost: { type: sql.Float, value: ch.newCost },
            }
          );
        }
      } else if (mode === 'weekFav') {
        // 수정된 모든 품목을 해당 차수 즐겨찾기에 UPSERT
        for (const ch of changes) {
          await tQ(
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
              pk:   { type: sql.Int,      value: ch.prodKey },
              cost: { type: sql.Float,    value: ch.newCost },
              uid:  { type: sql.NVarChar, value: uid },
            }
          );
        }
      }

      // ── 5단계: 원래 확정본이었다면 재확정
      if (wasFixed) {
        await tQ(
          `UPDATE ShipmentMaster SET isFix=1 WHERE ShipmentKey=@sk`,
          { sk: { type: sql.Int, value: sk } }
        );
      }

      // 집계
      const totalOldAmount = changes.reduce((a, c) => a + (c.oldAmount || 0), 0);
      const totalNewAmount = changes.reduce((a, c) => a + (c.newAmount || 0), 0);
      const totalOldVat    = changes.reduce((a, c) => a + (c.oldVat    || 0), 0);
      const totalNewVat    = changes.reduce((a, c) => a + (c.newVat    || 0), 0);

      return {
        shipmentKey: sk,
        custKey: smCustKey,
        week: smWeek,
        wasFixed,
        changedCount: changes.length,
        changes,
        totalOldAmount,
        totalNewAmount,
        diffAmount: totalNewAmount - totalOldAmount,
        totalOldVat,
        totalNewVat,
        diffVat: totalNewVat - totalOldVat,
      };
    });

    return res.status(200).json({
      success: true,
      mode,
      message: `단가 수정 완료 (${result.changedCount}건, 공급가 ${result.diffAmount >= 0 ? '+' : ''}${result.diffAmount.toLocaleString()}원)`,
      ...result,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
