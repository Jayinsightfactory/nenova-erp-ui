// Descriptive counterfactuals, not causal claims or accounting entries.
// One quantity unit per group; no historic price is invented for new/exited pairs.
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const knownCost = (value) => finite(value) && value >= 0;
const sum = (values) => values.reduce((total, value) => total + value, 0);
const factorial = [1, 1, 2, 6, 24, 120];
const productKey = (row) => JSON.stringify([String(row.prodKey), row.unit]);
const pairKey = (row) => JSON.stringify([String(row.prodKey), String(row.custKey), row.unit]);

function aggregate(rows, warnings) {
  const pairs = new Map();
  for (const row of rows || []) {
    if (row?.prodKey == null || row?.custKey == null || !row?.unit ||
        !finite(row.quantity) || row.quantity <= 0 || !finite(row.netSales) || row.netSales < 0) {
      warnings.add('NON_POSITIVE_OR_INVALID_SALE_EXCLUDED');
      continue;
    }
    const key = pairKey(row);
    const prior = pairs.get(key);
    if (!prior) pairs.set(key, { ...row, unitCost: knownCost(row.unitCost) ? row.unitCost : null });
    else {
      prior.quantity += row.quantity;
      prior.netSales += row.netSales;
      if (!knownCost(row.unitCost) || !knownCost(prior.unitCost) || Math.abs(row.unitCost - prior.unitCost) > 1e-7) prior.unitCost = null;
    }
  }
  // A product's cost cannot depend on the customer purchasing it.
  const productCosts = new Map();
  for (const row of pairs.values()) {
    const key = productKey(row);
    if (!productCosts.has(key)) productCosts.set(key, row.unitCost);
    else if (!knownCost(row.unitCost) || !knownCost(productCosts.get(key)) || Math.abs(row.unitCost - productCosts.get(key)) > 1e-7) productCosts.set(key, null);
  }
  for (const row of pairs.values()) row.unitCost = productCosts.get(productKey(row));
  return pairs;
}

function state(rows) {
  const quantity = sum(rows.map(row => row.quantity));
  const productQuantities = new Map();
  for (const row of rows) productQuantities.set(productKey(row), (productQuantities.get(productKey(row)) || 0) + row.quantity);
  return {
    quantity,
    productShare: new Map([...productQuantities].map(([key, qty]) => [key, qty / quantity])),
    customerShare: new Map(rows.map(row => [pairKey(row), row.quantity / productQuantities.get(productKey(row))])),
    prices: new Map(rows.map(row => [pairKey(row), row.netSales / row.quantity])),
    costs: new Map(rows.map(row => [productKey(row), row.unitCost])),
  };
}

function decompose(rowsBefore, rowsAfter, withCost) {
  const before = state(rowsBefore);
  const after = state(rowsAfter);
  const factors = ['volume', 'productMix', 'customerMix', 'price', ...(withCost ? ['unitCost'] : [])];
  const dimension = factors.length;
  const all = (1 << dimension) - 1;
  const values = [];
  const rates = [];
  const choose = (mask, bit) => mask & (1 << bit) ? after : before;
  for (let mask = 0; mask <= all; mask++) {
    const q = choose(mask, 0).quantity;
    let unitRevenue = 0;
    for (const row of rowsBefore) {
      const p = productKey(row), pair = pairKey(row);
      unitRevenue += choose(mask, 1).productShare.get(p) * choose(mask, 2).customerShare.get(pair) * choose(mask, 3).prices.get(pair);
    }
    let unitCost = 0;
    if (withCost) for (const [p, share] of choose(mask, 1).productShare) unitCost += share * choose(mask, 4).costs.get(p);
    values[mask] = q * (unitRevenue - unitCost);
    rates[mask] = unitRevenue !== 0 ? (unitRevenue - unitCost) / unitRevenue : null;
  }
  const contributions = factors.map((key, bit) => {
    let amount = 0, percentagePoints = 0;
    let rateAvailable = withCost;
    for (let mask = 0; mask <= all; mask++) {
      if (mask & (1 << bit)) continue;
      let size = 0;
      for (let x = mask; x; x &= x - 1) size++;
      const weight = factorial[size] * factorial[dimension - size - 1] / factorial[dimension];
      const next = mask | (1 << bit);
      amount += weight * (values[next] - values[mask]);
      if (rates[mask] == null || rates[next] == null) rateAvailable = false;
      else percentagePoints += weight * (rates[next] - rates[mask]) * 100;
    }
    return { key, amount, percentagePoints: rateAvailable ? percentagePoints : null };
  });
  return { before: values[0], after: values[all], delta: values[all] - values[0], contributions,
    marginDeltaPp: withCost && rates[0] != null && rates[all] != null ? (rates[all] - rates[0]) * 100 : null };
}

