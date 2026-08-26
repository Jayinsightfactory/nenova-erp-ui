// 견적서 단가 스냅샷 — 화면표시(Cost)와 출고일 단가(ShipmentDate.Cost)를 구분한다.
// sdateKey가 있는 행은 반드시 DateCost로 검증하고, 없으면 Cost(Estimate.Cost 등)를 쓴다.
// DateCost=0은 유효한 값이며 표시용 Cost로 대체하지 않는다.

export const STALE_COST_MESSAGE = '수량은 저장됐지만 단가 확인값이 없어 단가 저장은 중단했습니다';
const validPrice = (v) => v != null && v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0;

export function buildCostSnapshot(item) {
  const rawSdateKey = item?.sdateKey ?? item?.SdateKey;
  const sdateKey = Number.isInteger(Number(rawSdateKey)) && Number(rawSdateKey) > 0
    ? Number(rawSdateKey)
    : null;
  if (sdateKey != null) {
    if (!validPrice(item?.DateCost)) return null;
    const dateCost = Number(item?.DateCost);
    if (!Number.isFinite(dateCost)) return null;
    return { sdateKey, expectedOldCost: dateCost };
  }
  if (!validPrice(item?.Cost)) return null;
  const cost = Number(item?.Cost);
  if (!Number.isFinite(cost)) return null;
  return { sdateKey: null, expectedOldCost: cost };
}

export function requireCostSnapshot(item) {
  const snapshot = buildCostSnapshot(item);
  if (!snapshot) throw new Error('조회한 단가 확인값이 없습니다. 입력값을 보관하고 견적서를 다시 조회해 주세요.');
  return snapshot;
}

// update-date-quantity 응답(saved[])을 이번 배치에서 함께 저장할 costItems에 반영한다.
// - 날짜가 살아있으면: 같은 sdateKey + dateCostAfter를 새 기준값으로 사용
// - 날짜만 삭제되고 상세는 남으면: sdateKey를 버리고 detailCostAfter를 기준값으로 사용
// - 상세 자체가 purge되면: 같은 SdetailKey의 모든 costItems를 버린다(skipped로 집계)
// - 이번 배치에서 다루지 않은 날짜의 costItem은 원래 스냅샷을 그대로 유지한다
// - 서버가 기준값(DateCost/DetailCost)을 못 주면 추정하지 않고 실패로 집계한다
export function rebaseCostItemsFromSaved(costItems, savedResults, expectedSavedKeys = []) {
  const bySdateKey = new Map();
  const purgedSdetailKeys = new Set();
  for (const saved of savedResults || []) {
    if (!saved) continue;
    if (saved.purged) {
      purgedSdetailKeys.add(Number(saved.sdetailKey));
      continue;
    }
    bySdateKey.set(Number(saved.sdateKey), saved);
  }

  const items = [];
  let skipped = 0;
  let failed = 0;
  for (const costItem of costItems || []) {
    const sdetailKey = costItem.sdetailKey != null ? Number(costItem.sdetailKey) : null;
    if (sdetailKey != null && purgedSdetailKeys.has(sdetailKey)) {
      skipped += 1;
      continue;
    }
    const sdateKey = costItem.sdateKey != null ? Number(costItem.sdateKey) : null;
    const saved = sdateKey != null ? bySdateKey.get(sdateKey) : null;
    if (!saved) {
      if (expectedSavedKeys.map(Number).includes(sdateKey)) { failed += 1; continue; }
      items.push(costItem);
      continue;
    }
    if (Number(saved.sdetailKey) !== sdetailKey
      || (saved.shipmentKey != null && costItem.shipmentKey != null && Number(saved.shipmentKey) !== Number(costItem.shipmentKey))) {
      failed += 1; continue;
    }
    if (saved.dateDeleted) {
      if (!validPrice(saved.detailCostAfter)) { failed += 1; continue; }
      const baseline = Number(saved.detailCostAfter);
      if (!Number.isFinite(baseline)) { failed += 1; continue; }
      items.push({ ...costItem, sdateKey: undefined, expectedOldCost: baseline });
      continue;
    }
    if (saved.dateDeleted !== false || !validPrice(saved.dateCostAfter)) { failed += 1; continue; }
    const baseline = Number(saved.dateCostAfter);
    if (!Number.isFinite(baseline)) { failed += 1; continue; }
    items.push({ ...costItem, sdateKey, expectedOldCost: baseline });
  }
  return { items, skipped, failed, ok: failed === 0 };
}
