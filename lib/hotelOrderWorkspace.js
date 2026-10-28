import { normalizeOrderUnit } from './orderUtils.js';

// Selecting a period alone must not save an empty draft and lock its scope.
export function hasHotelDraftContent(work) {
  return !!(work.request?.length || work.purchase?.length || work.texts?.request?.trim() || work.texts?.purchase?.trim() || work.receipts?.length || work.history?.length);
}

export const hotelQty = n => Math.round(Number(n) * 1e6) / 1e6;
function strictUnit(value) {
  if (!/^(박스|단|송이|개|대|box|bunch|bun|stem|steam|stems|ea|st)$/i.test(String(value || '').trim())) throw Error('수량 단위를 선택하세요.');
  return normalizeOrderUnit(value);
}
export function hotelBoxFactor(unit, p = {}) {
  const u = strictUnit(unit);
  if (u === '박스') return 1;
  if (u === '단') return Number(p.BunchOf1Box) || 0;
  if (u === '송이') return Number(p.SteamOf1Box) || Number(p.BunchOf1Box) * Number(p.SteamOf1Bunch) || 0;
  return 0;
}
export function hotelConvert(qty, from, to, product) {
  if (!Number.isFinite(Number(qty)) || Number(qty) < 0 || qty === '') throw Error('수량은 0 이상의 숫자여야 합니다.');
  const a = strictUnit(from), b = strictUnit(to);
  if (!['박스', '단', '송이'].includes(a) || !['박스', '단', '송이'].includes(b)) throw Error('수량 단위를 선택하세요.');
  if (a === b) return Number(qty);
  const x = hotelBoxFactor(a, product), y = hotelBoxFactor(b, product);
  if (!(x > 0 && y > 0)) throw Error('품목의 박스 환산계수가 없습니다.');
  return hotelQty(Number(qty) / x * y);
}
export function buildHotelOrderRows(request, purchase, products, allocations = {}) {
  const map = new Map(), errors = [];
  for (const [side, lines] of [['request', request], ['purchase', purchase]]) {
    for (const line of lines || []) {
      try {
        const p = products[Number(line.prodKey)];
        if (!line.prodKey || !p) throw Error('품목 매칭이 필요합니다.');
        const key = Number(line.prodKey), unit = strictUnit(p.OutUnit);
        const qty = hotelConvert(line.qty, line.unit, unit, p);
        if (!map.has(key)) map.set(key, { prodKey: key, prodName: p.DisplayName || p.ProdName, unit, request: 0, purchase: 0, perBox: hotelBoxFactor(unit, p) });
        const row = map.get(key); row[side] = hotelQty(row[side] + qty);
      } catch (e) { errors.push(`${line.inputName || line.prodName || '입력행'}: ${e.message}`); }
    }
  }
  const rows = [...map.values()].map(row => {
    const remaining = hotelQty(row.request - row.purchase);
    const surplus = remaining >= 0 && row.perBox > 0 ? hotelQty(Math.floor((remaining + 1e-8) / row.perBox) * row.perBox) : 0;
    const assigned = allocations[row.prodKey] || {};
    let assignedQty = 0;
    for (const [custKey, raw] of Object.entries(assigned)) {
      const n = Number(raw);
      if (!Number.isInteger(Number(custKey)) || Number(custKey) <= 0 || !Number.isFinite(n) || n < 0) errors.push(`${row.prodName}: 업체 분류수량 오류`);
      else assignedQty += n;
    }
    const unassigned = hotelQty(remaining - surplus - assignedQty);
    if (remaining < 0) errors.push(`${row.prodName}: 발주수량이 요청수량을 초과합니다.`);
    if (unassigned < -1e-6) errors.push(`${row.prodName}: 잔량보다 많이 분류했습니다.`);
    if (remaining > 0 && !(row.perBox > 0)) errors.push(`${row.prodName}: 박스 환산계수가 없습니다.`);
    return { ...row, remaining, surplus, assigned, unassigned };
  });
  return { rows, errors };
}
export function hotelRegistrationPlan(model, { year, week, raum, surplus, customers }) {
  if (!/^\d{4}$/.test(String(year)) || !/^\d{2}-0[1-4]$/.test(week) || Number(week.slice(0, 2)) < 1 || Number(week.slice(0, 2)) > 53) throw Error('연도와 차수를 선택하세요.');
  if (model.errors.length) throw Error(model.errors.join('\n'));
  if (!model.rows.length || model.rows.some(r => Math.abs(r.unassigned) > 1e-6)) throw Error('분류필요 수량을 모두 업체에 배정하세요.');
  if (Number(raum) === Number(surplus)) throw Error('라움과 호텔여분은 서로 다른 업체를 선택하세요.');
  const groups = new Map();
  function add(row, custKey, qty) {
    if (!(qty > 0)) return;
    const c = customers.find(c => Number(c.CustKey) === Number(custKey));
    if (!c) throw Error('분류 업체를 선택하세요.');
    if (!groups.has(c.CustKey)) groups.set(c.CustKey, { year: String(year), week, custKey: c.CustKey, custName: c.CustName, items: [] });
    const list = groups.get(c.CustKey).items, existing = list.find(it => it.prodKey === row.prodKey);
    if (existing) existing.qty = hotelQty(existing.qty + qty);
    else list.push({ prodKey: row.prodKey, prodName: row.prodName, unit: row.unit, qty });
  }
  for (const row of model.rows) {
    add(row, raum, row.purchase); add(row, surplus, row.surplus);
    for (const [key, qty] of Object.entries(row.assigned)) add(row, key, Number(qty));
  }
  if (!groups.size) throw Error('등록할 양수 수량이 없습니다.');
  return [...groups.values()];
}

// Saved hotel names may overlap. Never silently choose one of conflicting keys.
export function uniqueHotelMappings(records) {
  const grouped = new Map();
  const token = s => String(s || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
  for (const r of records) {
    const key = token(r.ItemName || r.InputToken), pk = Number(r.ProdKey);
    if (!key || !(pk > 0)) continue;
    if (!grouped.has(key)) grouped.set(key, new Set());
    grouped.get(key).add(pk);
  }
  return { token, groups: grouped };
}
