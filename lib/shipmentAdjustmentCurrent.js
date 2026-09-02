import { sql } from './db.js';

// 붙여넣기 예상값과 실제 adjust 저장이 반드시 같은 ShipmentMaster를 선택하도록
// 이 조회를 공용화한다. 같은 업체·연도·차수에 레거시 마스터가 여러 개일 수 있다.
// 선택 품목의 양수 ShipmentDetail이 다른 활성 마스터에 있으면 그 마스터가 실제
// 취소/증가 대상이다. 품목행이 전혀 없을 때만 기존 EXE 호환 우선순위
// (확정 마스터 -> 가장 오래된 마스터)로 신규 상세행의 소유 마스터를 정한다.
export async function loadShipmentAdjustmentCurrent(q, {
  orderYear,
  orderWeek,
  custKey,
  prodKey,
  lock = false,
} = {}) {
  const lockHint = lock ? ' WITH (UPDLOCK, HOLDLOCK)' : '';
  const master = await q(
    `SELECT TOP 1 sm.ShipmentKey, ISNULL(sm.isFix,0) AS isFix
       FROM ShipmentMaster sm${lockHint}
      WHERE sm.CustKey=@ck AND sm.OrderYear=@yr AND sm.OrderWeek=@wk AND ISNULL(sm.isDeleted,0)=0
      ORDER BY CASE WHEN EXISTS (
                 SELECT 1
                   FROM ShipmentDetail sd
                  WHERE sd.ShipmentKey=sm.ShipmentKey
                    AND sd.ProdKey=@pk
                    AND ISNULL(sd.OutQuantity,0)>0
               ) THEN 0 ELSE 1 END,
               ISNULL(sm.isFix,0) DESC,
               sm.ShipmentKey ASC`,
    {
      ck: { type: sql.Int, value: Number(custKey) },
      yr: { type: sql.NVarChar, value: String(orderYear) },
      wk: { type: sql.NVarChar, value: String(orderWeek) },
      pk: { type: sql.Int, value: Number(prodKey || 0) },
    },
  );
  const masterRow = master.recordset[0] || null;
  if (!masterRow || !prodKey) return { master: masterRow, detail: null };

  const detail = await q(
    `SELECT TOP 1 SdetailKey,
            ISNULL(BoxQuantity,0) AS curBox,
            ISNULL(BunchQuantity,0) AS curBunch,
            ISNULL(SteamQuantity,0) AS curSteam,
            ISNULL(OutQuantity,0) AS curOut,
            ISNULL(Cost,0) AS curCost,
            ISNULL(Descr,'') AS curDescr
       FROM ShipmentDetail${lockHint}
      WHERE ShipmentKey=@sk AND ProdKey=@pk
      ORDER BY CASE WHEN ISNULL(OutQuantity,0)>0 THEN 0 ELSE 1 END,
               SdetailKey ASC`,
    {
      sk: { type: sql.Int, value: Number(masterRow.ShipmentKey) },
      pk: { type: sql.Int, value: Number(prodKey) },
    },
  );
  return { master: masterRow, detail: detail.recordset[0] || null };
}
