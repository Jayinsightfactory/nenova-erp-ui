// Pure projection of selected-year StockHistory rows; no stock recalculation or DB access.
function text(raw, fallback = '') {
  const value = raw == null ? '' : String(raw).trim();
  return value || fallback;
}

function number(raw) {
  if (raw == null || typeof raw === 'boolean' || text(raw) === '') return null;
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text(raw))) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function period(raw) {
  const value = text(raw);
  const match = value.match(/^(\d{1,2})(?:-(\d{1,2}))?$/);
  const major = match ? Number(match[1]) : null;
  const sub = match?.[2] == null ? null : Number(match[2]);
  if (major >= 1 && major <= 53 && (sub == null || (sub >= 1 && sub <= 99))) {
    return sub == null
      ? { key: `major:${major}`, label: `${major} (세부차수 미지정)`, major: String(major), sub: 0 }
      : { key: `${major}-${sub}`, label: `${major}-${sub}`, major: String(major), sub };
  }
  const prefix = value.match(/^(\d{1,2})-/);
  const hintedMajor = prefix && Number(prefix[1]) >= 1 && Number(prefix[1]) <= 53 ? String(Number(prefix[1])) : '';
  return { key: `invalid:${value}`, label: `${value || '차수 누락'} (차수 확인 필요)`, major: hintedMajor, sub: Infinity };
}

function comparePeriods(a, b) {
  return (Number(a.major) || Infinity) - (Number(b.major) || Infinity) ||
    a.sub - b.sub || a.key.localeCompare(b.key, 'ko', { numeric: true });
}

export function buildStockAdjustmentMatrix(rawRows, scope, catalogWeeks = []) {
  const orderYear = text(scope?.orderYear);
  if (!/^\d{4}$/.test(orderYear) || Number(orderYear) === 0) throw new Error('유효한 연도가 필요합니다.');
  const rawMajor = text(scope?.major);
  if (rawMajor && (!/^\d{1,2}$/.test(rawMajor) || Number(rawMajor) < 1 || Number(rawMajor) > 53)) {
    throw new Error('차수는 전체 또는 1~53이어야 합니다.');
  }
  const major = rawMajor ? String(Number(rawMajor)) : '';
  const search = text(scope?.search);
  const query = search.toLocaleLowerCase();
  const periods = new Map();
  const majors = new Set();
  const groups = new Map();
  const events = [];
  const rememberPeriod = (p) => {
    if (p.major) majors.add(p.major);
    if (!major || p.major === major) periods.set(p.key, p);
  };
  for (const week of Array.isArray(catalogWeeks) ? catalogWeeks : []) rememberPeriod(period(week));
  (Array.isArray(rawRows) ? rawRows : []).forEach((row, index) => {
    // Strict source-year equality prevents same-week records from a different year leaking in.
    if (String(row?.orderYear ?? '') !== orderYear) return;
    const p = period(row.orderWeek);
    rememberPeriod(p);
    if (major && p.major !== major) return;
    const prodKey = text(row.prodKey) || null;
    const productName = text(row.displayName, text(row.productName, prodKey == null ? '품목번호 미확인' : `품목번호 ${prodKey} · 품목정보 미확인`));
    const country = text(row.country, '국가 미확인');
    const flower = text(row.flower, '품종 미확인');
    if (query && ![productName, row.productName, row.displayName, country, flower, prodKey].some((value) => text(value).toLocaleLowerCase().includes(query))) return;
    const before = number(row.beforeValue);
    const after = number(row.afterValue);
    const difference = before == null || after == null ? null : after - before;
    const delta = difference != null && Number.isFinite(difference) ? difference : null;
    const historyKey = text(row.historyKey) || null;
    const unit = text(row.unit, '단위 미확인');
    const key = JSON.stringify([prodKey ?? `missing:${historyKey ?? `row:${index}`}`, unit]);
    const event = {
      historyKey, orderYear, orderWeek: text(row.orderWeek), rawOrderWeek: row.orderWeek ?? null,
      weekKey: p.key, weekLabel: p.label, prodKey, productName, country, flower, unit,
      beforeValue: row.beforeValue ?? null, afterValue: row.afterValue ?? null,
      before, after, delta,
      changeType: text(row.changeType, '유형 미확인'), reason: text(row.reason, '사유 미기재'),
      changedBy: row.changedBy == null ? null : String(row.changedBy),
      changedAt: row.changedAt == null ? null : String(row.changedAt),
    };
    events.push(event);
    if (!groups.has(key)) groups.set(key, { key, prodKey, productName, country, flower, unit, cells: {}, net: 0, eventCount: 0, invalidCount: 0 });
    const group = groups.get(key);
    if (!group.cells[p.key]) group.cells[p.key] = { quantity: 0, eventCount: 0, invalidCount: 0 };
    const cell = group.cells[p.key];
    cell.eventCount += 1;
    group.eventCount += 1;
    if (delta == null) {
      cell.invalidCount += 1;
      group.invalidCount += 1;
      cell.quantity = null;
      group.net = null;
    } else {
      if (cell.quantity != null) cell.quantity += delta;
      if (group.net != null) group.net += delta;
      // Overflow also represents an untrustworthy total, never a valid XLSX number.
      if (cell.quantity != null && !Number.isFinite(cell.quantity)) { cell.quantity = null; cell.invalidCount += 1; }
      if (group.net != null && !Number.isFinite(group.net)) { group.net = null; group.invalidCount += 1; }
    }
  });
  const rows = [...groups.values()].sort((a, b) => a.productName.localeCompare(b.productName, 'ko', { numeric: true }) ||
    String(a.prodKey ?? '').localeCompare(String(b.prodKey ?? ''), 'ko', { numeric: true }) || a.unit.localeCompare(b.unit, 'ko') || a.key.localeCompare(b.key));
  return {
    orderYear, major, search,
    weeks: [...periods.values()].sort(comparePeriods).map(({ key, label }) => ({ key, label })),
    rows, events, availableMajors: [...majors].sort((a, b) => Number(a) - Number(b)),
    eventCount: events.length, invalidCount: events.filter((event) => event.delta == null).length,
  };
}
