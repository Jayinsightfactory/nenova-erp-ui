// 카탈로그 추출기(PPT) 레이아웃 — 16:9 와이드, 칸수 1~10 (1~5칸=1행, 6~10칸=2행)

import { compareProductErpOrder, productGroupKey } from './catalogUtils.js';
import { buildCatalogCellLines } from './catalogLineText.js';

/** 슬라이드당 칸 수 — 1~100 정수(행×열 곱), 그 외 8 */
export function catalogSlotCount(perPage) {
  const n = Math.round(Number(perPage));
  if (Number.isFinite(n) && n >= 1 && n <= 100) return n;
  return 8;
}

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

/** 슬라이드 원산지 입력 — 접두어 제거 후 저장 */
export function normalizeOriginInput(text) {
  return String(text || '').replace(/^원산지\s*:\s*/i, '').trim();
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
  const chunk = catalogSlotCount(perPage);
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
export function computeCatalogLayout(perPage = 8, spacing = 'wide', opts = {}) {
  const p = SPACING_PRESETS[spacing] || SPACING_PRESETS.wide;
  const n = catalogSlotCount(perPage);
  // 열 수 지정(행×열 모드, 예: 2×10=20칸) — 미지정이면 기존 휴리스틱(1~5칸=1행, 6~10칸=2행)
  const optCols = Math.round(Number(opts.cols));
  const cols = Number.isFinite(optCols) && optCols >= 1 && optCols <= 10
    ? Math.min(optCols, n)
    : Math.ceil(n / (n <= 5 ? 1 : 2));
  const rows = Math.ceil(n / cols);
  // 텍스트 영역 높이 — 기본 프리셋 이상, 텍스트 줄수가 많으면 자동 확장(이미지가 줄어 겹침 방지)
  const txtH = Math.max(p.txtH, Number(opts.txtHcm) || 0);
  const top = p.top;
  const availW = SLIDE_W_CM - 2 * p.side;
  const availH = SLIDE_H_CM - top - p.bottom;
  const cellW = (availW - (cols - 1) * p.hgap) / cols;
  const cellH = (availH - (rows - 1) * p.vgap) / rows;
  const imgSize = Math.max(2.0, Math.min(cellW, cellH - txtH - p.txtGap));

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
        txtHcm: txtH,
        cellWcm: cellW,
        cellHcm: cellH,
      });
    }
  }

  return {
    cols,
    rows,
    spacing: p,
    txtHcm: txtH,
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

export function layoutCssVars(perPage = 8, spacing = 'wide', opts = {}) {
  const layout = computeCatalogLayout(perPage, spacing, opts);
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
    '--txt-h': `${layout.txtHcm}cm`,
    '--txt-gap': `${p.txtGap}cm`,
    '--hdr-left': `${layout.hdrLeftCm}cm`,
    '--hdr-top': `${layout.hdrTopCm}cm`,
    '--hdr-big-pt': `${layout.hdrBigPt}pt`,
    '--hdr-sub-pt': `${layout.hdrSubPt}pt`,
    '--logo-left': `${layout.logoLeftCm}cm`,
    '--logo-top': `${layout.logoTopCm}cm`,
    '--logo-w': `${layout.logoWcm}cm`,
    '--logo-h': `${layout.logoHcm}cm`,
  };
}

/**
 * 텍스트 자동 높이 — 배치된 품목들의 텍스트(줄바꿈 포함)가 가장 긴 칸 기준으로
 * 필요한 텍스트 영역 높이(cm)를 추정. computeCatalogLayout/layoutCssVars 의
 * opts.txtHcm 으로 넘기면 이미지가 그만큼 줄어 다음 행과 겹치지 않음.
 * (미리보기 CSS·PPT 텍스트박스가 같은 값을 쓰므로 화면=출력 동일)
 */
const PT_TO_CM = 0.03528;
export function estimateCatalogAutoTxtHcm(lines, fields, perPage = 8, spacing = 'wide', opts = {}) {
  const list = (lines || []).filter(Boolean);
  if (!list.length) return 0;
  const base = computeCatalogLayout(perPage, spacing, { cols: opts.cols });
  const cellW = Math.max(base.cells[0]?.cellWcm || 1, 0.5);
  let maxCm = 0;
  for (const line of list) {
    const rows = buildCatalogCellLines(line, fields);
    let cm = 0;
    for (const row of rows) {
      const em = row.fontSize * PT_TO_CM;
      let w = 0;
      for (const ch of String(row.text || '')) {
        w += /[가-힣ㄱ-ㅎㅏ-ㅣ一-鿿]/.test(ch) ? em : em * 0.56;
      }
      const wraps = Math.max(1, Math.ceil(w / cellW));
      cm += wraps * em * 1.25 + 0.05;
    }
    if (cm > maxCm) maxCm = cm;
  }
  return Math.ceil(maxCm * 100) / 100;
}

/** PPT 칸 이미지 정사각 크기 (편집기·크롭 안내용) */
export function catalogPptImageSizeLabel(perPage = 8, spacing = 'wide', opts = {}) {
  const cm = computeCatalogLayout(perPage, spacing, opts).imgSizeCm;
  return `${cm.toFixed(1)}cm × ${cm.toFixed(1)}cm`;
}
