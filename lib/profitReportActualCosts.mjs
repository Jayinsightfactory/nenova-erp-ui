// A saved zero is evidence; an absent value or a recommended/default fee is not.
const amount = value => value !== null && value !== undefined && value !== ''
  && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;

export function resolveThaiStoredCustoms({ row, gw = {}, inbound = false, inboundWeeks = [] } = {}) {
  if (!row && !inbound) return { total: 0, source: 'no_inbound', missing: [], knownTotal: 0 };
  const missing = [];
  const read = field => {
    const value = amount(row?.[field]);
    if (value == null) missing.push(field);
    return value ?? 0;
  };
  const rate = read('BakSangRateApplied');
  let knownTotal = 0;
  for (const half of [1, 2]) {
    const weight = amount(row?.[`GW${half}`]) ?? amount(gw[`GW${half}`]);
    const active = (weight ?? 0) > 0 || inboundWeeks.some(w => Number(String(w).split('-')[1]) === half)
      || ['Customs', 'SunYul', 'WorldFreight', 'Quarantine']
      .some(field => Number(row?.[`${field}${half}`]) > 0);
    if (!active && half === 2) continue;
    if (weight == null) missing.push(`GW${half}`);
    knownTotal += (weight ?? 0) * rate;
    knownTotal += read(`Customs${half}`);
    if (Number(row?.[`WorldFreight${half}Manual`]) !== 1) missing.push(`WorldFreight${half}Manual`);
    knownTotal += (read(`SunYul${half}`) + read(`WorldFreight${half}`) + read(`Quarantine${half}`)) / 1.1;
  }
  return { total: missing.length ? null : knownTotal,
    source: missing.length ? 'actual_cost_missing' : 'sql_actual_cost', missing, knownTotal };
}

export function actualCostGroupKey(master) {
  return `${master.OrderYear}|${master.OrderWeek}|${String(master.OrderNo || '').replace(/[-\s]/g, '') || `WK:${master.WarehouseKey}`}`;
}

// H belongs to the whole major week. Allocate once, not once per invoice/subweek.
export function allocateActualCustoms(groups, total) {
  if (amount(total) == null || !groups.length || groups.some(g => !g.complete || !(g.gw > 0))) return {};
  const weight = groups.reduce((sum, g) => sum + g.gw, 0);
  return Object.fromEntries(groups.map(g => [g.key, Number(total) * g.gw / weight]));
}

// Per-stem allocation is converted using each row's real quantity, never the
// majority display unit of its flower bucket (which may mix bunches and stems).
export function actualArrivalRow(row, calculated, exchangeRate) {
  const qty = Number(row.OutQuantity), stems = Number(row.SteamQuantity);
  if (!(qty > 0) || !(stems > 0) || !(exchangeRate > 0) || amount(row.TPrice) == null
    || !['단', '송이', '박스'].includes(String(row.OutUnit || '').trim())) return null;
  const goods = Number(row.TPrice) / qty;
  const freight = Number(calculated.freightPerStemUSD) * stems / qty;
  const customs = Number(calculated.customsPerStem) * stems / qty;
  if (![goods, freight, customs].every(Number.isFinite)) return null;
  return { price: (goods + freight) * exchangeRate + customs, unit: row.OutUnit.trim(),
    freight, customs, goods };
}
