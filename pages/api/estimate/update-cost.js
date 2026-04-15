// pages/api/estimate/update-cost.js
// P3: 견적서 단가 수정 API — atomic 워크플로우 + 낙관적 동시성 제어
//
// 흐름:
//   1) UPDATE ShipmentMaster SET isFix=0  (확정 해제)
//   2) 각 아이템에 대해:
//      a. 현재 DB Cost/Amount/Vat 조회 (UPDLOCK)
//      b. 조회시점 snapshot(expectedOldCost/Amount/Vat) 와 비교
//      c. 불일치 시 전체 트랜잭션 throw → 롤백 (다른 사용자/전산 수정 감지)
//      d. 정상이면 ShipmentDetail.Cost/Amount/Vat UPDATE
//         (Amount = ROUND(Bunch × Cost / 1.1), Vat = ROUND(Bunch × Cost / 11))
//   3) mode 별 부가 저장 (fixed → CustomerProdCost, weekFav → WeekProdCost)
//   4) UPDATE ShipmentMaster SET isFix=1  (재확정)
//   5) 전 과정 단일 트랜잭션 — 중간 실패 시 전체 롤백
//
// Request body:
//   {
//     shipmentKey: 1234,
//     items: [
//       { sdetailKey: 555, cost: 1500, expectedOldCost: 1200 },
//       ...
//     ],
//     mode: 'once' | 'fixed' | 'weekFav',
//     week?: '15-02',
//     custKey?: 42,
//   }
//
// 낙관적 동시성 (expectedOldCost):
//   - 클라이언트가 "조회" 버튼 눌렀을 때의 스냅샷 Cost 를 함께 전송
//   - 서버가 UPDATE 전 현재 DB Cost 와 비교
//   - 불일치 시 "데이터가 변경되었습니다. 재조회 후 다시 시도해주세요" 에러 → 전체 롤백
//   - expectedOldCost 미전달 시 검증 스킵 (하위호환)

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
      // 낙관적 동시성 체크 — 전부 선행 검증 후 UPDATE (한 건이라도 불일치면 전체 롤백)
      const changes = [];
      for (const it of items) {
        const sdk = parseInt(it.sdetailKey);
        const newCost = parseFloat(it.cost);
        const expectedOldCost = it.expectedOldCost != null ? parseFloat(it.expectedOldCost) : null;

        // 기존 값 조회 (UPDLOCK — 이 트랜잭션 내에서 다른 UPDATE 가 끼어들지 못함)
        const cur = await tQ(
          `SELECT SdetailKey, ProdKey, ISNULL(BunchQuantity,0) AS BunchQty,
                  ISNULL(Cost,0) AS OldCost, ISNULL(Amount,0) AS OldAmount,
                  ISNULL(Vat,0) AS OldVat
             FROM ShipmentDetail WITH (UPDLOCK, HOLDLOCK)
            WHERE SdetailKey=@sdk AND ShipmentKey=@sk`,
          { sdk: { type: sql.Int, value: sdk }, sk: { type: sql.Int, value: sk } }
        );
        if (cur.recordset.length === 0) {
          throw new Error(`SdetailKey=${sdk} 가 ShipmentKey=${sk} 에 없음`);
        }
        const row = cur.recordset[0];

        // 낙관적 동시성 검증: 조회시점 Cost 와 현재 DB Cost 가 같아야 함
        if (expectedOldCost != null && Math.abs(row.OldCost - expectedOldCost) > 0.001) {
          const err = new Error(
            `STALE_DATA: SdetailKey=${sdk} 의 단가가 조회 이후 변경되었습니다 ` +
            `(조회시점=${expectedOldCost} → 현재=${row.OldCost}). ` +
            `다른 사용자 또는 전산 프로그램이 값을 수정했을 수 있습니다. 재조회 후 다시 시도해주세요.`
          );
          err.code = 'STALE_DATA';
          err.sdetailKey = sdk;
          err.expected = expectedOldCost;
          err.actual = row.OldCost;
          throw err;
        }

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
    // STALE_DATA 는 409 Conflict, 그 외는 500
    if (err.code === 'STALE_DATA') {
      return res.status(409).json({
        success: false,
        code: 'STALE_DATA',
        error: err.message,
        sdetailKey: err.sdetailKey,
        expected: err.expected,
        actual: err.actual,
      });
    }
    return res.status(500).json({ success: false, error: err.message });
  }
});
