// 브라우저 — 카탈로그 PPTX 내보내기

import { absCatalogUrl, fmtNum } from './catalogUtils';

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
  title,
  lines,
  perPage = 8,
  custName,
  weekLabel,
}) {
  if (!lines?.length) throw new Error('카탈로그 품목이 없습니다.');

  const { default: PptxGenJS } = await import('pptxgenjs');
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'NENOVA';

  const cols = perPage === 6 ? 3 : 4;
  const rows = 2;
  const perSlide = cols * rows;
  const slideW = 13.33;
  const slideH = 7.5;
  const marginX = 0.35;
  const marginY = 0.85;
  const gapX = 0.12;
  const gapY = 0.15;
  const cellW = (slideW - marginX * 2 - gapX * (cols - 1)) / cols;
  const cellH = (slideH - marginY - 0.35 - gapY * (rows - 1)) / rows;

  for (let si = 0; si < lines.length; si += perSlide) {
    const chunk = lines.slice(si, si + perSlide);
    const slide = pptx.addSlide();

    slide.addText('NENOVA', {
      x: marginX, y: 0.12, w: 2, h: 0.3, fontSize: 9, bold: true, color: '1a3a6b',
    });
    slide.addText(title || '카탈로그', {
      x: marginX, y: 0.35, w: slideW - marginX * 2, h: 0.45,
      fontSize: 16, bold: true, align: 'center',
    });
    const sub = [custName, weekLabel].filter(Boolean).join(' · ');
    if (sub) {
      slide.addText(sub, {
        x: marginX, y: 0.72, w: slideW - marginX * 2, h: 0.25,
        fontSize: 10, color: '666666', align: 'center',
      });
    }

    for (let i = 0; i < chunk.length; i += 1) {
      const line = chunk[i];
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = marginX + col * (cellW + gapX);
      const y = marginY + row * (cellH + gapY);

      slide.addShape(pptx.ShapeType.rect, {
        x, y, w: cellW, h: cellH,
        line: { color: 'CCCCCC', width: 0.75 },
        fill: { color: 'FFFFFF' },
      });

      const imgH = cellH * 0.55;
      if (line.imageUrl) {
        try {
          const data = await urlToDataUri(line.imageUrl);
          if (data) {
            slide.addImage({
              data, x: x + 0.08, y: y + 0.08, w: cellW - 0.16, h: imgH - 0.08,
            });
          }
        } catch { /* skip image */ }
      }

      slide.addText(line.catalogName || line.prodName || '', {
        x: x + 0.06, y: y + imgH, w: cellW - 0.12, h: 0.35,
        fontSize: 9, bold: true, valign: 'top', wrap: true,
      });
      slide.addText(`${line.counName || ''} · ${line.flowerName || ''}`.trim(), {
        x: x + 0.06, y: y + imgH + 0.32, w: cellW - 0.12, h: 0.2,
        fontSize: 7, color: '888888',
      });
      const priceTxt = fmtNum(line.salePrice)
        ? `${fmtNum(line.salePrice)}원 /${line.outUnit || '단'}`
        : '단가 문의';
      slide.addText(priceTxt, {
        x: x + 0.06, y: y + cellH - 0.32, w: cellW - 0.12, h: 0.28,
        fontSize: 10, bold: true, color: '0066CC', align: 'center',
      });
    }
  }

  const safeName = (title || 'NENOVA_카탈로그').replace(/[\\/:*?"<>|]/g, '_');
  await pptx.writeFile({ fileName: `${safeName}.pptx` });
}
