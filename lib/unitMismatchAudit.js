// DB/미리보기 행 단위 혼동 탐지 (읽기 전용·경고용)
import { normalizeOrderUnit } from './orderUtils.js';

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * OutUnit=박스인데 OutQuantity가 단(묶음)으로 잘못 저장된 패턴.
 * BunchQuantity ≈ OutQuantity × BunchOf1Box 이면 내부는 일관되나 OutQuantity 자체가 BunchOf1Box배 과대일 수 있음.
 * @returns {object|null} warning or null
 */
export function detectStoredBunchAsBox(row, product = {}) {
  const outU = normalizeOrderUnit(product.OutUnit || row.outUnit, '박스');
  if (outU !== '박스') return null;
  const b1b = asNumber(product.BunchOf1Box || row.BunchOf1Box);
  if (!(b1b > 1)) return null;

  const outQty = asNumber(row.OutQuantity ?? row.outQty ?? row.uploadQty);
  const boxQty = asNumber(row.BoxQuantity ?? row.boxQty);
  const bunchQty = asNumber(row.BunchQuantity ?? row.bunchQty);
  if (!(outQty > 0)) return null;

  const expectedBunch = outQty * b1b;
  if (Math.abs(bunchQty - expectedBunch) / Math.max(expectedBunch, 1) > 0.02) return null;

  // peer: BoxQuantity should match OutQuantity for box products; if order baseline exists compare
  const orderBox = asNumber(row.orderQty ?? row.OrderQty);
  if (orderBox > 0 && outQty / orderBox >= b1b * 0.85 && outQty / orderBox <= b1b * 1.15) {
    return {
      code: 'STORED_BUNCH_AS_BOX',
      severity: 'critical',
      message: `저장 수량(${outQty})이 주문(${orderBox}) 대비 약 ${Math.round(outQty / orderBox)}배 — 단을 박스로 저장했을 수 있습니다.`,
    };
  }
  return null;
}

export function detectStoredUnitMismatches(rows, productByKey) {
  const warnings = [];
  for (const row of rows || []) {
    const pk = Number(row.prodKey ?? row.ProdKey);
    const product = typeof productByKey?.get === 'function' ? productByKey.get(pk) : productByKey?.[pk];
    const w = detectStoredBunchAsBox(row, product || row);
    if (w) warnings.push({ ...row, warning: w });
  }
  return warnings;
}
