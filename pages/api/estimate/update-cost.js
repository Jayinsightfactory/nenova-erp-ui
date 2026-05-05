// pages/api/estimate/update-cost.js
// P3: 견적서 단가 수정 API — 단일 트랜잭션 atomic 워크플로우 + 낙관적 동시성 제어
//
// 핵심: 견적서 한 건(거래처+차수 그룹)은 여러 세부차수(15-01, 15-02 등)에 걸쳐
//       여러 ShipmentKey 로 나뉘어 있을 수 있음. 같은 품목이 양쪽에 있을 수도.
//       전체를 **단일 트랜잭션**으로 처리해야 부분 적용 없이 원자성 보장.
//
// 흐름 (단일 트랜잭션):
//   1) items 를 ShipmentKey 별로 grouping
//   2) 각 ShipmentKey 에 대해 isFix 상태 조회 + 확정본이면 isFix=0 (UPDLOCK)
//   3) 각 item (sdetailKey+shipmentKey 쌍) 에 대해:
//      a. 현재 DB Cost/BunchQty 조회 (UPDLOCK)
//      b. expectedOldCost 와 비교 (STALE_DATA 감지 → throw)
//      c. Cost/Amount/Vat UPDATE
//   4) mode 별 부가 저장 (fixed → CustomerProdCost, weekFav → WeekProdCost)
//   5) 1단계에서 확정본이었던 모든 ShipmentKey 에 대해 isFix=1 재확정
//   중간 실패 시 전체 롤백 → DB 에 아무 흔적 없음
//
// Request body (신규 형식 — shipmentKey 가 items 안으로 이동):
//   {
//     items: [
//       { shipmentKey: 4003, sdetailKey: 555, cost: 1500, expectedOldCost: 1200 },
//       { shipmentKey: 4042, sdetailKey: 777, cost: 1500, expectedOldCost: 1200 },
//       ...
//     ],
//     mode: 'once' | 'fixed' | 'weekFav',
//     week?: '15-02',     // mode=weekFav 일 때 필요 (특정 세부차수용)
//     custKey?: 42,       // mode=fixed/weekFav 일 때 필요
//   }
//
// 하위호환: shipmentKey 가 최상위로 전달되면 items 전체에 그 값을 브로드캐스트

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

  const { shipmentKey: topSk, items: rawItems, mode, week, custKey } = req.body || {};

  if (!Array.isArray(rawItems) || rawItems.length === 0) {
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

  // items 정규화: 각 item 은 shipmentKey 가 있어야 함 (없으면 최상위 topSk 브로드캐스트)
  const items = [];
  for (const it of rawItems) {
    const sdk = parseInt(it.sdetailKey);
    const itSk = it.shipmentKey != null ? parseInt(it.shipmentKey) : (topSk ? parseInt(topSk) : null);
    const cost = parseFloat(it.cost);
    if (!sdk || !itSk || Number.isNaN(cost) || cost < 0) {
      return res.status(400).json({
        success: false,
        error: `items 각 항목은 { shipmentKey, sdetailKey, cost(>=0) } 필요 (문제 항목: ${JSON.stringify(it)})`,
      });
    }
    items.push({
      sdetailKey: sdk,
      shipmentKey: itSk,
      cost,
      expectedOldCost: it.expectedOldCost != null ? parseFloat(it.expectedOldCost) : null,
    });
  }

  // ShipmentKey 유니크 목록
  const uniqueSks = [...new Set(items.map(i => i.shipmentKey))];

  if (mode === 'weekFav') {
    await ensureWeekProdCostTable();
  }

  const uid = req.user?.userId || 'system';
  const userName = req.user?.userName || uid;

  try {
    const result = await withTransaction(async (tQ) => {
      // ── 1단계: 모든 관련 ShipmentMaster 조회 + 잠금 (UPDLOCK + HOLDLOCK)
      const smMap = {}; // sk → { wasFixed, custKey, orderWeek }
      for (const sk of uniqueSks) {
        const smRow = await tQ(
          `SELECT ShipmentKey, CustKey, OrderWeek, ISNULL(isFix,0) AS isFix
             FROM ShipmentMaster WITH (UPDLOCK, HOLDLOCK)
            WHERE ShipmentKey=@sk AND ISNULL(isDeleted,0)=0`,
          { sk: { type: sql.Int, value: sk } }
        );
        if (smRow.recordset.length === 0) {
          throw new Error(`ShipmentKey=${sk} 없음 또는 삭제됨`);
        }
        const row = smRow.recordset[0];
        smMap[sk] = {
          wasFixed: row.isFix === 1 || row.isFix === true,
          custKey: row.CustKey,
          orderWeek: row.OrderWeek,
        };
      }

      // ── 2단계: 확정본이었던 모든 ShipmentMaster 를 한번에 해제
      const fixedSks = uniqueSks.filter(sk => smMap[sk].wasFixed);
      for (const sk of fixedSks) {
        await tQ(
          `UPDATE ShipmentMaster SET isFix=0 WHERE ShipmentKey=@sk`,
          { sk: { type: sql.Int, value: sk } }
        );
      }

      // ── 3단계: 모든 ShipmentDetail 에 대해 낙관적 동시성 검증 + Cost/Amount/Vat UPDATE
      const changes = [];
      for (const it of items) {
        // 기존 값 조회 (UPDLOCK) — Box/Bunch/Steam 모두 가져와서 Amount 계산 안전화
        const cur = await tQ(
          `SELECT SdetailKey, ProdKey,
                  ISNULL(BunchQuantity,0) AS BunchQty,
                  ISNULL(BoxQuantity,0)   AS BoxQty,
                  ISNULL(SteamQuantity,0) AS SteamQty,
                  ISNULL(OutQuantity,0)   AS OutQty,
                  ISNULL(Cost,0) AS OldCost, ISNULL(Amount,0) AS OldAmount,
                  ISNULL(Vat,0) AS OldVat
             FROM ShipmentDetail WITH (UPDLOCK, HOLDLOCK)
            WHERE SdetailKey=@sdk AND ShipmentKey=@sk`,
          { sdk: { type: sql.Int, value: it.sdetailKey }, sk: { type: sql.Int, value: it.shipmentKey } }
        );
        if (cur.recordset.length === 0) {
          throw new Error(`SdetailKey=${it.sdetailKey} 가 ShipmentKey=${it.shipmentKey} 에 없음`);
        }
        const row = cur.recordset[0];

        // 낙관적 동시성: 조회시점 snapshot 과 현재 DB 값 일치 검증
        if (it.expectedOldCost != null && Math.abs(row.OldCost - it.expectedOldCost) > 0.001) {
          const err = new Error(
            `STALE_DATA: SdetailKey=${it.sdetailKey} (ShipmentKey=${it.shipmentKey}) 의 단가가 조회 이후 변경되었습니다 ` +
            `(조회시점=${it.expectedOldCost} → 현재=${row.OldCost}). ` +
            `다른 사용자 또는 전산 프로그램이 값을 수정했을 수 있습니다. 재조회 후 다시 시도해주세요.`
          );
          err.code = 'STALE_DATA';
          err.sdetailKey = it.sdetailKey;
          err.shipmentKey = it.shipmentKey;
          err.expected = it.expectedOldCost;
          err.actual = row.OldCost;
          throw err;
        }

        // 금액 계산 기준수량 — Bunch>0 우선, 없으면 Steam, 마지막 Box (BunchQty=0 박스단위 품목 케이스 보정)
        // 옛 코드는 Bunch만 봤기 때문에 박스단위 품목에서 Amount=0 으로 잘못 갱신되던 버그 수정
        const bunchQty = row.BunchQty;
        const baseQty = bunchQty > 0 ? bunchQty
                      : row.SteamQty > 0 ? row.SteamQty
                      : row.BoxQty > 0 ? row.BoxQty
                      : (row.OutQty || 0);
        const newAmount = Math.round(baseQty * it.cost / 1.1);
        const newVat    = Math.round(baseQty * it.cost / 11);

        const now = new Date();
        const ts = `${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
        const logLine = `\n[${ts} ${userName}] 단가 ${row.OldCost}→${it.cost} (${mode})`;

        await tQ(
          `UPDATE ShipmentDetail
              SET Cost=@cost, Amount=@amount, Vat=@vat,
                  Descr = ISNULL(Descr,'') + @log
            WHERE SdetailKey=@sdk`,
          {
            sdk:    { type: sql.Int,      value: it.sdetailKey },
            cost:   { type: sql.Float,    value: it.cost },
            amount: { type: sql.Float,    value: newAmount },
            vat:    { type: sql.Float,    value: newVat },
            log:    { type: sql.NVarChar, value: logLine },
          }
        );

        changes.push({
          sdetailKey: it.sdetailKey,
          shipmentKey: it.shipmentKey,
          orderWeek: smMap[it.shipmentKey].orderWeek,
          prodKey: row.ProdKey,
          oldCost: row.OldCost,
          newCost: it.cost,
          oldAmount: row.OldAmount,
          newAmount,
          oldVat: row.OldVat,
          newVat,
          bunchQty,
        });
      }

      // ── 4단계: 모드별 부가 저장 (CustomerProdCost / WeekProdCost)
      // 같은 품목이 여러 차수에 있으면 같은 prodKey 가 중복될 수 있음 → Set 으로 dedup
      if (mode === 'fixed') {
        const seen = new Set();
        for (const ch of changes) {
          if (seen.has(ch.prodKey)) continue;
          seen.add(ch.prodKey);
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
        // weekFav 는 해당 week + prodKey 조합 단위로 dedup
        const seen = new Set();
        for (const ch of changes) {
          const key = `${week}:${ch.prodKey}`;
          if (seen.has(key)) continue;
          seen.add(key);
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

      // ── 5단계: 원래 확정본이었던 ShipmentMaster 는 재확정
      for (const sk of fixedSks) {
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
        shipmentKeys: uniqueSks,
        fixedShipmentKeys: fixedSks,
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
      message: `단가 수정 완료 (${result.changedCount}건, ${result.shipmentKeys.length}개 차수, 공급가 ${result.diffAmount >= 0 ? '+' : ''}${result.diffAmount.toLocaleString()}원)`,
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
        shipmentKey: err.shipmentKey,
        expected: err.expected,
        actual: err.actual,
      });
    }
    return res.status(500).json({ success: false, error: err.message });
  }
});
