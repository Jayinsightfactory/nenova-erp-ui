// lib/orderImportRegister.js — 업로드 주문등록 페이지(클라이언트) 전용

import { normalizeOrderUnit, orderRowMatchesWeek } from './orderUtils.js';

export function mergeRegisterItems(items) {
  const map = new Map();
  for (const it of items) {
    if (it.skip || !it.prodKey) continue;
    const key = Number(it.prodKey);
    const prev = map.get(key);
    const qty = Math.abs(Number(it.qty || 0));
    if (prev) {
      prev.qty += qty;
    } else {
      map.set(key, {
        prodKey: key,
        prodName: it.prodName,
        displayName: it.displayName,
        qty,
        unit: normalizeOrderUnit(it.unit),
      });
    }
  }
  return [...map.values()];
}

export function setImportItemsSkip(items, skip) {
  return (items || []).map((it) => ({ ...it, skip: Boolean(skip) }));
}

export function importSkipCounts(items) {
  const list = items || [];
  const skipped = list.filter((it) => it.skip).length;
  return {
    total: list.length,
    skipped,
    included: list.length - skipped,
    allSkipped: list.length > 0 && skipped === list.length,
    noneSkipped: skipped === 0,
  };
}

export function pickImportRegisteredOrder(ordersList, custName, targetWeek) {
  if (!ordersList?.length) return null;
  const byYear = ordersList.find((r) => r.custName === custName && orderRowMatchesWeek(r, targetWeek));
  if (byYear) return byYear;
  const byCust = ordersList.find((r) => r.custName === custName) || ordersList[0];
  return orderRowMatchesWeek(byCust, targetWeek) ? byCust : null;
}

export function importWriteStatusLabel(status) {
  const map = {
    OK: '신규',
    ADDED: '추가',
    UPDATED: '변경',
    DELETED: '삭제',
    CANCELLED: '취소',
    SKIPPED: '건너뜀',
  };
  return map[status] || status || '';
}

export function buildImportRegisterResult({
  apiResults = [],
  dbOrder = null,
  skippedItems = [],
  orderMasterKey = null,
  warning = null,
} = {}) {
  return {
    orderMasterKey,
    warning,
    writeRows: Array.isArray(apiResults) ? apiResults : [],
    dbItems: dbOrder?.items || [],
    custName: dbOrder?.custName || '',
    week: dbOrder?.week || '',
    year: dbOrder?.year || '',
    custKey: dbOrder?.custKey || null,
    skippedItems: skippedItems.map((it) => ({
      inputName: it.inputName,
      prodName: it.displayName || it.prodName,
      qty: it.qty,
      unit: it.unit,
      reason: it.skip ? '제외' : (!it.prodKey ? '미매칭' : (Number(it.qty) <= 0 ? '수량0' : '제외')),
    })),
  };
}
