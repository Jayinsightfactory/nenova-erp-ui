import { raumPnlCostIdentity, raumPnlCostSnapshot } from './raumPnlCostComparison.js';

function normalizedCost(value) {
  if (value == null || String(value).trim() === '') return null;
  const number = Number(String(value).replace(/,/g, ''));
  if (!Number.isFinite(number) || number < 0) throw new Error('신라 매입단가는 0 이상의 숫자만 입력할 수 있습니다.');
  return number;
}

export function withShillaDetailCostBaseline(items = []) {
  return (Array.isArray(items) ? items : []).map(item => ({
    ...item,
    _savedCostPrice: normalizedCost(item?.costPrice ?? item?.CostPrice),
  }));
}

export function applyShillaDetailCostDraft(items = [], itemIndex, rawValue) {
  const source = Array.isArray(items) ? items[itemIndex] : null;
  const targetIdentity = raumPnlCostIdentity(source);
  if (!source || !targetIdentity) return Array.isArray(items) ? items : [];
  return items.map(item => raumPnlCostIdentity(item) === targetIdentity
    ? { ...item, costPrice: rawValue, costSource: 'manual', costLearned: false }
    : item);
}

export function buildShillaDetailCostUpdates(items = [], scope = {}) {
  const pnlKey = Number(scope.pnlKey);
  const major = Number(scope.major);
  if (!Number.isInteger(pnlKey) || pnlKey <= 0 || !Number.isInteger(major) || major <= 0) {
    throw new Error('저장된 신라 결산 차수에서만 매입단가를 수정할 수 있습니다.');
  }
  const groups = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const itemKey = Number(item?.itemKey ?? item?.ItemKey);
    if (!Number.isInteger(itemKey) || itemKey <= 0) continue;
    const identity = raumPnlCostIdentity(item);
    if (!identity) throw new Error(`${major}차 품목의 단가 저장 기준을 확인할 수 없습니다.`);
    if (!groups.has(identity)) groups.set(identity, []);
    groups.get(identity).push(item);
  }

  const updates = [];
  for (const [identity, rows] of groups) {
    const currentValues = [...new Set(rows.map(row => normalizedCost(row.costPrice ?? row.CostPrice)))];
    if (currentValues.length !== 1) {
      throw new Error(`${major}차 같은 품목·단위의 매입단가가 서로 다릅니다. 한 값으로 맞춰 주세요.`);
    }
    const costPrice = currentValues[0];
    const changed = rows.some(row => normalizedCost(row._savedCostPrice) !== costPrice);
    if (!changed) continue;
    const expectedRows = rows.map(row => ({
      itemKey: row.itemKey ?? row.ItemKey,
      costPrice: row._savedCostPrice,
    }));
    updates.push({
      pnlKey,
      major,
      identity,
      expected: raumPnlCostSnapshot(expectedRows),
      costPrice,
    });
  }
  return updates;
}
