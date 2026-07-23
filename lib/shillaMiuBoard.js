// 신라·미우 통합 게시판 — 전산 집계와 공급차수/사용차수 웹 매칭의 순수 조합 로직

export const BOARD_DESTINATIONS = ['RAUM', 'MIU'];

export function normalizeMajorWeek(value) {
  const raw = String(value ?? '').trim();
  const match = raw.match(/(?:^|-)\s*(\d{1,2})(?:-|$)/);
  if (!match) throw new Error(`차수 형식이 올바르지 않습니다: ${value}`);
  const major = Number(match[1]);
  if (!Number.isInteger(major) || major < 1 || major > 52) throw new Error(`차수 범위가 올바르지 않습니다: ${value}`);
  return String(major).padStart(2, '0');
}

export function buildMajorWeeks(start, end) {
  const first = Number(normalizeMajorWeek(start));
  const last = Number(normalizeMajorWeek(end ?? start));
  if (last < first) throw new Error('시작 차수가 종료 차수보다 클 수 없습니다.');
  if (last - first > 20) throw new Error('최대 21개 차수까지만 조회할 수 있습니다.');
  return Array.from({ length: last - first + 1 }, (_, i) => String(first + i).padStart(2, '0'));
}

export function allocationKey({ supplyWeek, useWeek, prodKey, destination }) {
  return `${normalizeMajorWeek(supplyWeek)}|${normalizeMajorWeek(useWeek)}|${Number(prodKey)}|${String(destination || '').toUpperCase()}`;
}

function n(value) {
  const v = Number(value ?? 0);
  return Number.isFinite(v) ? v : 0;
}

function emptyDestination() {
  return { qty: 0, matched: false, sources: [] };
}

function emptyWeek() {
  return {
    orderQty: 0,
    orders: { shilla: 0, raum: 0, miu: 0, other: 0 },
    incomingQty: 0,
    erp: { shilla: 0, raum: 0, miu: 0, other: 0 },
    web: { RAUM: emptyDestination(), MIU: emptyDestination() },
  };
}

function orderDestination(value) {
  const text = String(value || '').toUpperCase();
  if (text === 'SHILLA' || text.includes('신라')) return 'shilla';
  if (text === 'RAUM' || text.includes('라움') || text.includes('트라움')) return 'raum';
  if (text === 'MIU' || text.includes('미우') || text.includes('아이엠')) return 'miu';
  return 'other';
}

function ensureRow(rows, record) {
  const key = Number(record.prodKey);
  if (!rows.has(key)) {
    rows.set(key, {
      prodKey: key,
      country: record.country || '',
      flower: record.flower || '',
      prodName: record.prodName || '',
      unit: record.unit || '',
      openingStock: 0,
      weeks: {},
    });
  }
  const row = rows.get(key);
  row.country ||= record.country || '';
  row.flower ||= record.flower || '';
  row.prodName ||= record.prodName || '';
  row.unit ||= record.unit || '';
  return row;
}

function ensureWeek(row, week) {
  const key = normalizeMajorWeek(week);
  if (!row.weeks[key]) row.weeks[key] = emptyWeek();
  return row.weeks[key];
}

