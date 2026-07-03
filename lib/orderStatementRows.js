// lib/orderStatementRows.js — 주문등록(ViewOrder) → 거래명세표 인쇄 행

import { normalizeOrderUnit } from './orderUtils.js';

/**
 * 주문 상세 1행에서 표시 단위·수량 (주문등록 시 입력 단위 기준)
 */
export function orderDetailQuantityAndUnit(row) {
  const unit = normalizeOrderUnit(
    row.unit || row.OutUnit,
    Number(row.BunchQuantity) > 0 ? '단'
      : Number(row.SteamQuantity) > 0 ? '송이'
        : Number(row.BoxQuantity) > 0 ? '박스' : '박스',
  );

  let qty = 0;
  if (unit === '단') qty = Number(row.BunchQuantity) || 0;
  else if (unit === '송이') qty = Number(row.SteamQuantity) || 0;
  else qty = Number(row.BoxQuantity) || 0;

  if (qty <= 0) qty = Number(row.OutQuantity) || Number(row.qty) || 0;

  return { unit, qty };
}

/**
 * ViewOrder 조회 결과 → 거래명세표 prepareEstimatePrintRows 입력 형식
 * 동일 ProdKey+Unit 은 수량 합산
 */
export function buildPrintRowsFromOrderDetails(rows) {
  const map = new Map();

  for (const row of rows || []) {
    const { unit, qty } = orderDetailQuantityAndUnit(row);
    if (qty <= 0) continue;

    const prodKey = Number(row.ProdKey || row.prodKey);
    if (!prodKey) continue;

    const key = `${prodKey}|${unit}`;
    const prodName = row.DisplayName || row.displayName || row.ProdName || row.prodName || '';
    const existing = map.get(key);

    if (existing) {
      existing.Quantity += qty;
      continue;
    }

    map.set(key, {
      EstimateType: '정상출고',
      ProdKey: prodKey,
      ProdName: prodName,
      DisplayName: prodName,
      FlowerName: row.FlowerName || row.flowerName || '',
      CounName: row.CounName || row.counName || '',
      Unit: unit,
      Quantity: qty,
      Cost: Number(row.Cost) || 0,
      Amount: 0,
      Vat: 0,
      Descr: String(row.Descr || row.descr || '').trim(),
    });
  }

  return [...map.values()].sort((a, b) =>
    (a.ProdName || '').localeCompare(b.ProdName || '', 'ko', { numeric: true, sensitivity: 'base' }),
  );
}

export function parentWeekFromOrderWeek(orderWeek) {
  const w = String(orderWeek || '').trim();
  if (!w) return '';
  const m = w.match(/^(\d{4})-(\d{2})-/);
  if (m) return m[2];
  const dash = w.indexOf('-');
  if (dash > 0) return w.slice(0, dash);
  return w;
}
