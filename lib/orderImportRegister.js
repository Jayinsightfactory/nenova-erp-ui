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
      prev.firstSourceRow = Math.min(prev.firstSourceRow, firstImportSourceRow(it));
    } else {
      map.set(key, {
        prodKey: key,
        prodName: it.prodName,
        displayName: it.displayName,
        qty,
        unit: normalizeOrderUnit(it.unit),
        firstSourceRow: firstImportSourceRow(it),
      });
    }
  }
  return [...map.values()].sort(compareImportSourceOrder);
}

export function firstImportSourceRow(item) {
  const detailRows = (Array.isArray(item?.sourceDetails) ? item.sourceDetails : [])
    .map(detail => Number(detail?.rowNo))
    .filter(rowNo => Number.isFinite(rowNo) && rowNo > 0);
  const directRow = Number(item?.rowNo);
  if (Number.isFinite(directRow) && directRow > 0) detailRows.push(directRow);
  return detailRows.length ? Math.min(...detailRows) : Number.MAX_SAFE_INTEGER;
}

function compareImportSourceOrder(left, right) {
  return Number(left.firstSourceRow ?? Number.MAX_SAFE_INTEGER)
    - Number(right.firstSourceRow ?? Number.MAX_SAFE_INTEGER);
}

export function sortImportRowsByProductOrder(rows, orderedProducts) {
  const order = new Map((orderedProducts || []).map((item, index) => [Number(item.prodKey), index]));
  return (rows || []).map((row, index) => ({ row, index })).sort((left, right) => {
    const leftOrder = order.has(Number(left.row?.prodKey)) ? order.get(Number(left.row.prodKey)) : Number.MAX_SAFE_INTEGER;
    const rightOrder = order.has(Number(right.row?.prodKey)) ? order.get(Number(right.row.prodKey)) : Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder || left.index - right.index;
  }).map(entry => entry.row);
}

export function buildImportMatchAggregates(items) {
  const grouped = new Map();
  for (const item of items || []) {
    if (item.skip || !item.prodKey || Number(item.qty) <= 0) continue;
    const unit = normalizeOrderUnit(item.unit);
    const key = `${Number(item.prodKey)}|${unit}`;
    const current = grouped.get(key) || {
      prodKey: Number(item.prodKey),
      prodName: item.prodName,
      displayName: item.displayName,
      counName: item.counName || '',
      flowerName: item.flowerName || '',
      unit,
      qty: 0,
      sourceCount: 0,
      sourceRows: [],
      sourceNames: [],
      firstSourceRow: firstImportSourceRow(item),
    };
    current.qty += Math.abs(Number(item.qty || 0));
    current.firstSourceRow = Math.min(current.firstSourceRow, firstImportSourceRow(item));
    const details = Array.isArray(item.sourceDetails) && item.sourceDetails.length
      ? item.sourceDetails
      : [{ rowNo: item.rowNo, qty: item.qty }];
    current.sourceCount += details.length;
    current.sourceRows.push(...details.map(detail => detail.rowNo).filter(Boolean));
    if (item.inputName && !current.sourceNames.includes(item.inputName)) current.sourceNames.push(item.inputName);
    grouped.set(key, current);
  }
  return [...grouped.values()].sort(compareImportSourceOrder);
}

export function buildImportInlineMatchRows(items) {
  const rows = new Map();
  for (const [itemIndex, item] of (items || []).entries()) {
    const details = Array.isArray(item.sourceDetails) && item.sourceDetails.length
      ? item.sourceDetails
      : [{ rowNo: item.rowNo, qty: item.qty, detailLabel: item.detailLabel || '' }];
    details.forEach((detail, detailIndex) => {
      const rowNo = Number(detail?.rowNo);
      if (!Number.isFinite(rowNo) || rowNo <= 0) return;
      const entry = {
        rowNo,
        itemIndex,
        item,
        sourceQty: Math.abs(Number(detail?.qty ?? item.qty ?? 0)),
        detailLabel: detail?.detailLabel || '',
        isPrimary: detailIndex === 0,
        sourceCount: details.length,
      };
      if (!rows.has(rowNo)) rows.set(rowNo, []);
      rows.get(rowNo).push(entry);
    });
  }
  return [...rows.entries()]
    .sort(([left], [right]) => left - right)
    .map(([rowNo, matches]) => ({ rowNo, matches }));
}

export function findOrderImportMatchInsertIndex(preview) {
  const rows = Array.isArray(preview?.rows) ? preview.rows : [];
  const headerRowNo = Number(preview?.headerRow);
  const header = rows.find(row => Number(row?.rowNo) === headerRowNo) || rows[0];
  const cells = Array.isArray(header?.cells) ? header.cells : [];
  const normalized = cells.map(value => String(value || '').replace(/[\s_]+/g, '').toLowerCase());
  const preferredHeaders = ['발주수량', '주문수량', '수량'];
  for (const name of preferredHeaders) {
    const index = normalized.findIndex(value => value === name);
    if (index >= 0) return index + 1;
  }
  return cells.length;
}

export function findImportMixedUnitProducts(aggregates) {
  const unitsByProduct = new Map();
  for (const row of aggregates || []) {
    const key = Number(row.prodKey);
    if (!unitsByProduct.has(key)) unitsByProduct.set(key, new Set());
    unitsByProduct.get(key).add(normalizeOrderUnit(row.unit));
  }
  return [...unitsByProduct.entries()]
    .filter(([, units]) => units.size > 1)
    .map(([prodKey, units]) => ({ prodKey, units: [...units] }));
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
    UNCHANGED: '동일',
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
