export function assertShipmentDistributionVerification({
  expectedQty,
  detailCount,
  detailQty,
  dateQty,
  tolerance = 0.0001,
}) {
  const expected = Number(expectedQty || 0);
  const count = Number(detailCount || 0);
  const detail = Number(detailQty || 0);
  const date = Number(dateQty || 0);
  const ok = expected <= 0
    ? count === 0 && Math.abs(detail) <= tolerance && Math.abs(date) <= tolerance
    : count === 1 && Math.abs(detail - expected) <= tolerance && Math.abs(date - expected) <= tolerance;
  if (!ok) {
    const error = new Error(`요청 ${expected}, 상세 ${detail}, 출고일 ${date}, 상세행 ${count}`);
    error.code = 'SHIPMENT_DISTRIBUTION_VERIFY_FAILED';
    throw error;
  }
  return { detailCount: count, detailQty: detail, dateQty: date };
}
