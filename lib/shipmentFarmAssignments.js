// Nenova.exe ClassShipmentFarm 호환 농장배정 계약.
//
// exe FormShipmentDistribution.btnSave_Click 흐름:
//   FarmKey + ShipmentQuantity + SdetailKey 를 ShipmentFarm에 저장
// 웹은 FarmKey를 추측하지 않고 ViewWarehouse -> Farm 조회 결과만 허용한다.

export function normalizeFarmAssignments(input) {
  if (!Array.isArray(input)) return null;
  const byFarm = new Map();
  for (const raw of input) {
    const farmKey = Number(raw?.farmKey ?? raw?.FarmKey);
    const quantity = Number(raw?.shipmentQuantity ?? raw?.ShipmentQuantity ?? raw?.qty);
    if (!Number.isInteger(farmKey) || farmKey <= 0) {
      throw new Error('FarmKey는 양의 정수여야 합니다.');
    }
    if (!Number.isFinite(quantity) || quantity < 0) {
      throw new Error(`FarmKey ${farmKey}의 농장 배분수량이 잘못되었습니다.`);
    }
    byFarm.set(farmKey, (byFarm.get(farmKey) || 0) + quantity);
  }
  return [...byFarm.entries()]
    .map(([farmKey, shipmentQuantity]) => ({ farmKey, shipmentQuantity }))
    .filter((row) => row.shipmentQuantity > 0);
}

export function farmAssignmentTotal(assignments) {
  return (assignments || []).reduce((sum, row) => sum + Number(row.shipmentQuantity || 0), 0);
}

export function assertFarmAssignmentTotal(assignments, outQuantity, tolerance = 0.001) {
  const total = farmAssignmentTotal(assignments);
  const target = Number(outQuantity || 0);
  if (Math.abs(total - target) > tolerance) {
    throw new Error(`농장 배분 합계(${total})가 출고수량(${target})과 다릅니다.`);
  }
  return total;
}

