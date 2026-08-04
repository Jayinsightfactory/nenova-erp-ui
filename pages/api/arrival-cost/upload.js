// POST multipart — 도착원가 엑셀을 새 revision으로 저장

import fs from 'fs';
import formidable from 'formidable';
import { withAuth } from '../../../lib/auth.js';
import { query } from '../../../lib/db.js';
import { parseArrivalCostWorkbook } from '../../../lib/arrivalCostExcel.js';
import { createArrivalCostImport } from '../../../lib/arrivalCost.js';
import { loadMappings } from '../../../lib/parseMappings.js';

export const config = { api: { bodyParser: false } };
const MAX_FILE_SIZE = 30 * 1024 * 1024;

function first(value) { return Array.isArray(value) ? value[0] : value; }

async function loadLookups() {
  const [products, farms] = await Promise.all([
    query(`SELECT ProdKey,ProdCode,ProdName,DisplayName,FlowerName,CounName,OutUnit,SteamOf1Box,BoxWeight,BoxCBM FROM Product WHERE isDeleted=0`),
    query(`SELECT FarmKey,FarmName,CounKey FROM Farm WHERE isDeleted=0`),
  ]);
  return { products: products.recordset, farms: farms.recordset };
}

export default withAuth(async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }
  const form = formidable({ maxFileSize: MAX_FILE_SIZE, keepExtensions: true, multiples: false });
  let fields;
  let files;
  try {
    [fields, files] = await new Promise((resolve, reject) => {
      form.parse(req, (error, parsedFields, parsedFiles) => error ? reject(error) : resolve([parsedFields, parsedFiles]));
    });
  } catch (error) {
    return res.status(400).json({ success: false, error: `업로드 실패: ${error.message}` });
  }
  const file = first(files.file);
  if (!file) return res.status(400).json({ success: false, error: 'file 필드가 필요합니다.' });
  const fileName = String(file.originalFilename || 'arrival-cost.xlsx');
  if (!/\.(xlsx|xls)$/i.test(fileName)) {
    try { fs.unlinkSync(file.filepath); } catch {}
    return res.status(400).json({ success: false, error: 'xlsx/xls 파일만 업로드할 수 있습니다.' });
  }
  try {
    const { products, farms } = await loadLookups();
    const parsed = parseArrivalCostWorkbook(fs.readFileSync(file.filepath), {
      fileName,
      orderYear: first(fields.orderYear),
      orderWeek: first(fields.orderWeek),
      products,
      farms,
      mappings: loadMappings(),
    });
    if (!parsed.rows.length) return res.status(400).json({ success: false, error: '도착원가 표가 있는 시트를 찾지 못했습니다.' });
    const saved = await createArrivalCostImport({
      parsed,
      fileName,
      user: req.user,
      orderYear: first(fields.orderYear),
    });
    return res.status(200).json({
      success: true,
      message: `도착원가 ${saved.rowCount}건을 새 revision으로 저장했습니다.`,
      ...saved,
      sheetStats: parsed.sheetStats,
      matchedCount: parsed.matchedCount,
      unmatchedCount: parsed.unmatchedCount,
    });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  } finally {
    try { fs.unlinkSync(file.filepath); } catch {}
  }
});
