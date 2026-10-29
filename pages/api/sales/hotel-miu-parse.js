// 호텔+미우 주문입력 — 이미지/텍스트 파싱 + 품목 매칭.
// 공통 order-mappings 는 읽기만 하고, 게시판 overlay 가 덮는다. 공통 매핑 파일에 저장하지 않음.
import fs from 'fs';
import XLSX from 'xlsx';
import formidable from 'formidable';
import Anthropic from '@anthropic-ai/sdk';
import { withAuth } from '../../../lib/auth';
import { query } from '../../../lib/db';
import { trackLLMCall } from '../../../lib/chat/costTracker';
import { normalizeVisionItems, parseOrderImportSheetRows } from '../../../lib/orderImportParse';
import { uniqueHotelMappings } from '../../../lib/hotelOrderWorkspace';
import { hotelSourceBox } from '../../../lib/hotelOrderReview';
import { matchImportRows, summarizeMatches } from '../../../lib/orderImportMatch';
import { loadMappings, normalizeToken } from '../../../lib/parseMappings';
import { loadImportUnits } from '../../../lib/orderImportUnits';
import {
  HOTEL_MIU_VISION_PROMPT,
  applyBoardOverlay,
  decorateIntakeRows,
  mergeBoardMappings,
  parseHotelMiuText,
  rankJamoCandidates,
} from '../../../lib/hotelMiuIntake';

export const config = { api: { bodyParser: false } };

let _client = null;
function getClient() {
  if (_client) return _client;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  _client = new Anthropic({ apiKey: key });
  return _client;
}

async function loadBoardOverlay() {
  const exists = await query(
    `SELECT 1 AS ok FROM sys.tables WHERE name=N'WebHotelMiuProductMap'`,
    {}
  );
  if (!exists.recordset.length) return {};
  const r = await query(
    `SELECT InputToken, ProdKey, ProdName, DisplayName, FlowerName, CounName, Unit
       FROM WebHotelMiuProductMap WHERE ISNULL(isDeleted,0)=0`,
    {}
  );
  const map = {};
  for (const row of r.recordset) {
    map[String(row.InputToken)] = {
      prodKey: Number(row.ProdKey),
      prodName: row.ProdName || '',
      displayName: row.DisplayName || row.ProdName || '',
      flowerName: row.FlowerName || '',
      counName: row.CounName || '',
      unit: row.Unit || '',
      auto: false,
      source: 'hotel-miu-board',
    };
  }
  return map;
}

async function loadMatchContext() {
  const [prodRes, overlay] = await Promise.all([
    query(`SELECT ProdKey, ProdName, ISNULL(DisplayName, ProdName) AS DisplayName,
           FlowerName, CounName, OutUnit, BunchOf1Box, SteamOf1Box, SteamOf1Bunch
           FROM Product WHERE isDeleted = 0 ORDER BY ProdName`, {}),
    loadBoardOverlay(),
  ]);
  const allProducts = prodRes.recordset || [];
  const hotelMaps = await query(`SELECT i.ItemName,i.ProdKey
    FROM WebRaumPnl m JOIN WebRaumPnlItem i ON i.PnlKey=m.PnlKey
    JOIN Product p ON p.ProdKey=i.ProdKey AND p.isDeleted=0
    WHERE ISNULL(m.isDeleted,0)=0 AND ISNULL(i.IsCustom,0)=0
      AND (m.PartnerCode IN ('raum','shilla','choimun') OR m.PartnerCode IN (
        SELECT PartnerCode FROM WebPnlHotel WHERE IsActive=1 AND
          ([Name] LIKE N'%미우%' OR [Name] LIKE N'%아이엠%' OR [Name] LIKE N'%은화%')))
    UNION ALL SELECT m.ItemName,m.ProdKey FROM WebRaumItemMap m
      JOIN Product p ON p.ProdKey=m.ProdKey AND p.isDeleted=0`, {});
  return {
    hotelMappings: uniqueHotelMappings(hotelMaps.recordset || []),
    allProducts,
    productByKey: new Map(allProducts.map((p) => [Number(p.ProdKey), p])),
    overlay,
    savedMappings: mergeBoardMappings(await loadMappings(true), overlay),
    unitCatalog: loadImportUnits(true),
  };
}

async function parseImageWithVision(file) {
  const client = getClient();
  if (!client) throw new Error('이미지 OCR에는 ANTHROPIC_API_KEY 설정이 필요합니다.');
  const buf = fs.readFileSync(file.filepath);
  const mime = file.mimetype || 'image/jpeg';
  const mediaType = mime.startsWith('image/') ? mime : 'image/jpeg';
  const resp = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: buf.toString('base64') } },
        { type: 'text', text: HOTEL_MIU_VISION_PROMPT },
      ],
    }],
  });
  trackLLMCall({
    model: 'claude-haiku-4-5',
    inputTokens: resp?.usage?.input_tokens || 0,
    outputTokens: resp?.usage?.output_tokens || 0,
    purpose: 'hotel-miu-intake-vision',
  });
  const raw = (resp.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  const jsonText = (raw.match(/\{[\s\S]*\}/) || [null])[0];
  if (!jsonText) throw new Error('이미지 OCR JSON 파싱 실패');
  const parsed = JSON.parse(jsonText);
  const items=parsed.items || parsed.rows || [], result=normalizeVisionItems(items);
  return {...result,rows:result.rows.map(row=>({...row,sourceBox:hotelSourceBox(items[row.rowNo-1]?.sourceBox)}))};
}

