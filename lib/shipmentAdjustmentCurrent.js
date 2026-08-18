import { sql } from './db.js';

// 붙여넣기 예상값과 실제 adjust 저장이 반드시 같은 ShipmentMaster를 선택하도록
// 이 조회를 공용화한다. 같은 업체·연도·차수에 레거시 마스터가 여러 개일 수 있다.
export async function loadShipmentAdjustmentCurrent(q, {
  orderYear,
  orderWeek,
  custKey,
  prodKey,
  lock = false,
} = {}) {
  const lockHint = lock ? ' WITH (UPDLOCK, HOLDLOCK)' : '';
  const master = await q(
    `SELECT TOP 1 ShipmentKey, ISNULL(isFix,0) AS isFix
       FROM ShipmentMaster${lockHint}
      WHERE CustKey=@ck AND OrderYear=@yr AND OrderWeek=@wk AND isDeleted=0
      ORDER BY ISNULL(isFix,0) DESC, ShipmentKey ASC`,
    {
      ck: { type: sql.Int, value: Number(custKey) },
      yr: { type: sql.NVarChar, value: String(orderYear) },
      wk: { type: sql.NVarChar, value: String(orderWeek) },
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
      ORDER BY SdetailKey ASC`,
    {
      sk: { type: sql.Int, value: Number(masterRow.ShipmentKey) },
      pk: { type: sql.Int, value: Number(prodKey) },
    },
  );
  return { master: masterRow, detail: detail.recordset[0] || null };
}
