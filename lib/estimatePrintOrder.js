export function getEstimateShipmentManager(ship) {
  const manager = String(ship?.Manager || '').trim();
  return manager || '담당자 미지정';
}

export function compareEstimateShipmentsForPrint(a, b) {
  const options = { numeric: true, sensitivity: 'base' };
  const aMissing = String(a?.Manager || '').trim() ? 0 : 1;
  const bMissing = String(b?.Manager || '').trim() ? 0 : 1;
  if (aMissing !== bMissing) return aMissing - bMissing;
  const managerDiff = getEstimateShipmentManager(a).localeCompare(getEstimateShipmentManager(b), 'ko', options);
  if (managerDiff !== 0) return managerDiff;
  const customerDiff = String(a?.CustName || '').trim().localeCompare(String(b?.CustName || '').trim(), 'ko', options);
  if (customerDiff !== 0) return customerDiff;
  return Number(a?.CustKey || 0) - Number(b?.CustKey || 0);
}

export function sortEstimateShipmentsForPrint(shipments = []) {
  return [...shipments].sort(compareEstimateShipmentsForPrint);
}
