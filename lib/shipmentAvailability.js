export const SHIPMENT_QTY_SCALE = 1000;
export const SHIPMENT_QTY_EPSILON = 1 / SHIPMENT_QTY_SCALE;

export function normalizeShipmentQty(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  const normalized = Math.round(number * SHIPMENT_QTY_SCALE) / SHIPMENT_QTY_SCALE;
  return Math.abs(normalized) < SHIPMENT_QTY_EPSILON ? 0 : normalized;
}

export function calculateShipmentAvailability({
  prevStock = 0,
  currentIn = 0,
  adjustQty = 0,
  totalOut = 0,
  changedOutBefore = 0,
  changedOutAfter = 0,
} = {}) {
  const quantities = {
    prevStock: normalizeShipmentQty(prevStock),
    currentIn: normalizeShipmentQty(currentIn),
    adjustQty: normalizeShipmentQty(adjustQty),
    totalOut: normalizeShipmentQty(totalOut),
  };
  const available = normalizeShipmentQty(
    quantities.prevStock + quantities.currentIn + quantities.adjustQty,
  );
  const remainAfter = normalizeShipmentQty(available - quantities.totalOut);
  const remainBefore = normalizeShipmentQty(
    available - (quantities.totalOut - normalizeShipmentQty(changedOutAfter) + normalizeShipmentQty(changedOutBefore)),
  );

  return { ...quantities, available, remainBefore, remainAfter };
}

export function hasInsufficientShipmentStock(remainAfter) {
  return normalizeShipmentQty(remainAfter) < 0;
}
