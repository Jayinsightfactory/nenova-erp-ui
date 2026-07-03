// lib/importStatementRows.js — 업로드 화면 품목 → 거래명세표 Excel 행 (클라이언트)

import { normalizeOrderUnit } from './orderUtils';

/** 업로드 매칭 그리드 → 견적서/거래명세표 print row */
export function buildStatementRowsFromImportItems(items, products = []) {
  const prodByKey = new Map((products || []).map(p => [Number(p.ProdKey), p]));
  const map = new Map();

  for (const it of items || []) {
    if (it.skip || !it.prodKey || Number(it.qty) <= 0) continue;
    const unit = normalizeOrderUnit(it.unit);
    const key = `${it.prodKey}|${unit}`;
    const prod = prodByKey.get(Number(it.prodKey));
    const cost = Number(prod?.Cost) || 0;
    const prodName = it.displayName || it.prodName || prod?.DisplayName || prod?.ProdName || '';
    const existing = map.get(key);
    if (existing) {
      existing.Quantity += Number(it.qty) || 0;
      continue;
    }
    map.set(key, {
      EstimateType: '정상출고',
      ProdKey: Number(it.prodKey),
      ProdName: prodName,
      DisplayName: prodName,
      FlowerName: it.flowerName || prod?.FlowerName || '',
      CounName: it.counName || prod?.CounName || '',
      Unit: unit,
      Quantity: Number(it.qty) || 0,
      Cost: cost,
      Amount: 0,
      Vat: 0,
      Descr: '',
    });
  }

  return [...map.values()].sort((a, b) =>
    (a.ProdName || '').localeCompare(b.ProdName || '', 'ko', { numeric: true, sensitivity: 'base' }),
  );
}

export function parentWeekFromFullWeek(week) {
  const w = String(week || '').trim();
  const m3 = w.match(/^(\d{4})-(\d{2})-/);
  if (m3) return m3[2];
  const m2 = w.match(/^(\d{2})-/);
  if (m2) return m2[1];
  return w.replace(/[^\d]/g, '').slice(0, 2);
}
