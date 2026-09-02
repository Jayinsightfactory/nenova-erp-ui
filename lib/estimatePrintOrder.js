export function getEstimateShipmentManager(ship) {
  const manager = String(ship?.Manager || '').trim();
  return manager || '담당자 미지정';
}

// 견적서관리 담당자→업체 선택의 공통 필터. 서버가 반환한 Manager만 사용해
// 업체명 검색 결과와 섞이지 않도록 하며, 미지정 업체도 별도 그룹으로 유지한다.
export function filterEstimateShipmentsByManager(shipments = [], manager = '') {
  const wanted = String(manager || '').trim();
  if (!wanted) return [...shipments];
  return shipments.filter((ship) => getEstimateShipmentManager(ship) === wanted);
}

export function filterEstimateShipmentsByCustomer(shipments = [], custKey = '') {
  if (custKey === '' || custKey === null || custKey === undefined) return [...shipments];
  return shipments.filter((ship) => Number(ship?.CustKey) === Number(custKey));
}

export function listEstimateShipmentCustomers(shipments = []) {
  const byCustomer = new Map();
  shipments.forEach((ship) => {
    const custKey = Number(ship?.CustKey);
    if (!Number.isFinite(custKey)) return;
    const current = byCustomer.get(custKey);
    const amount = Number(ship?.totalAmount || 0);
    if (!current) {
      byCustomer.set(custKey, {
        CustKey: custKey,
        CustName: String(ship?.CustName || '').trim() || `업체 #${custKey}`,
        totalAmount: amount,
      });
    } else {
      current.totalAmount += amount;
    }
  });
  return sortEstimateShipmentsForList([...byCustomer.values()]);
}

export function listEstimateShipmentManagers(shipments = []) {
  return [...new Set(shipments.map(getEstimateShipmentManager))]
    .sort((a, b) => {
      if (a === '담당자 미지정') return 1;
      if (b === '담당자 미지정') return -1;
      return a.localeCompare(b, 'ko', { numeric: true, sensitivity: 'base' });
    });
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

export function sortEstimateShipmentsForList(shipments = []) {
  const options = { numeric: true, sensitivity: 'base' };
  return [...shipments].sort((a, b) => {
    const amountDiff = Number(b?.totalAmount || 0) - Number(a?.totalAmount || 0);
    if (amountDiff !== 0) return amountDiff;
    const customerDiff = String(a?.CustName || '').trim().localeCompare(String(b?.CustName || '').trim(), 'ko', options);
    if (customerDiff !== 0) return customerDiff;
    return Number(a?.CustKey || 0) - Number(b?.CustKey || 0);
  });
}
