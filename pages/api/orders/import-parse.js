// pages/api/orders/import-parse.js
// 이미지/엑셀 발주 업로드 → 파싱 + 품목 자동매칭

import fs from 'fs';
import formidable from 'formidable';
import XLSX from 'xlsx';
import Anthropic from '@anthropic-ai/sdk';
import { withAuth } from '../../../lib/auth';
import { query } from '../../../lib/db';
import { trackLLMCall } from '../../../lib/chat/costTracker';
import {
  parseOrderImportWorkbook,
  normalizeVisionItems,
  VISION_PARSE_PROMPT,
} from '../../../lib/orderImportParse';
import { matchImportRows, summarizeMatches } from '../../../lib/orderImportMatch';
import { loadMappings } from '../../../lib/parseMappings';
import { loadImportUnits, learnUnitsFromRows } from '../../../lib/orderImportUnits';

export const config = {
  api: { bodyParser: false },
};

let _client = null;
function getClient() {
  if (_client) return _client;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  _client = new Anthropic({ apiKey: key });
  return _client;
}

function fieldVal(fields, name) {
  const v = fields?.[name];
  return Array.isArray(v) ? v[0] : v;
}

function isImageFile(file) {
  const mime = file?.mimetype || '';
  const name = (file?.originalFilename || '').toLowerCase();
  return mime.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(name);
}

function isExcelFile(file) {
  const mime = file?.mimetype || '';
  const name = (file?.originalFilename || '').toLowerCase();
  return (
    mime.includes('spreadsheet') ||
    mime.includes('excel') ||
    /\.(xlsx|xls|csv)$/i.test(name)
  );
}

async function parseImageWithVision(file) {
  const client = getClient();
  if (!client) {
    throw new Error('이미지 OCR에는 ANTHROPIC_API_KEY 설정이 필요합니다.');
  }
  const buf = fs.readFileSync(file.filepath);
  const mime = file.mimetype || 'image/jpeg';
  const mediaType = mime.startsWith('image/') ? mime : 'image/jpeg';

  const resp = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: mediaType, data: buf.toString('base64') },
        },
        { type: 'text', text: VISION_PARSE_PROMPT },
      ],
    }],
  });

  trackLLMCall({
    model: 'claude-haiku-4-5',
    inputTokens: resp?.usage?.input_tokens || 0,
    outputTokens: resp?.usage?.output_tokens || 0,
    purpose: 'order-import-vision',
  });

  const raw = (resp.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
  const jsonText = (raw.match(/\{[\s\S]*\}/) || [null])[0];
  if (!jsonText) throw new Error('이미지 OCR JSON 파싱 실패');
  const parsed = JSON.parse(jsonText);
  return normalizeVisionItems(parsed.items || parsed.rows || []);
}

async function loadMatchContext() {
  const [prodRes, unitRes] = await Promise.all([
    query(`SELECT ProdKey, ProdName, ISNULL(DisplayName, ProdName) AS DisplayName,
           FlowerName, CounName, OutUnit
           FROM Product WHERE isDeleted = 0 ORDER BY ProdName`),
    query(`SELECT ProdKey,
             SUM(ISNULL(BoxQuantity,0))   AS TotalBox,
             SUM(ISNULL(BunchQuantity,0)) AS TotalBunch,
             SUM(ISNULL(SteamQuantity,0)) AS TotalSteam
           FROM OrderDetail WHERE isDeleted = 0 AND ProdKey IS NOT NULL GROUP BY ProdKey`),
  ]);

  const allProducts = prodRes.recordset || [];
  const productByKey = new Map(allProducts.map(p => [Number(p.ProdKey), p]));
  const prodUnitMap = {};
  (unitRes.recordset || []).forEach(row => {
    const b = row.TotalBox;
    const d = row.TotalBunch;
    const s = row.TotalSteam;
    if (b === 0 && d === 0 && s === 0) return;
    if (d >= b && d >= s) prodUnitMap[row.ProdKey] = '단';
    else if (s >= b && s >= d) prodUnitMap[row.ProdKey] = '송이';
    else prodUnitMap[row.ProdKey] = '박스';
  });

  return { allProducts, productByKey, prodUnitMap, savedMappings: loadMappings(true) };
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const form = formidable({
    maxFileSize: 30 * 1024 * 1024,
    keepExtensions: true,
    multiples: false,
  });

  let fields;
  let files;
  try {
    [fields, files] = await new Promise((resolve, reject) => {
      form.parse(req, (err, flds, fls) => (err ? reject(err) : resolve([flds, fls])));
    });
  } catch (e) {
    return res.status(400).json({ success: false, error: `업로드 파싱 실패: ${e.message}` });
  }

  const file = Array.isArray(files.file) ? files.file[0] : files.file;
  if (!file) return res.status(400).json({ success: false, error: 'file 필드 필요' });

  const rawOverrides = fieldVal(fields, 'productOverrides');
  let productOverrides = {};
  if (rawOverrides) {
    try { productOverrides = JSON.parse(rawOverrides) || {}; } catch {}
  }

  const logs = [];
  let parsedRows = [];
  let sourceType = 'excel';

  try {
    if (isImageFile(file)) {
      sourceType = 'image';
      const vision = await parseImageWithVision(file);
      parsedRows = vision.rows;
      logs.push(...vision.logs);
    } else if (isExcelFile(file)) {
      const workbook = XLSX.readFile(file.filepath, { cellDates: false, cellNF: false, cellStyles: false });
      const parsed = parseOrderImportWorkbook(XLSX, workbook, {
        sourceName: file.originalFilename || 'upload.xlsx',
      });
      parsedRows = parsed.rows;
      logs.push(...parsed.logs);
    } else {
      return res.status(400).json({ success: false, error: '지원 형식: xlsx, xls, csv, png, jpg, webp' });
    }

    if (parsedRows.length === 0) {
      return res.status(400).json({ success: false, error: '파싱된 품목이 없습니다.', logs });
    }

    if (sourceType === 'excel') {
      const learned = learnUnitsFromRows(parsedRows, { source: 'excel' });
      if (learned.length > 0) {
        logs.push(`단위 학습 ${learned.length}건 (품목명→단위, 이미지 업로드에 재사용)`);
      }
    }

    const ctx = await loadMatchContext();
    ctx.unitCatalog = loadImportUnits(true);
    let items = matchImportRows(parsedRows, ctx);

    if (Object.keys(productOverrides).length > 0) {
      items = items.map(it => {
        const overrideKey = productOverrides[it.inputName];
        if (!overrideKey) return it;
        const prod = ctx.productByKey.get(Number(overrideKey));
        if (!prod) return it;
        return {
          ...it,
          prodKey: prod.ProdKey,
          prodName: prod.ProdName,
          displayName: prod.DisplayName,
          flowerName: prod.FlowerName,
          counName: prod.CounName,
          fromMapping: false,
          mappingMatchType: 'manual',
          confidence: 1,
          confidenceLabel: 'high',
        };
      });
    }

    const summary = summarizeMatches(items);

    return res.status(200).json({
      success: true,
      fileName: file.originalFilename || 'upload',
      sourceType,
      sheetName: sourceType === 'excel' ? (parsedRows.sheetName || null) : null,
      items,
      summary,
      logs,
      productCount: ctx.allProducts.length,
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message, logs });
  } finally {
    try { fs.unlinkSync(file.filepath); } catch {}
  }
}

export default withAuth(handler);
