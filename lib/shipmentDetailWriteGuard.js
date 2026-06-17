/** OutQuantity=0 ShipmentDetail 유령행 — 쓰기 경로 차단·정리 (nenova.exe / 견적과 동일) */

export const SHIPMENT_OUT_QTY_EPS = 0.0001;

export function isActiveShipmentOutQty(qty) {
  return Number(qty) > SHIPMENT_OUT_QTY_EPS;
}

/** INSERT 허용 — 양수 OutQuantity만 Detail 행 생성 */
export function canInsertShipmentDetail(outQty) {
  return isActiveShipmentOutQty(outQty);
}

/**
 * OutQuantity=0 유령 Detail + 연결 ShipmentDate 삭제.
 * ShipmentHistory 는 감사용으로 유지.
 */
export async function purgeZeroOutShipmentDetail(tQ, sdetailKey, sql) {
  const dk = Number(sdetailKey);
  if (!Number.isFinite(dk) || dk <= 0) return { deleted: false, reason: 'invalid-key' };

  await tQ(`DELETE FROM ShipmentDate WHERE SdetailKey=@dk`, { dk: { type: sql.Int, value: dk } });
  const del = await tQ(`DELETE FROM ShipmentDetail WHERE SdetailKey=@dk`, { dk: { type: sql.Int, value: dk } });
  const rowsAffected = del?.rowsAffected?.[0] ?? del?.rowsAffected ?? 0;
  return { deleted: rowsAffected > 0, rowsAffected };
}