const labels = { volume: '판매수량 변화', productMix: '품목구성 변화', customerMix: '동일품목 업체비중 변화', price: '동일품목·업체 판매단가 변화', unitCost: '이월 포함 평균원가 변화' };

/**
 * Rows are positive customer × product × EstUnit sales, with VAT-excluded netSales.
 * Optional total margins include deductions/returns and may be null for incomplete costs.
 * Five-factor Shapley is order independent; the comparable cohort is disclosed.
 */
export function decomposeCustomerMargin({ previous = [], current = [], previousMargin = null, currentMargin = null } = {}) {
  const warnings = new Set();
  const before = aggregate(previous, warnings), after = aggregate(current, warnings);
  const units = new Set([...before.values(), ...after.values()].map(row => row.unit));
  const fullDelta = finite(previousMargin) && finite(currentMargin) ? currentMargin - previousMargin : null;
  if (units.size > 1) return { profitDelta: fullDelta, marginDeltaPp: null, contributions: [], revenueDrivers: [], residual: fullDelta,
    coverage: { previousPairs: before.size, currentPairs: after.size, commonPairs: 0, pricedCommonPairs: 0 }, warnings: ['MIXED_UNITS'] };
  const commonKeys = [...before.keys()].filter(key => after.has(key));
  const pricedKeys = commonKeys.filter(key => knownCost(before.get(key).unitCost) && knownCost(after.get(key).unitCost));
  const b = commonKeys.map(key => before.get(key)), a = commonKeys.map(key => after.get(key));
  const pb = pricedKeys.map(key => before.get(key)), pa = pricedKeys.map(key => after.get(key));
  const revenue = commonKeys.length ? decompose(b, a, false) : null;
  const profit = pricedKeys.length ? decompose(pb, pa, true) : null;
  const allPositiveBefore = sum([...before.values()].map(row => row.netSales));
  const allPositiveAfter = sum([...after.values()].map(row => row.netSales));
  const allPairsPriced = [...before.values(), ...after.values()].every(row => knownCost(row.unitCost));
  const positiveProfitBefore = allPairsPriced ? sum([...before.values()].map(row => row.netSales - row.quantity * row.unitCost)) : null;
  const positiveProfitAfter = allPairsPriced ? sum([...after.values()].map(row => row.netSales - row.quantity * row.unitCost)) : null;
  const incomingProfit = allPairsPriced ? sum([...after].filter(([key]) => !before.has(key)).map(([, row]) => row.netSales - row.quantity * row.unitCost)) : null;
  const outgoingProfit = allPairsPriced ? -sum([...before].filter(([key]) => !after.has(key)).map(([, row]) => row.netSales - row.quantity * row.unitCost)) : null;
  const residual = fullDelta == null ? null : fullDelta - (profit?.delta || 0);
  if (commonKeys.length !== before.size || commonKeys.length !== after.size) warnings.add('NEW_OR_EXITED_PAIRS_OUTSIDE_COMMON_COHORT');
  if (pricedKeys.length !== commonKeys.length) warnings.add('COMMON_COHORT_COST_INCOMPLETE');
  if (!commonKeys.length) warnings.add('NO_COMMON_POSITIVE_SALES');
  const exactTotalCohort = fullDelta != null && allPairsPriced && commonKeys.length === before.size && commonKeys.length === after.size &&
    Math.abs(previousMargin - positiveProfitBefore) < 1e-6 && Math.abs(currentMargin - positiveProfitAfter) < 1e-6;
  return {
    profitDelta: fullDelta,
    marginDeltaPp: exactTotalCohort ? profit?.marginDeltaPp ?? null : null,
    contributions: (profit?.contributions || []).map(row => ({ ...row, label: labels[row.key],
      cohortPercentagePoints: row.percentagePoints, percentagePoints: exactTotalCohort ? row.percentagePoints : null })),
    revenueDrivers: (revenue?.contributions || []).map(row => ({ ...row, label: labels[row.key], percentagePoints: null })),
    residual,
    remainder: { newPairsProfit: incomingProfit, exitedPairsProfit: outgoingProfit,
      deductionsReturnsAndOther: fullDelta != null && allPairsPriced ? fullDelta - (positiveProfitAfter - positiveProfitBefore) : null },
    commonCohort: { profitDelta: profit?.delta ?? null, revenueDelta: revenue?.delta ?? null, marginDeltaPp: profit?.marginDeltaPp ?? null },
    coverage: { previousPairs: before.size, currentPairs: after.size, commonPairs: commonKeys.length, pricedCommonPairs: pricedKeys.length,
      previousPositiveSales: allPositiveBefore, currentPositiveSales: allPositiveAfter,
      previousCommonSales: sum(b.map(row => row.netSales)), currentCommonSales: sum(a.map(row => row.netSales)),
      previousPricedCommonSales: sum(pb.map(row => row.netSales)), currentPricedCommonSales: sum(pa.map(row => row.netSales)) },
    warnings: [...warnings],
  };
}