function fieldVal(fields, name) {
  const v = fields?.[name];
  return Array.isArray(v) ? v[0] : v;
}

export default withAuth(async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
  try {
    const contentType = String(req.headers['content-type'] || '');
    let parsedRows = [];
    let logs = [];
    let sourceType = 'text';

    if (contentType.includes('multipart/form-data')) {
      const form = formidable({ maxFileSize: 20 * 1024 * 1024, keepExtensions: true, multiples: false });
      const [fields, files] = await new Promise((resolve, reject) => {
        form.parse(req, (err, flds, fls) => (err ? reject(err) : resolve([flds, fls])));
      });
      const file = Array.isArray(files.file) ? files.file[0] : files.file;
      const text = fieldVal(fields, 'text');
      if (file) {
        try {
          const name = String(file.originalFilename || '').toLowerCase();
          if (/\.(xlsx|xls|csv)$/.test(name)) {
            sourceType = 'excel';
            const book = XLSX.readFile(file.filepath);
            const sheet = fieldVal(fields, 'sheet');
            if (!sheet && book.SheetNames.length > 1) return res.status(200).json({ success: true, sheetNames: book.SheetNames, items: [] });
            const selected = sheet || book.SheetNames[0];
            if (!book.Sheets[selected]) throw Error('엑셀 시트를 선택하세요.');
            const parsed = parseOrderImportSheetRows(XLSX.utils.sheet_to_json(book.Sheets[selected], { header: 1, defval: '' }), { sourceName: selected });
            parsedRows = parsed.rows; logs = parsed.logs;
          } else if (/\.(txt|tsv)$/.test(name)) {
            sourceType = 'text';
            const buf = fs.readFileSync(file.filepath);
            let raw = new TextDecoder(buf[0] === 0xff && buf[1] === 0xfe ? 'utf-16le' : buf[0] === 0xfe && buf[1] === 0xff ? 'utf-16be' : 'utf-8').decode(buf);
            if (raw.includes('\ufffd')) raw = new TextDecoder('euc-kr').decode(buf);
            const parsed = parseHotelMiuText(raw); parsedRows = parsed.rows; logs = parsed.logs;
          } else if (/^image\/(png|jpeg|webp|gif)$/.test(file.mimetype || '')) {
            sourceType = 'image';
            const vision = await parseImageWithVision(file); parsedRows = vision.rows; logs = vision.logs;
          } else throw Error('TXT, TSV, CSV, XLS, XLSX 또는 PNG/JPG/WEBP/GIF를 올리세요.');
        } finally { fs.rmSync(file.filepath, { force: true }); }
      } else if (text) {
        const parsed = parseHotelMiuText(String(text));
        parsedRows = parsed.rows;
        logs = parsed.logs;
      } else {
        return res.status(400).json({ success: false, error: 'file 또는 text 필요' });
      }
    } else {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      if (!body.text) return res.status(400).json({ success: false, error: 'text 필요' });
      const parsed = parseHotelMiuText(String(body.text));
      parsedRows = parsed.rows;
      logs = parsed.logs;
    }

    const ctx = await loadMatchContext();
    const mappedRows = decorateIntakeRows(parsedRows, { forImage: sourceType === 'image' }).map(row => {
      const keys = ctx.hotelMappings.groups.get(ctx.hotelMappings.token(row.inputName || row.matchName));
      return keys?.size === 1 ? { ...row, preferredProdKey: [...keys][0] } : row;
    });
    const items = applyBoardOverlay(
      matchImportRows(
        mappedRows,
        { ...ctx, mappingRelevanceMode: sourceType === 'image' ? 'image' : 'standard' },
      ).map(it => {
        const keys = ctx.hotelMappings.groups.get(ctx.hotelMappings.token(it.inputName || it.matchName));
        const p = keys?.size === 1 ? ctx.productByKey.get([...keys][0]) : null;
        return p ? { ...it, prodKey: p.ProdKey, prodName: p.ProdName, displayName: p.DisplayName, outUnit: p.OutUnit, fromMapping: true } : it;
      }),
      ctx.overlay,
      ctx.productByKey,
    ).map((it) => {
      const keys = ctx.hotelMappings.groups.get(ctx.hotelMappings.token(it.inputName || it.matchName));
      const explicit = ctx.overlay[normalizeToken(it.inputName)];
      if (keys?.size > 1 && !ctx.productByKey.has(Number(explicit?.prodKey))) return { ...it, prodKey: null, prodName: '', displayName: '', matchWarning: '호텔 저장 매칭이 충돌합니다. 품목을 직접 선택하세요.' };
      if (it.prodKey) return it;
      const jamo = rankJamoCandidates(it.inputName || it.matchName, ctx.allProducts, 8);
      const seen = new Set((it.suggestedProducts || []).map((p) => Number(p.ProdKey || p.prodKey)));
      const extra = jamo.filter((p) => !seen.has(Number(p.ProdKey || p.prodKey)));
      return { ...it, suggestedProducts: [...(it.suggestedProducts || []), ...extra].slice(0, 8) };
    });
    return res.status(200).json({
      success: true,
      sourceType,
      items:items.map(it=>({...it,sourceBox:hotelSourceBox(parsedRows.find(r=>r.rowNo===it.rowNo)?.sourceBox)})),
      products: ctx.allProducts.filter(p => items.some(it => Number(it.prodKey) === Number(p.ProdKey))),
      summary: summarizeMatches(items),
      logs,
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});
