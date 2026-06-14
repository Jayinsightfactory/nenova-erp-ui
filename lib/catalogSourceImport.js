// 카탈로그 원본(PPTX/XLSX/JSON/ZIP) → 이미지+품목명 추출 후 ERP 등록

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { importBufferForProduct } from './catalogImageImport';
import { listImages } from './catalogImages';
import { buildProductMatcher } from './catalogProductMatch';

const execFileAsync = promisify(execFile);

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
        label: p.label || `${p.eng_name || p.engName || ''} ${p.name || ''}`.trim(),
        buffer,
      });
    }
  }
  return products;
}

/** ZIP — 내부 PPTX/XLSX/JSON 자동 선택 (카달로그 추출기 ZIP 등) */
export async function unpackCatalogZip(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const priority = ['.pptx', '.xlsx', '.xls', '.json'];
  const entries = Object.keys(zip.files)
    .filter(n => !zip.files[n].dir)
    .map(n => ({ name: n, ext: n.toLowerCase().slice(n.lastIndexOf('.')) }))
    .filter(e => priority.includes(e.ext))
    .sort((a, b) => {
      const pa = priority.indexOf(a.ext);
      const pb = priority.indexOf(b.ext);
      if (pa !== pb) return pa - pb;
      const aIntegrated = /통합|integrated|catalog/i.test(a.name);
      const bIntegrated = /통합|integrated|catalog/i.test(b.name);
      if (aIntegrated !== bIntegrated) return aIntegrated ? -1 : 1;
      return a.name.length - b.name.length;
    });

  if (!entries.length) throw new Error('ZIP 안에 PPTX/XLSX/JSON 없음');

  const pick = entries[0];
  const file = zip.file(pick.name);
  const inner = await file.async('nodebuffer');
  return { buffer: inner, filename: path.basename(pick.name) };
}

/** Python 카달로그 추출기 — spatial matching */
export async function extractProductsFromPptxPython(buffer, filename = 'upload.pptx') {
  const script = path.join(process.cwd(), 'scripts', 'pptx_to_json.py');
  const extractorDir = path.join(process.cwd(), '_catalog-ref-browser');
  if (!fs.existsSync(script) || !fs.existsSync(path.join(extractorDir, 'app.py'))) {
    return null;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-pptx-'));
  const safeName = (filename || 'upload.pptx').replace(/[^\w.\-가-힣]/g, '_');
  const pptxPath = path.join(tmpDir, safeName);
  try {
    fs.writeFileSync(pptxPath, buffer);
    const { stdout } = await execFileAsync('python', [script, pptxPath], {
      env: { ...process.env, CATALOG_EXTRACTOR_DIR: extractorDir },
      maxBuffer: 250 * 1024 * 1024,
      timeout: 180000,
    });
    const flat = JSON.parse(stdout);
    return flat.map(p => ({
      name: p.name || '',
      eng_name: p.eng_name || '',
      code: '',
      label: p.label || `${p.eng_name || ''} ${p.name || ''}`.trim(),
      buffer: p.blob_b64 ? Buffer.from(p.blob_b64, 'base64') : null,
    }));
  } catch {
    return null;
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

/** PPTX — JSZip fallback (Python 없을 때) */
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
  let ext = (filename || '').toLowerCase();
  let sourceBuffer = buffer;
  let sourceName = filename;
  let extractEngine = 'js';

  if (ext.endsWith('.zip')) {
    const unpacked = await unpackCatalogZip(buffer);
    sourceBuffer = unpacked.buffer;
    sourceName = unpacked.filename;
    ext = sourceName.toLowerCase();
  }

  let extracted = [];

  if (ext.endsWith('.json')) {
    extracted = parseCatalogSlidesJson(sourceBuffer.toString('utf8'));
  } else if (ext.endsWith('.pptx')) {
    const py = await extractProductsFromPptxPython(sourceBuffer, sourceName);
    if (py?.length) {
      extracted = py;
      extractEngine = 'python';
    } else {
      extracted = await extractProductsFromPptx(sourceBuffer);
    }
  } else if (ext.endsWith('.xlsx') || ext.endsWith('.xls')) {
    extracted = await extractProductsFromXlsx(sourceBuffer);
  } else {
    throw new Error('지원 형식: .pptx, .xlsx, .json, .zip (카탈로그 추출기)');
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
    extractEngine,
    extracted: extracted.length,
    matched,
    skipped,
    unmatched: unmatched.slice(0, 80),
    matchedCount: matched.length,
    noImage,
  };
}
