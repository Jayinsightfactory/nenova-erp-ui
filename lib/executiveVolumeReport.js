export function parseReportCycle(year, week) {
  const y = Number(year);
  const match = String(week || '').match(/^(\d{2})-(\d{2})$/);
  if (!Number.isInteger(y) || y < 2000 || y > 2100 || !match) return null;
  return { year: y, week: `${match[1]}-${match[2]}`, major: Number(match[1]), suffix: Number(match[2]) };
}

export function compareReportCycles(a, b) {
  return a.year - b.year || a.major - b.major || a.suffix - b.suffix;
}

export function findPreviousCycle(cycles, selected) {
  return cycles.filter(cycle => compareReportCycles(cycle, selected) < 0)
    .sort(compareReportCycles).at(-1) || null;
}

const keyOf = row => [row.country || '미분류', row.flower || '미분류', row.unit || '단위 미상'].join('|');

export function compareQuantity(current, baseline) {
  if (baseline == null) return { delta: null, ratePct: null, state: 'missing' };
  const delta = current - baseline;
  if (baseline === 0) return { delta, ratePct: null, state: current === 0 ? 'unchanged' : 'new' };
  return { delta, ratePct: delta / Math.abs(baseline) * 100, state: 'compared' };
}

export function buildExecutiveVolumeRows({ orders = [], arrivals = [], shipments = [], previous = {}, previousYear = {} }) {
  const map = new Map();
  const ensure = row => {
    const key = keyOf(row);
    if (!map.has(key)) map.set(key, { country: row.country || '미분류', flower: row.flower || '미분류', unit: row.unit || '단위 미상', ordered: 0, inbound: 0, outbound: 0 });
    return map.get(key);
  };
  orders.forEach(row => { ensure(row).ordered += Number(row.qty) || 0; });
  arrivals.forEach(row => { ensure(row).inbound += Number(row.qty) || 0; });
  shipments.forEach(row => { ensure(row).outbound += Number(row.qty) || 0; });
  const prev = new Map((previous.rows || []).map(row => [keyOf(row), row]));
  const prevYear = new Map((previousYear.rows || []).map(row => [keyOf(row), row]));
  return [...map.entries()].map(([key, row]) => {
    const old = prev.get(key), oldYear = prevYear.get(key);
    const missingQty = Math.max(row.ordered - row.inbound, 0);
    return {
      ...row,
      missingQty,
      missingPct: row.ordered > 0 ? missingQty / row.ordered * 100 : null,
      overInboundQty: Math.max(row.inbound - row.ordered, 0),
      inboundVsPrevious: compareQuantity(row.inbound, old?.inbound ?? null),
      inboundVsPreviousYear: compareQuantity(row.inbound, oldYear?.inbound ?? null),
      outboundVsPrevious: compareQuantity(row.outbound, old?.outbound ?? null),
      outboundVsPreviousYear: compareQuantity(row.outbound, oldYear?.outbound ?? null),
    };
  }).sort((a, b) => a.country.localeCompare(b.country, 'ko') || a.flower.localeCompare(b.flower, 'ko') || a.unit.localeCompare(b.unit, 'ko'));
}

export function summarizeExecutiveVolume(rows = []) {
  const groups = new Map();
  for (const row of rows) {
    const key = row.unit;
    if (!groups.has(key)) groups.set(key, { unit: key, ordered: 0, inbound: 0, outbound: 0, missing: 0 });
    const total = groups.get(key);
    total.ordered += row.ordered;
    total.inbound += row.inbound;
    total.outbound += row.outbound;
    total.missing += row.missingQty;
  }
  return [...groups.values()].sort((a, b) => a.unit.localeCompare(b.unit, 'ko'));
}

export function groupExecutiveVolumeByCountry(rows = []) {
  const groups = new Map();
  for (const row of rows) {
    const country = row.country || '미분류';
    if (!groups.has(country)) groups.set(country, { country, rows: [], unitTotals: new Map() });
    const group = groups.get(country);
    group.rows.push(row);
    const unit = row.unit || '단위 미상';
    if (!group.unitTotals.has(unit)) group.unitTotals.set(unit, { unit, ordered: 0, inbound: 0, outbound: 0, missing: 0 });
    const total = group.unitTotals.get(unit);
    total.ordered += Number(row.ordered) || 0;
    total.inbound += Number(row.inbound) || 0;
    total.outbound += Number(row.outbound) || 0;
    total.missing += Number(row.missingQty) || 0;
  }
  return [...groups.values()]
    .map(group => ({
      ...group,
      rows: group.rows.sort((a, b) => a.flower.localeCompare(b.flower, 'ko') || a.unit.localeCompare(b.unit, 'ko')),
      unitTotals: [...group.unitTotals.values()].sort((a, b) => a.unit.localeCompare(b.unit, 'ko')),
    }))
    .sort((a, b) => a.country.localeCompare(b.country, 'ko'));
}
