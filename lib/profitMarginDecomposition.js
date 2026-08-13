// 주차별 매출이익 이익률 차이 분해 — DB/API/React 의존 없는 순수 helper.
// 6개 요인의 모든 순열을 평균한 Shapley 기여도로 교체 순서 편향을 제거한다.
const n0 = value => (value == null || Number.isNaN(Number(value)) ? 0 : Number(value));

export const PROFIT_MARGIN_DRIVERS = [
  { key: 'salesMix', label: '판매믹스' },
  { key: 'allocationUnitPrice', label: '분배단가' },
  { key: 'purchaseCost', label: '원가' },
  { key: 'inventory', label: '재고' },
  { key: 'exchangeRate', label: '환율' },
  { key: 'transport', label: '운송' },
];

function normalizeSnapshot(snapshot, label) {
  const orderYear = String(snapshot?.orderYear || '');
  const major = String(snapshot?.major || '').padStart(2, '0');
  if (!/^\d{4}$/.test(orderYear) || !/^\d{2}$/.test(major)) {
    throw new Error(`${label} 스냅샷은 orderYear(YYYY)와 major(WW)가 필요합니다.`);
  }
  const rows = new Map();
  for (const row of snapshot?.rows || []) {
    const category = String(row?.category || '').trim();
    if (!category) continue;
    const calc = row.calc || row;
    rows.set(category, {
      category,
      variant: row.variant || calc.variant || 'normal',
      C: n0(calc.C), E: n0(calc.E), F: n0(calc.F), H: n0(calc.H),
      Q: n0(calc.Q), R: n0(calc.R), S: n0(calc.S),
    });
  }
  return { orderYear, major, key: `${orderYear}-${major}`, rows };
}

function permutations(values) {
  if (values.length <= 1) return [values];
  const out = [];
  values.forEach((value, index) => {
    for (const rest of permutations([...values.slice(0, index), ...values.slice(index + 1)])) {
      out.push([value, ...rest]);
    }
  });
  return out;
}

function revenueShares(rows, categories) {
  const total = categories.reduce((sum, category) => sum + n0(rows.get(category)?.C), 0);
  if (Math.abs(total) <= 1e-12) return { total, shares: null };
  return { total, shares: Object.fromEntries(categories.map(category => [category, n0(rows.get(category)?.C) / total])) };
}

function emptyRow(category, variant = 'normal') {
  return { category, variant, C: 0, E: 0, F: 0, H: 0, Q: 0, R: 0, S: 0 };
}

function evaluateMargin(base, target, categories, enabled) {
  const baseRevenue = revenueShares(base.rows, categories);
  const targetRevenue = revenueShares(target.rows, categories);
  const useMix = enabled.has('salesMix');
  const useScale = enabled.has('allocationUnitPrice');
  const shares = (useMix ? targetRevenue.shares : baseRevenue.shares)
    || targetRevenue.shares || baseRevenue.shares
    || Object.fromEntries(categories.map(category => [category, 0]));
  const revenueTotal = useScale ? targetRevenue.total : baseRevenue.total;

  let profit = 0;
  let endingInventory = 0;
  for (const category of categories) {
    const baseRow = base.rows.get(category) || emptyRow(category, target.rows.get(category)?.variant);
    const targetRow = target.rows.get(category) || emptyRow(category, baseRow.variant);
    const pick = (driver, field) => enabled.has(driver) ? targetRow[field] : baseRow[field];
    const C = revenueTotal * n0(shares[category]);
    const Q = pick('purchaseCost', 'Q');
    const R = pick('exchangeRate', 'R');
    const S = pick('transport', 'S');
    const H = pick('transport', 'H');
    const E = pick('inventory', 'E');
    const F = pick('inventory', 'F');
    const variant = targetRow.variant || baseRow.variant || 'normal';
    const G = (Q + S) * R;
    const I = variant === 'noEnding' ? E + G + H : E + G + H - F;
    const J = variant === 'noEnding' ? C - I + F : C - I;
    profit += J;
    endingInventory += F;
  }
  const denominator = revenueTotal + endingInventory;
  return { margin: Math.abs(denominator) > 1e-12 ? profit / denominator : null, profit, revenue: revenueTotal, endingInventory };
}

export function decomposeProfitMarginChange(baselineSnapshot, comparisonSnapshot) {
  const baseline = normalizeSnapshot(baselineSnapshot, '기준');
  const comparison = normalizeSnapshot(comparisonSnapshot, '비교');
  const categories = [...new Set([...baseline.rows.keys(), ...comparison.rows.keys()])].sort();
  const driverKeys = PROFIT_MARGIN_DRIVERS.map(driver => driver.key);
  const baselineResult = evaluateMargin(baseline, comparison, categories, new Set());
  const comparisonResult = evaluateMargin(baseline, comparison, categories, new Set(driverKeys));
  const issues = [{
    severity: 'warning',
    code: 'ALLOCATION_UNIT_PRICE_UNVERIFIED',
    message: '판매수량·실판매단가가 현재 API에 없어 분배단가는 매출총액 변화 대체치입니다. 단가 단독 기여도는 미검증입니다.',
  }];
  if (baselineResult.margin == null || comparisonResult.margin == null) {
    issues.push({ severity: 'error', code: 'MARGIN_DENOMINATOR_ZERO', message: '매출액+기말재고 분모가 0인 스냅샷은 이익률을 계산할 수 없습니다.' });
  }
  for (const category of categories) {
    const a = baseline.rows.get(category)?.variant;
    const b = comparison.rows.get(category)?.variant;
    if (a && b && a !== b) issues.push({ severity: 'error', code: 'VARIANT_CHANGED', category, message: '기준/비교 차수의 계산 variant가 달라 분해 결과를 확정할 수 없습니다.' });
  }

  const contribution = Object.fromEntries(driverKeys.map(key => [key, 0]));
  if (baselineResult.margin != null && comparisonResult.margin != null) {
    const orders = permutations(driverKeys);
    for (const order of orders) {
      const enabled = new Set();
      let previous = baselineResult.margin;
      for (const key of order) {
        enabled.add(key);
        const next = evaluateMargin(baseline, comparison, categories, enabled).margin;
        contribution[key] += n0(next) - n0(previous);
        previous = next;
      }
    }
    for (const key of driverKeys) contribution[key] /= orders.length;
  }

  const difference = comparisonResult.margin == null || baselineResult.margin == null
    ? null : comparisonResult.margin - baselineResult.margin;
  const contributionSum = driverKeys.reduce((sum, key) => sum + contribution[key], 0);
  const residual = difference == null ? null : difference - contributionSum;
  if (residual != null && Math.abs(residual) > 1e-10) {
    issues.push({ severity: 'error', code: 'DECOMPOSITION_NOT_RECONCILED', message: `기여도 합계 잔차 ${residual}가 허용범위를 넘었습니다.` });
  }

  return {
    baseline: { key: baseline.key, ...baselineResult },
    comparison: { key: comparison.key, ...comparisonResult },
    difference,
    contributions: PROFIT_MARGIN_DRIVERS.map(driver => ({ ...driver, value: contribution[driver.key], percentagePoints: contribution[driver.key] * 100 })),
    contributionSum,
    residual,
    issues,
  };
}
