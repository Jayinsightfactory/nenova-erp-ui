// POST — 도착원가 엑셀 업로드 | GET — 현재 오버라이드 | DELETE — 초기화

import fs from 'fs';
import formidable from 'formidable';
import { withAuth } from '../../../lib/auth';
import { query } from '../../../lib/db';
import { parseCatalogArrivalExcel, buildArrivalTemplateWorkbook } from '../../../lib/catalogArrivalExcel';
import {
  loadArrivalOverrides,
  saveArrivalOverrides,
  clearArrivalOverrides,
} from '../../../lib/catalogArrivalOverrides';

export const config = { api: { bodyParser: false } };

const MAX_FILE_SIZE = 15 * 1024 * 1024;

function firstVal(v) {
  return Array.isArray(v) ? v[0] : v;
}

async function loadProducts() {
  const r = await query(
    `SELECT ProdKey, ProdCode, ProdName, DisplayName, OutUnit
     FROM Product WHERE isDeleted=0`,
  );
  return r.recordset;
}

export default withAuth(async function handler(req, res) {
  if (req.method === 'GET') {
    const { template } = req.query;
    if (template === '1') {
      const products = await loadProducts();
      const overrides = loadArrivalOverrides();
      const merged = products.map(p => {
        const ov = overrides.items[String(p.ProdKey)];
        return {
          ...p,
          arrivalCost: ov?.arrivalCost || 0,
          arrivalUnit: ov?.arrivalUnit || p.OutUnit || '단',
        };
      });
      const buf = buildArrivalTemplateWorkbook(merged);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="catalog_arrival_template.xlsx"');
      return res.status(200).send(buf);
    }

    const data = loadArrivalOverrides();
    return res.status(200).json({
      success: true,
      ...data,
      count: Object.keys(data.items || {}).length,
    });
  }

  if (req.method === 'DELETE') {
    clearArrivalOverrides();
    return res.status(200).json({ success: true, message: '엑셀 도착원가가 초기화되었습니다.' });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).end();
  }

  const form = formidable({ maxFileSize: MAX_FILE_SIZE, keepExtensions: true, multiples: false });
  let fields;
  let files;
  try {
    [fields, files] = await new Promise((resolve, reject) => {
      form.parse(req, (err, flds, fls) => (err ? reject(err) : resolve([flds, fls])));
    });
  } catch (e) {
    return res.status(400).json({ success: false, error: `업로드 실패: ${e.message}` });
  }

  const file = firstVal(files.file);
  if (!file) return res.status(400).json({ success: false, error: 'file 필드가 필요합니다.' });

  const ext = String(file.originalFilename || '').toLowerCase();
  if (!ext.endsWith('.xlsx') && !ext.endsWith('.xls')) {
    try { fs.unlinkSync(file.filepath); } catch { /* ignore */ }
    return res.status(400).json({ success: false, error: 'xlsx/xls 파일만 업로드 가능합니다.' });
  }

  try {
    const products = await loadProducts();
    const buf = fs.readFileSync(file.filepath);
    const parsed = parseCatalogArrivalExcel(buf, products);
    if (parsed.matchedCount === 0) {
      return res.status(400).json({
        success: false,
        error: '매칭된 품목이 없습니다. ProdKey/품목명·도착원가 열을 확인하세요.',
        unmatched: parsed.unmatched,
        rowCount: parsed.rowCount,
      });
    }

    const orderYear = String(firstVal(fields.orderYear) || new Date().getFullYear());
    const saved = saveArrivalOverrides({
      fileName: file.originalFilename || 'upload.xlsx',
      orderYear,
      rowCount: parsed.rowCount,
      matchedCount: parsed.matchedCount,
      items: parsed.items,
    });

    return res.status(200).json({
      success: true,
      message: `도착원가 ${parsed.matchedCount}건 적용 (${file.originalFilename})`,
      ...saved,
      unmatchedCount: parsed.unmatchedCount,
      unmatched: parsed.unmatched,
      sheetName: parsed.sheetName,
    });
  } catch (e) {
    return res.status(400).json({ success: false, error: e.message });
  } finally {
    try { fs.unlinkSync(file.filepath); } catch { /* ignore */ }
  }
});
