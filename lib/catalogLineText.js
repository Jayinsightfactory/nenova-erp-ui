// 카탈로그 슬라이드 셀 텍스트 — 영문/한글/단가/기타1~3

import { catalogLineNames, fmtCatalogSalePrice } from './catalogUtils.js';

export const DEFAULT_CATALOG_FONT_SIZES = Object.freeze({
  eng: 14, kor: 14, price: 12, extra1: 10, extra2: 10, extra3: 10,
});

export const DEFAULT_CATALOG_FIELDS = {
  showEng: true,
  showKor: true,
  showPrice: true,
  showExtra1: false,
  showExtra2: false,
  showExtra3: false,
  fontSizes: DEFAULT_CATALOG_FONT_SIZES,
};

export function normalizeCatalogFields(draft = {}) {
  const source = draft && typeof draft === 'object' ? draft : {};
  const f = source.catalogFields && typeof source.catalogFields === 'object'
    ? { ...source, ...source.catalogFields } : source;
  const legacyNamesOff = f.showNames === false;
  const fontSizes = Object.fromEntries(Object.entries(DEFAULT_CATALOG_FONT_SIZES).map(([kind, fallback]) => {
    const raw = f.fontSizes?.[kind];
    const validType = typeof raw === 'number' || (typeof raw === 'string' && raw.trim() !== '');
    const value = validType ? Number(raw) : NaN;
    return [kind, Number.isFinite(value) ? Math.min(48, Math.max(6, value)) : fallback];
  }));
  return {
    showEng: !legacyNamesOff && f.showEng !== false,
    showKor: !legacyNamesOff && f.showKor !== false,
    showPrice: f.showPrice !== false,
    showExtra1: !!f.showExtra1,
    showExtra2: !!f.showExtra2,
    showExtra3: !!f.showExtra3,
    fontSizes,
    layout: f.layout,
  };
}

/** PPT/미리보기/편집기 공용 텍스트 행 */
export function buildCatalogCellLines(line, fields) {
  const f = normalizeCatalogFields(fields);
  const rows = [];
  const { eng, kor } = catalogLineNames(line);

  if (f.showEng && eng) {
    rows.push({ text: eng, kind: 'eng', fontSize: f.fontSizes.eng, bold: true, color: '000000' });
  }
  if (f.showKor && kor) {
    rows.push({ text: kor, kind: 'kor', fontSize: f.fontSizes.kor, bold: true, color: '000000' });
  }
  if ((f.showEng || f.showKor) && !eng && !kor) {
    const fallback = line?.catalogName || line?.prodName;
    if (fallback) {
      rows.push({ text: fallback, kind: 'name', fontSize: f.showEng ? f.fontSizes.eng : f.fontSizes.kor, bold: true, color: '000000' });
    }
  }
  if (f.showPrice) {
    const price = fmtCatalogSalePrice(line);
    if (price) rows.push({ text: price, kind: 'price', fontSize: f.fontSizes.price, bold: true, color: '000000' });
  }
  for (const n of [1, 2, 3]) {
    if (f[`showExtra${n}`]) {
      const v = String(line?.[`extra${n}`] ?? '').trim();
      if (v) rows.push({ text: v, kind: `extra${n}`, fontSize: f.fontSizes[`extra${n}`], bold: false, color: '000000' });
    }
  }
  return rows;
}

export function hasCatalogCellText(line, fields) {
  return buildCatalogCellLines(line, fields).length > 0;
}