export function buildBoardRows({ weeks, orders = [], incoming = [], shipments = [], allocations = [], openingStocks = [] }) {
  const rows = new Map();
  const addBase = (record) => ensureRow(rows, record);

  for (const record of [...orders, ...incoming, ...shipments, ...openingStocks, ...allocations]) addBase(record);

  for (const record of orders) {
    if (!record.prodKey) continue;
    const week = ensureWeek(ensureRow(rows, record), record.week);
    const orderQty = n(record.qty);
    week.orderQty += orderQty;
    week.orders[orderDestination(record.destination)] += orderQty;
  }
  for (const record of incoming) {
    if (!record.prodKey) continue;
    ensureWeek(ensureRow(rows, record), record.week).incomingQty += n(record.qty);
  }
  for (const record of shipments) {
    if (!record.prodKey) continue;
    const week = ensureWeek(ensureRow(rows, record), record.week);
    week.erp.shilla += n(record.shillaQty);
    week.erp.raum += n(record.raumQty);
    week.erp.miu += n(record.miuQty);
    week.erp.other += n(record.otherQty);
  }
  for (const record of openingStocks) {
    if (!record.prodKey) continue;
    const row = ensureRow(rows, record);
    row.openingStock = n(record.qty);
  }
  for (const record of allocations) {
    if (!record.prodKey || !BOARD_DESTINATIONS.includes(String(record.destination || '').toUpperCase())) continue;
    const destination = String(record.destination).toUpperCase();
    const week = ensureWeek(ensureRow(rows, record), record.useWeek);
    const target = week.web[destination];
    const qty = n(record.qty);
    target.qty += qty;
    target.matched = target.matched || !!record.matched;
    target.sources.push({
      key: record.boardKey ?? null,
      supplyWeek: normalizeMajorWeek(record.supplyWeek),
      useWeek: normalizeMajorWeek(record.useWeek),
      destination,
      qty,
      matched: !!record.matched,
      memo: record.memo || '',
    });
  }

  const orderedWeeks = (weeks || []).map(normalizeMajorWeek);
  return [...rows.values()]
    .map((row) => {
      const normalizedWeeks = {};
      for (const week of orderedWeeks) normalizedWeeks[week] = row.weeks[week] || emptyWeek();
      return { ...row, weeks: normalizedWeeks };
    })
    .filter((row) => orderedWeeks.some((week) => {
      const w = row.weeks[week];
      // 주문·입고·기타 거래처만 있는 품목은 게시판 대상이 아니다.
      // 신라/라움/미우 전산 분배 또는 라움/미우 웹 매칭이 있는 품목만 노출한다.
      return n(w.orders?.shilla) || n(w.orders?.raum) || n(w.orders?.miu)
        || n(w.erp.shilla) || n(w.erp.raum) || n(w.erp.miu)
        || n(w.web.RAUM.qty) || n(w.web.MIU.qty);
    }))
    .sort((a, b) => `${a.country}${a.flower}${a.prodName}`.localeCompare(`${b.country}${b.flower}${b.prodName}`, 'ko'));
}

// 신라·라움 주문 잔량과 이번 차수 미우 분배 필요량을 화면에서 동일하게 계산한다.
export function getOperationalWeekSummary(row, week) {
  const w = row?.weeks?.[normalizeMajorWeek(week)] || emptyWeek();
  const shillaOrder = n(w.orders?.shilla);
  const shillaDistribution = n(w.erp.shilla);
  const shillaRemainder = Math.max(0, shillaOrder - shillaDistribution);
  const raumOrder = n(w.orders?.raum);
  const raumDistribution = n(w.erp.raum) + n(w.web.RAUM.qty);
  const raumRemainder = Math.max(0, raumOrder - raumDistribution);
  const miuDistribution = n(w.erp.miu) + n(w.web.MIU.qty);
  const totalMiuNeed = shillaRemainder + raumRemainder;
  return {
    incoming: n(w.incomingQty),
    shillaOrder,
    shillaDistribution,
    shillaRemainder,
    raumOrder,
    raumDistribution,
    raumRemainder,
    miuDistribution,
    miuNeed: Math.max(0, totalMiuNeed - miuDistribution),
    totalMiuNeed,
  };
}

export function getWeekBalance(row, week, previousBalance = null) {
  const w = row?.weeks?.[normalizeMajorWeek(week)] || emptyWeek();
  const opening = previousBalance == null ? n(row?.openingStock) : n(previousBalance);
  const supplied = opening + n(w.incomingQty);
  const erpUsed = n(w.erp.shilla) + n(w.erp.raum) + n(w.erp.miu) + n(w.erp.other);
  const webUsed = n(w.web.RAUM.qty) + n(w.web.MIU.qty);
  return {
    supplied,
    erpUsed,
    webUsed,
    erpBalance: supplied - erpUsed,
    webBalance: supplied - erpUsed - webUsed,
  };
}
