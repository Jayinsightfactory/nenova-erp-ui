export const ESTIMATE_ADDITIONAL_SUBWEEK = '02';

export function buildEstimateAdditionalWeek(year, parentWeek) {
  const y = String(year || '').trim();
  const w = String(parentWeek || '').match(/\d{1,2}/)?.[0];
  if (!/^\d{4}$/.test(y) || !w) throw new Error('연도와 차수를 확인하세요.');
  return `${y}-${String(Number(w)).padStart(2, '0')}-${ESTIMATE_ADDITIONAL_SUBWEEK}`;
}

export function validateAdditionalProductSelection({ cost, costSourceId, shipmentDate }) {
  if (!(Number(cost) > 0)) throw new Error('단가 출처를 선택하거나 단가를 직접 입력하세요.');
  if (!costSourceId) throw new Error('단가 출처를 명시하세요. 직접 입력은 DIRECT를 선택하세요.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(shipmentDate || ''))) throw new Error('검증된 출고일을 확인하세요.');
  return true;
}

export function applyReferenceCostOnly(source) {
  const costSourceId = String(source?.id || '').trim();
  const cost = Number(source?.cost);
  if (!costSourceId) return { costSourceId: '', cost: '' };
  if (costSourceId === 'DIRECT') return { costSourceId, cost: Number(source?.cost) > 0 ? Number(source.cost) : '' };
  if (!(cost > 0)) return { costSourceId: '', cost: '' };
  return { costSourceId, cost };
}

export function formatReferenceCostLabel(source) {
  const cost = Number(source?.cost || 0).toLocaleString();
  const week = [source?.year, source?.week].filter(Boolean).join(' ');
  const hint = source?.kind === 'CUSTPROD'
    ? '업체단가'
    : source?.customerName
      ? `참고 ${source.customerName}`
      : '참고단가';
  return [cost ? `${cost}원` : '', week, source?.shipmentDate, hint].filter(Boolean).join(' · ');
}

export function shouldSkipFixCycleStockCalc({ existingQtyChanged } = {}) {
  return !existingQtyChanged;
}

export function rankReferenceCosts(rows = []) {
  return [...rows].sort((a, b) => Number(b.customerPriority || 0) - Number(a.customerPriority || 0)
    || Number(b.selectedCount || 0) - Number(a.selectedCount || 0)
    || String(b.shipmentDate || '').localeCompare(String(a.shipmentDate || '')));
}
