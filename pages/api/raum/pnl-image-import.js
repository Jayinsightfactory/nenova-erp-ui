// 라움 손익계산서 이미지 업로드 → Vision OCR → ERP 품목 추천/매칭 초안
// 이 API는 이미지 원본과 웹 초안만 만들고 OrderMaster/OrderDetail을 쓰지 않는다.
import fs from 'fs';
import crypto from 'crypto';
import formidable from 'formidable';
import Anthropic from '@anthropic-ai/sdk';
import { withAuth } from '../../../lib/auth';
import { query, sql } from '../../../lib/db';
import { trackLLMCall } from '../../../lib/chat/costTracker';
import { matchImportRows } from '../../../lib/orderImportMatch';
import { loadMappings } from '../../../lib/parseMappings';
import { loadImportUnits } from '../../../lib/orderImportUnits';
import { normalizeRaumVisionItems } from '../../../lib/raumPnlImage';

export const config = { api: { bodyParser: false } };

let client = null;
function getClient() {
  if (client) return client;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  client = new Anthropic({ apiKey: key });
  return client;
}

const IMAGE_PROMPT = `이 이미지는 꽃 거래명세표/발주·사입 목록이다. 표의 데이터 행을 빠짐없이 추출해 JSON만 반환하라.
형식:
{"items":[{"inputName":"수국 화이트","qty":57,"unit":"박스","unitPrice":12000,"remark":""}]}
규칙:
- 헤더·합계·빈 행은 제외하고 데이터 행은 같은 품목이 반복되어도 각각 반환한다.
- 품목명은 이미지에 적힌 품명을 최대한 보존한다. 카테고리와 색상이 따로 있으면 합쳐 inputName으로 만든다.
- qty는 해당 행의 수량이다. 괄호 안 보조수량이 있으면 주문/거래 수량을 우선한다.
- unitPrice는 1개당 단가/매입단가가 이미지에 명시된 경우만 숫자로 추출한다. 금액 합계만 있고 단가가 없으면 null이다.
- unitPrice는 원화이며 부가세 별도 기준이다. 통화가 불명확하면 null이다.
- 적요/비고가 있으면 remark에 넣는다.
- 숫자·단가를 추측하지 말고, JSON 외 설명은 출력하지 않는다.`;

function fileIsImage(file) {
  const mime = file?.mimetype || '';
  const name = String(file?.originalFilename || '').toLowerCase();
  return mime.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(name);
}

async function ensureImageTable() {
  await query(`
    IF NOT EXISTS (SELECT 1 FROM sysobjects WHERE name='_agent_images' AND xtype='U')
    CREATE TABLE _agent_images (
      id NVARCHAR(40) PRIMARY KEY,
      filename NVARCHAR(300),
      mime NVARCHAR(100),
      size_bytes INT,
      data VARBINARY(MAX),
      room_name NVARCHAR(200),
      pipeline_run_id NVARCHAR(100),
      created_at DATETIME DEFAULT GETDATE()
    )`, {});
}

async function saveImage(file, req) {
  const buffer = fs.readFileSync(file.filepath);
  const id = crypto.randomBytes(12).toString('hex');
  const filename = file.originalFilename || 'raum-order-image';
  const mime = file.mimetype || 'image/jpeg';
  await ensureImageTable();
  await query(
    `INSERT INTO _agent_images (id, filename, mime, size_bytes, data, room_name, pipeline_run_id)
     VALUES (@id, @filename, @mime, @size, @data, @room, @run)`,
    {
      id: { type: sql.NVarChar(40), value: id },
      filename: { type: sql.NVarChar(300), value: filename },
      mime: { type: sql.NVarChar(100), value: mime },
      size: { type: sql.Int, value: buffer.length },
      data: { type: sql.VarBinary(sql.MAX), value: buffer },
      room: { type: sql.NVarChar(200), value: 'raum-pnl' },
      run: { type: sql.NVarChar(100), value: '' },
    }
  );
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const url = `${protocol}://${req.headers.host}/api/public/image/${id}`;
  return { id, url, filename, mime, size: buffer.length, buffer };
}

