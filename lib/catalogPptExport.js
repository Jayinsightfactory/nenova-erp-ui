// 브라우저 — 카탈로그 PPTX (추출기 build_pptx 레이아웃)

import {
  cmToIn,
  computeCatalogLayout,
  formatOriginLabel,
  SLIDE_H_IN,
  SLIDE_W_IN,
} from './catalogLayout';
import { resolveCatalogPages } from './catalogSlides';
import { absCatalogUrl, catalogLineNames, fmtCatalogSalePrice } from './catalogUtils';

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
}) {
  if (!lines?.length) throw new Error('카탈로그 품목이 없습니다.');

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

      const { eng, kor } = catalogLineNames(line);
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

      const runs = [];
      if (showNames) {
        if (eng) {
          runs.push({
            text: eng,
            options: { breakLine: !!kor, fontSize: 14, bold: true, fontFace: 'Malgun Gothic', color: '222222' },
          });
        }
        if (kor) {
          runs.push({
            text: kor,
            options: { fontSize: 14, bold: true, fontFace: 'Malgun Gothic', color: '222222', breakLine: !!showPrice },
          });
        }
        if (!runs.length) {
          runs.push({
            text: line.catalogName || line.prodName || `품목 ${i + 1}`,
            options: { fontSize: 14, bold: true, fontFace: 'Malgun Gothic', color: '222222', breakLine: !!showPrice },
          });
        }
      }
      if (showPrice) {
        const priceText = fmtCatalogSalePrice(line);
        if (priceText) {
          runs.push({
            text: priceText,
            options: { fontSize: 12, bold: true, fontFace: 'Malgun Gothic', color: 'C0392B' },
          });
        }
      }
      if (runs.length) {
        slide.addText(runs, { x: tx, y: ty, w: tw, h: th, align: 'center', valign: 'top' });
      }
    }
  }

  const safe = String(fileName || 'NENOVA_카탈로그').replace(/[\\/:*?"<>|]/g, '_');
  await pptx.writeFile({ fileName: `${safe}.pptx` });
}

export { SLIDE_W_IN, SLIDE_H_IN };
