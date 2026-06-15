// 카탈로그 추출기(PPT) 레이아웃 — 16:9 와이드, 6/8개형

import { compareProductErpOrder, productGroupKey } from './catalogUtils';

export const SLIDE_W_CM = 33.867;
export const SLIDE_H_CM = 19.05;
export const SLIDE_W_IN = 13.333;
export const SLIDE_H_IN = 7.5;

export const SPACING_PRESETS = {
  narrow: { hgap: 0.3, vgap: 0.2, txtGap: 0.05, top: 3.5, bottom: 0.2, side: 0.3, txtH: 1.8 },
  wide: { hgap: 0.3, vgap: 0.3, txtGap: 0.05, top: 3.5, bottom: 0.3, side: 0.4, txtH: 1.9 },
};

const CM_PER_IN = 2.54;

export function cmToIn(v) {
  return v / CM_PER_IN;
}

export function formatOriginLabel(counName) {
  const c = String(counName || '').trim();
  if (!c) return '';
  if (c.startsWith('원산지')) return c;
  return `원산지 : ${c}`;
}

export function compareCatalogLineOrder(a, b) {
  return compareProductErpOrder(
    {
      cSort: a.cSort,
      fSort: a.fSort,
      fOrderNo: a.fOrderNo,
      CountryFlower: a.countryFlower,
      CounName: a.counName,
      FlowerName: a.flowerName,
      ProdName: a.prodName,
    },
    {
      cSort: b.cSort,
      fSort: b.fSort,
      fOrderNo: b.fOrderNo,
      CountryFlower: b.countryFlower,
      CounName: b.counName,
      FlowerName: b.flowerName,
      ProdName: b.prodName,
    },
  );
}

/** 품종(CountryFlower)별 슬라이드 페이지 — 추출기 slide_items 규칙 */
export function buildCatalogExportPages(lines, { perPage = 8 } = {}) {
  const chunk = perPage === 6 ? 6 : perPage === 10 ? 10 : 8;
  const sorted = [...(lines || [])].sort(compareCatalogLineOrder);
  const groups = [];
  let cur = null;

  for (const line of sorted) {
    const key = line.countryFlower || productGroupKey(line);
    if (!cur || cur.key !== key) {
      cur = {
        key,
        titleBig: line.flowerName || '미분류',
        titleSmall: line.counName || '',
        lines: [],
      };
      groups.push(cur);
    }
    cur.lines.push(line);
  }

  const pages = [];
  for (const g of groups) {
    for (let i = 0; i < g.lines.length; i += chunk) {
      pages.push({
        titleBig: g.titleBig,
        titleSmall: g.titleSmall,
        lines: g.lines.slice(i, i + chunk),
      });
    }
  }
  return pages;
}

/** 추출기 compute_layout — PPT/HTML 공용 */
export function computeCatalogLayout(perPage = 8, spacing = 'wide') {
  const p = SPACING_PRESETS[spacing] || SPACING_PRESETS.wide;
  const cols = perPage === 6 ? 3 : perPage === 10 ? 5 : 4;
  const rows = 2;
  const top = p.top;
  const availW = SLIDE_W_CM - 2 * p.side;
  const availH = SLIDE_H_CM - top - p.bottom;
  const cellW = (availW - (cols - 1) * p.hgap) / cols;
  const cellH = (availH - (rows - 1) * p.vgap) / rows;
  const imgSize = Math.max(2.0, Math.min(cellW, cellH - p.txtH - p.txtGap));

  const cells = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const cellX = p.side + c * (cellW + p.hgap);
      const cellY = top + r * (cellH + p.vgap);
      const ix = cellX + (cellW - imgSize) / 2;
      const iy = cellY;
      cells.push({
        col: c,
        row: r,
        imgXcm: ix,
        imgYcm: iy,
        imgSizeCm: imgSize,
        txtXcm: cellX,
        txtYcm: iy + imgSize + p.txtGap,
        txtWcm: cellW,
        txtHcm: p.txtH,
        cellWcm: cellW,
        cellHcm: cellH,
      });
    }
  }

  return {
    cols,
    rows,
    spacing: p,
    imgSizeCm: imgSize,
    cells,
    hdrTopCm: 1.412,
    hdrLeftCm: 0.546,
    hdrBigPt: 36,
    hdrSubPt: 12,
    logoTopCm: 0.5,
    logoHcm: 2.85,
    logoWcm: 2.85 * (4.72 / 2.85),
    logoLeftCm: SLIDE_W_CM - 2.85 * (4.72 / 2.85) - p.side,
  };
}

export function layoutCssVars(perPage = 8, spacing = 'wide') {
  const layout = computeCatalogLayout(perPage, spacing);
  const p = layout.spacing;
  return {
    '--slide-w': `${SLIDE_W_CM}cm`,
    '--slide-h': `${SLIDE_H_CM}cm`,
    '--grid-cols': layout.cols,
    '--grid-rows': layout.rows,
    '--grid-side': `${p.side}cm`,
    '--grid-top': `${p.top}cm`,
    '--grid-hgap': `${p.hgap}cm`,
    '--grid-vgap': `${p.vgap}cm`,
    '--cell-img': `${layout.imgSizeCm}cm`,
    '--txt-h': `${p.txtH}cm`,
    '--txt-gap': `${p.txtGap}cm`,
  };
}