async function parseImage(file) {
  const ai = getClient();
  if (!ai) throw new Error('이미지 OCR에는 ANTHROPIC_API_KEY 설정이 필요합니다.');
  const buffer = fs.readFileSync(file.filepath);
  const mime = String(file.mimetype || 'image/jpeg').startsWith('image/') ? file.mimetype : 'image/jpeg';
  const response = await ai.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 4096,
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: mime, data: buffer.toString('base64') } },
      { type: 'text', text: IMAGE_PROMPT },
    ] }],
  });
  trackLLMCall({
    model: 'claude-haiku-4-5',
    inputTokens: response?.usage?.input_tokens || 0,
    outputTokens: response?.usage?.output_tokens || 0,
    purpose: 'raum-pnl-image-vision',
  });
  const raw = (response.content || []).filter(x => x.type === 'text').map(x => x.text).join('').trim();
  const json = (raw.match(/\{[\s\S]*\}/) || [null])[0];
  if (!json) throw new Error('이미지 OCR JSON 파싱 실패');
  const parsed = JSON.parse(json);
  return parsed.items || parsed.rows || [];
}

async function loadMatchContext() {
  const [products, units] = await Promise.all([
    query(`SELECT ProdKey, ProdName, ISNULL(DisplayName, ProdName) AS DisplayName,
                  FlowerName, CounName, OutUnit
             FROM Product WHERE isDeleted=0 ORDER BY ProdName`, {}),
    query(`SELECT ProdKey, SUM(ISNULL(BoxQuantity,0)) AS TotalBox,
                  SUM(ISNULL(BunchQuantity,0)) AS TotalBunch,
                  SUM(ISNULL(SteamQuantity,0)) AS TotalSteam
             FROM OrderDetail WHERE isDeleted=0 AND ProdKey IS NOT NULL GROUP BY ProdKey`, {}),
  ]);
  const allProducts = products.recordset || [];
  const productByKey = new Map(allProducts.map(p => [Number(p.ProdKey), p]));
  const prodUnitMap = {};
  for (const row of units.recordset || []) {
    const values = [Number(row.TotalBox || 0), Number(row.TotalBunch || 0), Number(row.TotalSteam || 0)];
    const max = Math.max(...values);
    if (!max) continue;
    prodUnitMap[row.ProdKey] = values[1] === max ? '단' : values[2] === max ? '송이' : '박스';
  }
  return { allProducts, productByKey, prodUnitMap, savedMappings: loadMappings(true), unitCatalog: loadImportUnits(true) };
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
  const form = formidable({ maxFileSize: 30 * 1024 * 1024, keepExtensions: true, multiples: false });
  let files;
  try {
    [, files] = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, parsedFiles) => err ? reject(err) : resolve([fields, parsedFiles]));
    });
  } catch (e) {
    return res.status(400).json({ success: false, error: `업로드 파싱 실패: ${e.message}` });
  }
  const file = Array.isArray(files.file) ? files.file[0] : files.file;
  if (!file) return res.status(400).json({ success: false, error: 'file 필드 필요' });
  if (!fileIsImage(file)) return res.status(400).json({ success: false, error: '지원 이미지: png, jpg, jpeg, webp, gif, bmp' });

  try {
    const saved = await saveImage(file, req);
    const rawItems = await parseImage(file);
    const parsedRows = normalizeRaumVisionItems(rawItems, { imageId: saved.id, imageName: saved.filename });
    if (!parsedRows.length) return res.status(400).json({ success: false, error: '이미지에서 품목·수량을 찾지 못했습니다.' });

    const ctx = await loadMatchContext();
    const matched = matchImportRows(parsedRows.map(row => ({
      rowNo: row.sourceRowNo,
      inputName: row.inputName,
      qty: row.qty,
      unit: row.unit,
    })), ctx);
    const items = matched.map((row, index) => ({
      ...parsedRows[index],
      prodKey: row.prodKey || null,
      prodName: row.prodName || null,
      displayName: row.displayName || null,
      unit: row.unit || parsedRows[index].unit || '',
      suggestedProducts: row.suggestedProducts || [],
      confidence: row.confidence || 0,
      confidenceLabel: row.confidenceLabel || 'none',
      ambiguousCountry: Boolean(row.ambiguousCountry),
      needsReview: !row.prodKey || Boolean(row.ambiguousCountry || row.fallbackSuspect || row.confidenceLabel === 'low'),
    }));
    return res.status(200).json({
      success: true,
      sourceImage: { id: saved.id, url: saved.url, fileName: saved.filename, mime: saved.mime, size: saved.size },
      items,
      summary: {
        total: items.length,
        matched: items.filter(x => x.prodKey && !x.needsReview).length,
        review: items.filter(x => x.prodKey && x.needsReview).length,
        unmatched: items.filter(x => !x.prodKey).length,
      },
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  } finally {
    try { fs.unlinkSync(file.filepath); } catch { /* temp cleanup */ }
  }
}

export default withAuth(handler);
