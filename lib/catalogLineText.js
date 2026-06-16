// 카탈로그 슬라이드 셀 텍스트 — 영문/한글/단가/기타1~3

import { catalogLineNames, fmtCatalogSalePrice } from './catalogUtils.js';

export const DEFAULT_CATALOG_FIELDS = {
  showEng: true,
  showKor: true,
  showPrice: true,
  showExtra1: false,
  showExtra2: false,
  showExtra3: false,
};

export function normalizeCatalogFields(draft = {}) {
  const legacyNamesOff = draft.showNames === false;
  return {
    showEng: !legacyNamesOff && draft.showEng !== false,
    showKor: !legacyNamesOff && draft.showKor !== false,
    showPrice: draft.showPrice !== false,
    showExtra1: !!draft.showExtra1,
    showExtra2: !!draft.showExtra2,
    showExtra3: !!draft.showExtra3,
  };
}

/** PPT/미리보기/편집기 공용 텍스트 행 */
export function buildCatalogCellLines(line, fields) {
  const f = fields || DEFAULT_CATALOG_FIELDS;
  const rows = [];
  const { eng, kor } = catalogLineNames(line);

  if (f.showEng && eng) {
    rows.push({ text: eng, kind: 'eng', fontSize: 14, bold: true, color: '000000' });
  }
  if (f.showKor && kor) {
    rows.push({ text: kor, kind: 'kor', fontSize: 14, bold: true, color: '000000' });
  }
  if ((f.showEng || f.showKor) && !eng && !kor) {
    const fallback = line?.catalogName || line?.prodName;
    if (fallback) {
      rows.push({ text: fallback, kind: 'name', fontSize: 14, bold: true, color: '000000' });
    }
  }
  if (f.showPrice) {
    const price = fmtCatalogSalePrice(line);
    if (price) rows.push({ text: price, kind: 'price', fontSize: 12, bold: true, color: '000000' });
  }
  for (const n of [1, 2, 3]) {
    if (f[`showExtra${n}`]) {
      const v = String(line?.[`extra${n}`] || '').trim();
      if (v) rows.push({ text: v, kind: `extra${n}`, fontSize: 10, bold: false, color: '000000' });
    }
  }
  return rows;
}

export function hasCatalogCellText(line, fields) {
  return buildCatalogCellLines(line, fields).length > 0;
}
