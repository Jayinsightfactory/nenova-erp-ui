// 카탈로그 원본(PPTX/XLSX/JSON) → 이미지+품목명 추출 후 ERP 등록

import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { importBufferForProduct } from './catalogImageImport';
import { listImages } from './catalogImages';
import { buildProductMatcher } from './catalogProductMatch';

const CODE_RE = /^[A-Z]{1,5}\d+[A-Z]?$/i;

function stripXml(text) {
  return String(text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** 카탈로그 추출기 JSON / slides_data 형식 */
export function parseCatalogSlidesJson(raw) {
  let data = raw;
  if (typeof raw === 'string') data = JSON.parse(raw);

  const slides = Array.isArray(data) ? data : (data.slides || data.slides_data || []);
  const products = [];

  for (const slide of slides) {
    const list = slide.products || [];
    for (const p of list) {
      let buffer = null;
      if (p.blob_b64) buffer = Buffer.from(p.blob_b64, 'base64');
      else if (p.image_b64) buffer = Buffer.from(p.image_b64, 'base64');
      else if (Buffer.isBuffer(p.blob)) buffer = p.blob;
      products.push({
        name: p.name || '',
        eng_name: p.eng_name || p.engName || '',
        code: p.code || '',
        label: p.label || '',
        buffer,
      });
    }
  }
  return products;
}

/** PPTX — 슬라이드별 텍스트·이미지 순서 매칭 (카탈로그 추출기 레이아웃) */
export async function extractProductsFromPptx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter(n => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
    .sort((a, b) => {
      const na = parseInt(a.match(/slide(\d+)/i)[1], 10);
      const nb = parseInt(b.match(/slide(\d+)/i)[1], 10);
      return na - nb;
    });

  const out = [];

  for (const slidePath of slideFiles) {
    const slideNo = slidePath.match(/slide(\d+)/i)[1];
    const relPath = `ppt/slides/_rels/slide${slideNo}.xml.rels`;
    const slideXml = await zip.file(slidePath).async('string');
    const relXml = zip.file(relPath) ? await zip.file(relPath).async('string') : '';

    const mediaMap = {};
    for (const m of relXml.matchAll(/Id="([^"]+)"[^>]+Target="([^"]+)"/g)) {
      const target = m[2].replace(/^\.\.\//, 'ppt/');
      mediaMap[m[1]] = target;
    }

    const texts = [];
    for (const m of slideXml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)) {
      const t = m[1].trim();
      if (t && t.length > 1 && !/^NENOVA$/i.test(t)) texts.push(t);
    }

    const imageBuffers = [];
    for (const m of slideXml.matchAll(/r:embed="([^"]+)"/g)) {
      const rel = mediaMap[m[1]];
      if (!rel || !/media\//i.test(rel)) continue;
      const f = zip.file(rel);
      if (!f) continue;
      const buf = await f.async('nodebuffer');
      if (buf.length > 2000) imageBuffers.push(buf);
    }

    const n = Math.min(texts.length, imageBuffers.length);
    for (let i = 0; i < n; i += 1) {
      const text = texts[i];
      const parts = text.split(/\s{2,}|\/+/).map(s => s.trim()).filter(Boolean);
      out.push({
        name: parts.length > 1 ? parts[parts.length - 1] : text,
        eng_name: parts.length > 1 ? parts.slice(0, -1).join(' ') : '',
        code: CODE_RE.test(parts[0]) ? parts[0] : '',
        label: text,
        buffer: imageBuffers[i],
      });
    }

    if (imageBuffers.length > texts.length) {
      for (let i = texts.length; i < imageBuffers.length; i += 1) {
        out.push({ name: '', eng_name: '', code: '', label: '', buffer: imageBuffers[i] });
      }
    }
  }

  return out;
}

/** XLSX — 행 코드/품목명 + 셀 앵커 이미지 */
export async function extractProductsFromXlsx(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];

  const rowMeta = new Map();
  ws.eachRow((row, rowNumber) => {
    if (rowNumber < 2) return;
    const vals = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      vals[col] = cell.value != null ? String(cell.value).trim() : '';
    });
    const code = vals[1] || vals[0] || '';
    const nameRaw = vals[3] || vals[2] || vals[1] || '';
    if (!code && !nameRaw) return;
    if (CODE_RE.test(code) || nameRaw.length > 2) {
      rowMeta.set(rowNumber, { code, nameRaw, label: nameRaw || code });
    }
  });

  const products = [];
  const images = ws.getImages?.() || [];

  for (const img of images) {
    const image = wb.getImage(Number(img.imageId));
    if (!image?.buffer) continue;
    const row = (img.range?.tl?.nativeRow ?? img.range?.tl?.row ?? 0) + 1;
    let meta = rowMeta.get(row);
    if (!meta) {
      for (const [rn, m] of rowMeta) {
        if (Math.abs(rn - row) <= 2) { meta = m; break; }
      }
    }
    products.push({
      name: meta?.nameRaw || '',
      eng_name: meta?.code || '',
      code: meta?.code || '',
      label: meta?.label || '',
      buffer: Buffer.from(image.buffer),
    });
  }

  if (!products.length) {
    for (const [rowNumber, meta] of rowMeta) {
      if (!CODE_RE.test(meta.code) && meta.nameRaw.length < 4) continue;
      products.push({
        name: meta.nameRaw,
        eng_name: meta.code,
        code: meta.code,
        label: meta.label,
        buffer: null,
      });
      void rowNumber;
    }
  }

  return products;
}

export async function importCatalogSourceBuffer(buffer, filename, products, uploadedBy) {
  const ext = (filename || '').toLowerCase();
  let extracted = [];

  if (ext.endsWith('.json')) {
    extracted = parseCatalogSlidesJson(buffer.toString('utf8'));
  } else if (ext.endsWith('.pptx')) {
    extracted = await extractProductsFromPptx(buffer);
  } else if (ext.endsWith('.xlsx') || ext.endsWith('.xls')) {
    extracted = await extractProductsFromXlsx(buffer);
  } else {
    throw new Error('지원 형식: .pptx, .xlsx, .json (카탈로그 추출기 형식)');
  }

  const { matchCatalogProduct } = buildProductMatcher(products);
  const matched = [];
  const skipped = [];
  const unmatched = [];
  let noImage = 0;

  for (const item of extracted) {
    if (!item.buffer || item.buffer.length < 100) {
      noImage += 1;
      continue;
    }
    const prod = matchCatalogProduct(item);
    if (!prod) {
      unmatched.push({
        label: item.label || item.name || item.eng_name || '(이름없음)',
        reason: 'no_product_match',
      });
      continue;
    }
    if (listImages({ prodKey: prod.ProdKey }).length > 0) {
      skipped.push({ prodKey: prod.ProdKey, label: item.label || prod.DisplayName });
      continue;
    }
    try {
      importBufferForProduct(
        item.buffer,
        prod.ProdKey,
        `${prod.ProdKey}.jpg`,
        'image/jpeg',
        uploadedBy,
      );
      matched.push({
        prodKey: prod.ProdKey,
        prodName: prod.DisplayName || prod.ProdName,
        label: item.label || item.name,
      });
    } catch (e) {
      unmatched.push({ label: item.label, reason: e.message });
    }
  }

  return {
    source: ext.split('.').pop(),
    extracted: extracted.length,
    matched,
    skipped,
    unmatched: unmatched.slice(0, 80),
    matchedCount: matched.length,
    noImage,
  };
}
