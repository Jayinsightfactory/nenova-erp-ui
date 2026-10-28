'use strict';

const OFFSET = 9 * 60 * 60 * 1000;

function averageSalesWindow(now = new Date()) {
  const kst = new Date(Number(now) + OFFSET);
  if (!Number.isFinite(kst.getTime())) throw new Error('INVALID_DATE');
  const year = kst.getUTCFullYear();
  const month = kst.getUTCMonth();
  const day = kst.getUTCDate();
  const priorYear = year - 1;
  const lastDay = new Date(Date.UTC(priorYear, month + 1, 0)).getUTCDate();
  const from = new Date(Date.UTC(priorYear, month, Math.min(day, lastDay)));
  const to = new Date(Date.UTC(year, month, day + 1));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), months: 12 };
}

function normalizeCustomerName(value) {
  return String(value || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ko-KR');
}

function buildCustomerNameIndex(customers = []) {
  const index = new Map();
  for (const customer of customers) {
    const name = normalizeCustomerName(customer.CustName ?? customer.name);
    if (!name) continue;
    const entries = index.get(name) || [];
    entries.push(customer);
    index.set(name, entries);
  }
  return index;
}

function attachCustomerAverages(ecountRows, customers, metrics, { userId, admin = false } = {}) {
  const byName = buildCustomerNameIndex(customers);
  const uid = String(userId || '').trim().toLocaleLowerCase('en-US');
  const mapped = [];
  for (const row of ecountRows) {
    const name = String(row.name || '').trim();
    const matches = byName.get(normalizeCustomerName(name)) || [];
    const candidate = matches.length === 1 ? matches[0] : null;
    const customer = candidate && candidate.active !== false && candidate.active !== 0 ? candidate : null;
    if (!admin && (!customer || Number(customer.managerMatchCount) !== 1 ||
        String(customer.managerUserId || '').trim().toLocaleLowerCase('en-US') !== uid)) continue;
    const metric = customer ? metrics.get(Number(customer.CustKey ?? customer.custKey)) : null;
    mapped.push({
      ...row,
      custKey: customer ? Number(customer.CustKey ?? customer.custKey) : null,
      avgSalesMonthly: metric ? Number(metric.avgSalesMonthly) || 0 : null,
      avgSalesCycle: metric && Number(metric.cycleCount) > 0 ? Number(metric.avgSalesCycle) || 0 : null,
    });
  }
  return mapped;
}

module.exports = { averageSalesWindow, normalizeCustomerName, buildCustomerNameIndex, attachCustomerAverages };
