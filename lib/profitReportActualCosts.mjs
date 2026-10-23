import { deriveTruckPlan, truckPlanAmount } from './colombiaTruck.js';

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

// Report-only policy approved on 2026-10-23. Estimates never become SQL actuals.
export function resolveApprovedThaiCustoms(input, { goods, freight, freightSource, rate, orderYear, major } = {}) {
  if (!input?.policyInput) return input;
  const p = input.policyInput;
  if (String(p.orderYear) !== String(orderYear) || Number(p.major) !== Number(major))
    return { total: null, source: 'actual_cost_missing', missing: ['period_mismatch'] };
  const row = p.row || {};
  const halves = [1, 2].filter(h => Number(p.gw?.[`GW${h}`]) > 0
    || (p.inboundWeeks || []).some(w => Number(String(w).split('-')[1]) === h));
  if (!halves.length) return input;
  const weights = halves.map(h => amount(p.gw?.[`GW${h}`]));
  if (weights.some(w => !(w > 0))) return { ...input, total: null, source: 'actual_cost_missing', missing: ['GW'] };
  const gw = weights.reduce((s, w) => s + w, 0);
  const components = { warehouse: gw * 460, customs: 0, sunYul: 0, domestic: 0, quarantine: 0 };
  const estimatedFields = ['BakSang460Policy'];
  const base = amount(goods) != null && amount(freight) != null && Number(rate) > 0
    && freightSource && !/missing|partial/i.test(freightSource)
    ? (Number(goods) + Number(freight)) * Number(rate) : null;
  const missingDutyWeight = halves.reduce((s, h, i) => s + (amount(row[`Customs${h}`]) == null ? weights[i] : 0), 0);
  if (missingDutyWeight > 0 && base == null)
    return { ...input, total: null, source: 'actual_cost_missing', missing: ['purchase_period_taxable_base'] };
  components.customs = [1, 2].reduce((s, h) => s + (amount(row[`Customs${h}`]) ?? 0), 0);
  if (missingDutyWeight > 0) {
    components.customs += Math.floor(base * (missingDutyWeight / gw) * 0.05 / 10) * 10;
    estimatedFields.push('Customs5Percent');
  }
  const recentNetPattern = Number(orderYear) > 2026 || (Number(orderYear) === 2026 && Number(major) >= 32);
  for (const h of [1, 2]) {
    const sun = amount(row[`SunYul${h}`]);
    const active = halves.includes(h);
    components.sunYul += sun == null ? (active ? 63000 : 0) : recentNetPattern ? sun : sun / 1.1;
    if (sun == null && active) estimatedFields.push(`SunYul${h}:63000`);
    else if (sun != null && recentNetPattern) estimatedFields.push(`SunYul${h}:net_assumed`);
    const quarantine = amount(row[`Quarantine${h}`]);
    components.quarantine += (quarantine ?? 0) / 1.1;
    if (quarantine == null && active) estimatedFields.push(`Quarantine${h}:0`);
  }
  const manualTruck = [1, 2].some(h => Number(row[`WorldFreight${h}Manual`]) === 1 && amount(row[`WorldFreight${h}`]) != null);
  const truckPlan = deriveTruckPlan(gw);
  const truckGross = manualTruck
    ? [1, 2].reduce((s, h) => s + (Number(row[`WorldFreight${h}Manual`]) === 1 ? amount(row[`WorldFreight${h}`]) ?? 0 : 0), 0)
    : truckPlanAmount(truckPlan, { Truck1t: 99000, Truck2_5t: 187000, Truck5t: 275000 });
  components.domestic = truckGross / 1.1;
  if (!manualTruck) estimatedFields.push('Domestic:combined_gw');
  return { ...input, total: Object.values(components).reduce((s, v) => s + v, 0),
    source: 'approved_estimate', estimated: true, policyVersion: '2026-10-23', missing: [],
    estimatedFields, components, gw, truckGross, truckPlan, taxableBaseKRW: base,
    basis: 'SQL 매입·운임·정확 과세환율 + 승인 비용 추정(460원/kg·국내운송 중량·태국 관세5%)' };
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
