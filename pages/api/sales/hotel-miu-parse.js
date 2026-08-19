// 호텔+미우 주문입력 — 이미지/텍스트 파싱 + 품목 매칭.
// 공통 order-mappings 는 읽기만 하고, 게시판 overlay 가 덮는다. 공통 매핑 파일에 저장하지 않음.
import fs from 'fs';
import formidable from 'formidable';
import Anthropic from '@anthropic-ai/sdk';
import { withAuth } from '../../../lib/auth';
import { query } from '../../../lib/db';
import { trackLLMCall } from '../../../lib/chat/costTracker';
import { normalizeVisionItems } from '../../../lib/orderImportParse';
import { matchImportRows, summarizeMatches } from '../../../lib/orderImportMatch';
import { loadMappings } from '../../../lib/parseMappings';
import { loadImportUnits } from '../../../lib/orderImportUnits';
import {
  HOTEL_MIU_VISION_PROMPT,
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
           FlowerName, CounName, OutUnit
           FROM Product WHERE isDeleted = 0 ORDER BY ProdName`, {}),
    loadBoardOverlay(),
  ]);
  const allProducts = prodRes.recordset || [];
  return {
    allProducts,
    productByKey: new Map(allProducts.map((p) => [Number(p.ProdKey), p])),
    savedMappings: mergeBoardMappings(loadMappings(true), overlay),
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
  return normalizeVisionItems(parsed.items || parsed.rows || []);
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
        sourceType = 'image';
        const vision = await parseImageWithVision(file);
        parsedRows = vision.rows;
        logs = vision.logs;
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
    const items = matchImportRows(decorateIntakeRows(parsedRows), ctx).map((it) => {
      if (it.prodKey) return it;
      const jamo = rankJamoCandidates(it.inputName || it.matchName, ctx.allProducts, 8);
      const seen = new Set((it.suggestedProducts || []).map((p) => Number(p.ProdKey || p.prodKey)));
      const extra = jamo.filter((p) => !seen.has(Number(p.ProdKey || p.prodKey)));
      return { ...it, suggestedProducts: [...(it.suggestedProducts || []), ...extra].slice(0, 8) };
    });
    return res.status(200).json({
      success: true,
      sourceType,
      items,
      summary: summarizeMatches(items),
      logs,
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});
