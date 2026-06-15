// 브라우저 — 카탈로그 PPTX (추출기 build_pptx 레이아웃)

import {
  cmToIn,
  computeCatalogLayout,
  formatOriginLabel,
  SLIDE_H_IN,
  SLIDE_W_IN,
} from './catalogLayout';
import { resolveCatalogPages } from './catalogSlides';
import { absCatalogUrl } from './catalogUtils';
import { buildCatalogCellLines, normalizeCatalogFields } from './catalogLineText';

async function urlToDataUri(url) {
  const full = absCatalogUrl(url);
  if (!full) return null;
  const res = await fetch(full, { credentials: 'include' });
  if (!res.ok) return null;
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export async function exportCatalogPpt({
  lines,
  composerSlides,
  imagesByProd,
  perPage = 8,
  spacing = 'wide',
  fileName = 'NENOVA_카탈로그',
  showNames = true,
  showPrice = true,
  catalogFields,
}) {
  if (!lines?.length) throw new Error('카탈로그 품목이 없습니다.');

  const fields = catalogFields || normalizeCatalogFields({ showNames, showPrice });

  const pages = resolveCatalogPages({
    lines,
    composerSlides,
    perPage,
    imagesByProd,
  });
  const layout = computeCatalogLayout(perPage, spacing);

  const { default: PptxGenJS } = await import('pptxgenjs');
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'NENOVA';

  for (const page of pages) {
    const slide = pptx.addSlide();

    slide.addText(page.titleBig || '미분류', {
      x: cmToIn(layout.hdrLeftCm),
      y: cmToIn(layout.hdrTopCm),
      w: 8.5,
      h: 0.55,
      fontSize: layout.hdrBigPt,
      bold: true,
      fontFace: 'Malgun Gothic',
      color: '000000',
    });
    if (page.titleSmall) {
      slide.addText(formatOriginLabel(page.titleSmall), {
        x: cmToIn(layout.hdrLeftCm) + 2.8,
        y: cmToIn(layout.hdrTopCm) + 0.05,
        w: 5,
        h: 0.35,
        fontSize: layout.hdrSubPt,
        bold: true,
        fontFace: 'Malgun Gothic',
        color: '000000',
      });
    }
    slide.addText('NENOVA', {
      x: cmToIn(layout.logoLeftCm),
      y: cmToIn(layout.logoTopCm),
      w: cmToIn(layout.logoWcm),
      h: cmToIn(layout.logoHcm),
      fontSize: 9,
      bold: true,
      color: '1a3a6b',
      align: 'right',
    });

    for (let i = 0; i < page.lines.length; i += 1) {
      const line = page.lines[i];
      const cell = layout.cells[i];
      if (!cell) break;

      const cellLines = buildCatalogCellLines(line, fields);
      const ix = cmToIn(cell.imgXcm);
      const iy = cmToIn(cell.imgYcm);
      const isz = cmToIn(cell.imgSizeCm);
      const tx = cmToIn(cell.txtXcm);
      const ty = cmToIn(cell.txtYcm);
      const tw = cmToIn(cell.txtWcm);
      const th = cmToIn(cell.txtHcm);

      if (line.imageUrl) {
        try {
          const data = await urlToDataUri(line.imageUrl);
          if (data) {
            slide.addImage({ data, x: ix, y: iy, w: isz, h: isz, sizing: { type: 'contain', w: isz, h: isz } });
          }
        } catch { /* skip */ }
      }

      const runs = cellLines.map((row, ri) => ({
        text: row.text,
        options: {
          breakLine: ri < cellLines.length - 1,
          fontSize: row.fontSize,
          bold: row.bold !== false,
          fontFace: 'Malgun Gothic',
          color: row.color,
        },
      }));
      if (runs.length) {
        slide.addText(runs, { x: tx, y: ty, w: tw, h: th, align: 'center', valign: 'top' });
      }
    }
  }

  const safe = String(fileName || 'NENOVA_카탈로그').replace(/[\\/:*?"<>|]/g, '_');
  await pptx.writeFile({ fileName: `${safe}.pptx` });
}

export { SLIDE_W_IN, SLIDE_H_IN };
