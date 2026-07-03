// lib/orderImportRegister.js — 업로드 주문등록 페이지(클라이언트) 전용

import { normalizeOrderUnit } from './orderUtils';

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
