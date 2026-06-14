// 카탈로그 — 엑셀 업로드 도착원가 오버라이드 (파일 저장)

import fs from 'fs';
import path from 'path';

export const OVERRIDES_PATH = path.join(process.cwd(), 'data', 'catalog-arrival-overrides.json');

export function loadArrivalOverrides() {
  try {
    const raw = fs.readFileSync(OVERRIDES_PATH, 'utf8');
    const data = JSON.parse(raw);
    return {
      updatedAt: data.updatedAt || null,
      fileName: data.fileName || null,
      orderYear: data.orderYear || null,
      rowCount: data.rowCount || 0,
      matchedCount: data.matchedCount || 0,
      items: data.items && typeof data.items === 'object' ? data.items : {},
    };
  } catch {
    return {
      updatedAt: null,
      fileName: null,
      orderYear: null,
      rowCount: 0,
      matchedCount: 0,
      items: {},
    };
  }
}

export function saveArrivalOverrides(payload) {
  fs.mkdirSync(path.dirname(OVERRIDES_PATH), { recursive: true });
  const data = {
    updatedAt: new Date().toISOString(),
    fileName: payload.fileName || null,
    orderYear: payload.orderYear || null,
    rowCount: payload.rowCount || 0,
    matchedCount: payload.matchedCount || 0,
    items: payload.items || {},
  };
  fs.writeFileSync(OVERRIDES_PATH, JSON.stringify(data, null, 2), 'utf8');
  return data;
}

export function clearArrivalOverrides() {
  try {
    if (fs.existsSync(OVERRIDES_PATH)) fs.unlinkSync(OVERRIDES_PATH);
  } catch { /* ignore */ }
  return loadArrivalOverrides();
}

export function overridesToArrivalMap(items) {
  const map = {};
  for (const [pk, row] of Object.entries(items || {})) {
    const cost = Number(row.arrivalCost || 0);
    if (!(cost > 0)) continue;
    map[Number(pk)] = {
      arrivalCost: cost,
      displayUnit: row.arrivalUnit || row.unit || '단',
      source: 'upload',
      arrivalWeek: row.arrivalWeek || null,
      isFallback: false,
      fileName: row.fileName || null,
    };
  }
  return map;
}