/** Arithmetic bridge of the existing report. Does not revalue any inventory. */
export function buildReportedProfitBridge({ previous, current, isTotal = false } = {}) {
  const descriptors = [
    ['C', '순매출 변화', 1], ['E', '기초재고액 변화', -1], ['F', '기말재고액 변화', 1],
    ['G', '상품매입·국제운임 변화', -1], ['H', '그외 통관비 변화', -1], ['AJ', '기존 이익조정 변화', 1],
  ];
  const normalized = (row, key) => {
    if (!row || !finite(row.J)) return null;
    if (key === 'H' || key === 'AJ') return row[key] == null ? 0 : finite(row[key]) ? row[key] : null;
    return finite(row[key]) ? row[key] : null;
  };
  const profitDelta = finite(previous?.J) && finite(current?.J) ? current.J - previous.J : null;
  const denominator = row => !row ? null : (isTotal || row.variant === 'noEnding') ?
    finite(row.C) && finite(row.F) ? row.C + row.F : null : finite(row.C) ? row.C : null;
  const d0 = denominator(previous), d1 = denominator(current);
  const ratesAvailable = finite(previous?.K) && finite(current?.K) && finite(d0) && finite(d1) && d0 !== 0 && d1 !== 0;
  const multiplier = ratesAvailable ? 0.5 * (1 / d0 + 1 / d1) * 100 : null;
  const contributions = descriptors.map(([key, label, sign]) => {
    const a = normalized(previous, key), b = normalized(current, key);
    const amount = a != null && b != null ? sign * (b - a) : null;
    return { key, label, amount, percentagePoints: multiplier != null && amount != null ? amount * multiplier : null };
  });
  const complete = contributions.every(row => row.amount != null);
  const residual = profitDelta != null && complete ? profitDelta - sum(contributions.map(row => row.amount)) : null;
  const denominatorEffect = ratesAvailable ? 0.5 * (previous.J + current.J) * (1 / d1 - 1 / d0) * 100 : null;
  contributions.push({ key: 'denominator', label: '수익률 분모 변화', amount: 0, percentagePoints: denominatorEffect });
  const marginDeltaPp = finite(previous?.K) && finite(current?.K) ? (current.K - previous.K) * 100 : null;
  const rateResidual = marginDeltaPp != null && contributions.every(row => row.percentagePoints != null) ?
    marginDeltaPp - sum(contributions.map(row => row.percentagePoints)) : null;
  const warnings = [];
  if (!complete) warnings.push('REPORTED_INPUT_INCOMPLETE');
  if (residual != null && Math.abs(residual) > 0.01) warnings.push('REPORTED_PROFIT_BRIDGE_RESIDUAL');
  if (rateResidual != null && Math.abs(rateResidual) > 1e-7) warnings.push('REPORTED_RATE_BRIDGE_RESIDUAL');
  return { profitDelta, marginDeltaPp, contributions, residual, rateResidual, denominator: { previous: d0, current: d1 }, warnings };
}
