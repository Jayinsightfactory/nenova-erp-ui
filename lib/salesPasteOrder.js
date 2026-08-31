import { buildForwardOrderWeeks } from './myCustomerOrderEntry.js';

export function buildSalesPasteWeekChoices(now = new Date()) {
  const all = buildForwardOrderWeeks(now);
  const defaultChoice = all.find(choice => choice.default) || all[0];
  if (!defaultChoice) return [];
  const start = all.findIndex(choice => choice.year === defaultChoice.year && choice.week === defaultChoice.week);
  const baseMajor = Number(defaultChoice.week.split('-')[0]);
  const baseYear = Number(defaultChoice.year);
  const result = [];
  for (let index = Math.max(0, start); index < all.length && result.length < 8; index += 1) {
    const choice = all[index];
    const major = Number(choice.week.split('-')[0]);
    let offset = (Number(choice.year) - baseYear) * 52 + major - baseMajor;
    if (offset < 0 || offset > 3) continue;
    result.push({ ...choice, offset, groupLabel: offset === 0 ? '베이스' : `+${offset}` });
  }
  return result;
}

export function salesManagerOptions(customers = [], currentUser = {}) {
  const names = new Set(customers.map(row => String(row.ManagerName || '').trim()).filter(Boolean));
  if (currentUser?.userName) names.add(String(currentUser.userName).trim());
  return [...names].sort((a, b) => a.localeCompare(b, 'ko'));
}

export function salesManagerCustomers(customers = [], manager = '') {
  const target = String(manager || '').trim();
  return customers.filter(row => !target || String(row.ManagerName || '').trim() === target);
}

export function buildSalesPasteText({ year, week, customerName, text }) {
  return `${year}년 ${week}차\n${String(customerName || '').trim()}\n${String(text || '').trim()}`;
}

export function buildSalesPasteRows(parsedOrders = [], currentProducts = []) {
  const current = new Map(currentProducts.map(row => [Number(row.ProdKey), Number(row.CurrentQty || 0)]));
  const rows = [];
  const matched = new Map();
  const unitsByProduct = new Map();
  parsedOrders.forEach(order => (order.items || []).forEach(item => {
    if (!item.prodKey) {
      rows.push({ ...item, customerInput: order.custName || '', currentQty: 0, finalQty: null });
      return;
    }
    const key = `${Number(item.prodKey)}|${String(item.unit || '')}`;
    if (!unitsByProduct.has(Number(item.prodKey))) unitsByProduct.set(Number(item.prodKey), new Set());
    unitsByProduct.get(Number(item.prodKey)).add(String(item.unit || ''));
    const previous = matched.get(key);
    if (previous) previous.qty += Number(item.qty || 0);
    else matched.set(key, { ...item, qty: Number(item.qty || 0), customerInput: order.custName || '' });
  }));
  matched.forEach(item => {
    const currentQty = Number(current.get(Number(item.prodKey)) || 0);
    const unitConflict = (unitsByProduct.get(Number(item.prodKey))?.size || 0) > 1;
    rows.push({ ...item, unitConflict, currentQty, finalQty: unitConflict ? null : currentQty + Number(item.qty || 0) });
  });
  return rows;
}
