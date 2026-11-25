export const varietyKey = row => JSON.stringify([row.country || '', row.flower || '']);

const round3 = value => Math.round(Number(value || 0) * 1000) / 1000;

export function moveFarmWeek(value, delta) {
  const match = /^(\d{4})-(\d{2})-(0[1-4])$/.exec(value || '');
  if (!match || +match[2] < 1 || +match[2] > 52) return null;
  const index = (+match[1] * 52 + +match[2] - 1) * 4 + +match[3] - 1 + delta;
  const year = Math.floor(index / 208), week = Math.floor((index % 208) / 4) + 1, sub = index % 4 + 1;
  if (year < 2020 || year > 2099) return null;
  return `${year}-${String(week).padStart(2, '0')}-${String(sub).padStart(2, '0')}`;
}

export function buildFarmWeekBoard(source, { orderYear, orderWeek }) {
  const rows = new Map();
  for (const r of source || []) {
    if (String(r.orderYear) !== String(orderYear) || r.orderWeek !== orderWeek) continue;
    const quantity = Number(r.quantity);
    if (!Number.isFinite(quantity)) throw new Error('수량 확인 필요');
    const key = Number(r.prodKey);
    if (!rows.has(key)) {
      rows.set(key, {
        prodKey: key,
        prodName: r.prodName,
        country: r.country || '',
        flower: r.flower || '',
        unit: r.unit || '단위 미지정',
        incoming: {},
        order: 0,
        distribution: 0,
        adjustment: 0,
        received: 0,
      });
    }
    const row = rows.get(key);
    if (r.kind === 'incoming') {
      const farm = String(r.farm || '').trim() || '농장 미지정';
      row.incoming[farm] = round3((row.incoming[farm] || 0) + quantity);
      row.received = round3(row.received + quantity);
    } else if (['order', 'distribution', 'adjustment'].includes(r.kind)) {
      row[r.kind] = round3(row[r.kind] + quantity);
    }
  }
  return [...rows.values()].sort((a, b) => a.prodName.localeCompare(b.prodName, 'ko'));
}

export function summarizeFarmRows(rows) {
  const byUnit = new Map();
  for (const r of rows || []) {
    if (!byUnit.has(r.unit)) {
      byUnit.set(r.unit, { unit: r.unit, received: 0, order: 0, distribution: 0, adjustment: 0, incoming: {} });
    }
    const total = byUnit.get(r.unit);
    for (const key of ['received', 'order', 'distribution', 'adjustment']) {
      total[key] = round3(total[key] + Number(r[key] || 0));
    }
    for (const [farm, qty] of Object.entries(r.incoming || {})) {
      total.incoming[farm] = round3((total.incoming[farm] || 0) + Number(qty || 0));
    }
  }
  return [...byUnit.values()];
}

export function hasFarmRowActivityForTab(row, tab = 'farm') {
  if (!row) return false;
  const hasIncoming = Number(row.received || 0) !== 0 || Object.values(row.incoming || {}).some(q => Number(q) !== 0);
  const hasAdjustment = Number(row.adjustment || 0) !== 0;
  if (tab === 'farm') return hasIncoming || hasAdjustment;
  if (tab === 'order') return Number(row.order || 0) !== 0 || hasIncoming || hasAdjustment;
  if (tab === 'distribution') return Number(row.distribution || 0) !== 0 || hasIncoming || hasAdjustment;
  return hasIncoming || Number(row.order || 0) !== 0 || Number(row.distribution || 0) !== 0 || hasAdjustment;
}

export function classifyFarmComparisonRow(row, mode = 'order') {
  const targetField = mode === 'distribution' ? 'distribution' : 'order';
  const target = round3(row?.[targetField] || 0);
  const received = round3(row?.received || 0);
  const diff = round3(received - target);
  const hasIncoming = received !== 0 || Object.values(row?.incoming || {}).some(q => Number(q) !== 0);
  if (target !== 0 && !hasIncoming) {
    return { target, received, diff, status: 'unreceived', label: '미입고' };
  }
  if (target === 0 && hasIncoming) {
    return {
      target,
      received,
      diff,
      status: 'unordered',
      label: mode === 'distribution' ? '미분배 입고' : '미주문 입고',
    };
  }
  if (target === 0 && !hasIncoming) {
    return { target, received, diff, status: 'adjustment_only', label: '조정 참고' };
  }
  if (diff === 0) return { target, received, diff, status: 'matched', label: '일치' };
  if (diff < 0) return { target, received, diff, status: 'shortage', label: '입고부족' };
  return { target, received, diff, status: 'excess', label: '입고초과' };
}

export function filterFarmBoardRows(allRows, { selected, tab = 'farm', statusFilter = 'all' } = {}) {
  const scoped = (allRows || []).filter(row => varietyKey(row) === selected && hasFarmRowActivityForTab(row, tab));
  if (tab === 'farm' || !statusFilter || statusFilter === 'all') return scoped;
  return scoped.filter(row => {
    const info = classifyFarmComparisonRow(row, tab);
    if (statusFilter === 'mismatch') return info.status !== 'matched' && info.status !== 'adjustment_only';
    if (statusFilter === 'shortage_all') return info.status === 'shortage' || info.status === 'unreceived';
    return info.status === statusFilter;
  });
}

export function summarizeComparisonBoard(rows, mode = 'order') {
  const targetField = mode === 'distribution' ? 'distribution' : 'order';
  const counts = {
    all: 0,
    matched: 0,
    mismatch: 0,
    shortage: 0,
    excess: 0,
    unreceived: 0,
    unordered: 0,
    adjustment_only: 0,
  };
  for (const row of rows || []) {
    counts.all += 1;
    const info = classifyFarmComparisonRow(row, mode);
    counts[info.status] = (counts[info.status] || 0) + 1;
    if (info.status !== 'matched' && info.status !== 'adjustment_only') {
      counts.mismatch += 1;
    }
  }
  const byUnit = summarizeFarmRows(rows).map(total => ({
    unit: total.unit,
    target: round3(total[targetField] || 0),
    received: round3(total.received || 0),
    difference: round3((total.received || 0) - (total[targetField] || 0)),
    adjustment: round3(total.adjustment || 0),
  }));
  return { counts, byUnit };
}

export function formatFarmBoardNumber(value, { explicitZero = false, signed = false } = {}) {
  const num = round3(value);
  if (num === 0) return explicitZero ? '0' : '';
  const formatted = num.toLocaleString('ko-KR', { maximumFractionDigits: 3 });
  return signed && num > 0 ? `+${formatted}` : formatted;
}

export function formatFarmBoardCell(value, key, tab = 'farm') {
  if (typeof value !== 'number') return value ?? '';
  if (key === 'difference') {
    return formatFarmBoardNumber(value, { explicitZero: tab !== 'farm', signed: true });
  }
  if (tab !== 'farm' && (key === 'order' || key === 'distribution' || key === 'received')) {
    return formatFarmBoardNumber(value, { explicitZero: true });
  }
  return formatFarmBoardNumber(value, { explicitZero: false });
}

export function pickActiveVarietySelection(previous, rows = [], varieties = [], tab = 'farm') {
  if (previous && rows.some(row => varietyKey(row) === previous && hasFarmRowActivityForTab(row, tab))) {
    return previous;
  }
  if (previous && rows.some(row => varietyKey(row) === previous)) {
    return previous;
  }
  const preferred = rows.find(row => hasFarmRowActivityForTab(row, tab)) || rows[0] || varieties[0];
  return preferred ? varietyKey(preferred) : previous || '';
}
