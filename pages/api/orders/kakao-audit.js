import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { customerMatchesSearch } from '../../../lib/customerSearch';
import { filterProducts, getDisplayName, scoreMatch } from '../../../lib/displayName';

const ACTION_RE = /(추가|취소|춰소|쥐소|츼소|추기)/;
const QTY_RE = /(-?\d+(?:\.\d+)?)\s*(박스|박|box|BOX|단|bunch|BUNCH|송이|stem|STEM)?/;
const WEEK_RE = /(?:^|\s)(\d{1,2})\s*(?:-|차\s*)\s*(\d{1,2})?/;
const NOISE_LINE_RE = /(오늘|출고|부탁|확인|물량|체크|사진|파일|최종|요청|예정|적재|입구|앞으로)/;

function normalizeWeek(raw = '') {
  const m = String(raw).match(WEEK_RE);
  if (!m) return null;
  const week = String(m[1]).padStart(2, '0');
  const seq = String(m[2] || '1').padStart(2, '0');
  return `${week}-${seq}`;
}

function normalizeAction(text = '') {
  if (/취소|춰소|쥐소|츼소/.test(text)) return '취소';
  return '추가';
}

function normalizeUnit(text = '') {
  const raw = String(text || '').toLowerCase();
  if (/단|bunch/.test(raw)) return '단';
  if (/송이|stem/.test(raw)) return '송이';
  return '박스';
}

function parseHeader(line) {
  const m = line.match(/^\[(.+?)\]\s+\[(오전|오후)\s+(\d{1,2}):(\d{2})\]\s*(.*)$/);
  if (!m) return null;
  let hour = Number(m[3]);
  if (m[2] === '오후' && hour < 12) hour += 12;
  if (m[2] === '오전' && hour === 12) hour = 0;
  return {
    sender: m[1],
    time: `${String(hour).padStart(2, '0')}:${m[4]}`,
    title: m[5] || '',
  };
}

function parseDateSeparator(line) {
  const m = line.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
  if (!m) return null;
  return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
}

function detectFlower(title = '') {
  const t = String(title);
  const names = ['장미', '카네이션', '수국', '루스커스', '알스트로', '코알라', '코 장미', '중국', '콜롬비아'];
  return names.find(n => t.includes(n)) || '';
}

function cleanProductName(line, flower) {
  let s = String(line)
    .replace(/^[^-\n:：]{1,20}\s*[-:：]\s*/, '')
    .replace(ACTION_RE, '')
    .replace(QTY_RE, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (flower && !s.includes(flower) && !/장미|카네이션|수국|루스커스|알스트로/.test(s)) {
    s = `${flower} ${s}`.trim();
  }
  return s;
}

function splitInlineCustomer(line) {
  const m = String(line).match(/^(.{1,20}?)\s*[-:：]\s*(.+)$/);
  if (!m) return null;
  if (!ACTION_RE.test(m[2])) return null;
  return { customer: m[1].trim(), rest: m[2].trim() };
}

function parseKakaoRequests(text = '') {
  const lines = String(text).replace(/\r/g, '').split('\n');
  const requests = [];
  let currentDate = null;
  let currentHeader = null;
  let currentWeek = null;
  let currentFlower = '';
  let currentCustomer = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const date = parseDateSeparator(line);
    if (date) {
      currentDate = date;
      continue;
    }

    const header = parseHeader(line);
    if (header) {
      currentHeader = header;
      currentWeek = normalizeWeek(header.title) || currentWeek;
      currentFlower = detectFlower(header.title) || currentFlower;
      currentCustomer = null;
      continue;
    }

    const lineWeek = normalizeWeek(line);
    if (lineWeek) currentWeek = lineWeek;
    const lineFlower = detectFlower(line);
    if (lineFlower) currentFlower = lineFlower;

    if (!ACTION_RE.test(line)) {
      if (!NOISE_LINE_RE.test(line) && !QTY_RE.test(line) && line.length <= 20) {
        currentCustomer = line.replace(/\s+/g, ' ').trim();
      }
      continue;
    }

    if (NOISE_LINE_RE.test(line) && !QTY_RE.test(line)) continue;

    const inline = splitInlineCustomer(line);
    const customerText = inline?.customer || currentCustomer;
    const itemText = inline?.rest || line;
    const qtyMatch = itemText.match(QTY_RE);
    const qty = qtyMatch ? Math.abs(Number(qtyMatch[1])) : 1;
    const unit = normalizeUnit(qtyMatch?.[2] || itemText);
    const productText = cleanProductName(itemText, currentFlower);

    if (!customerText || !productText) continue;

    requests.push({
      sourceDate: currentDate,
      sourceTime: currentHeader?.time || null,
      sender: currentHeader?.sender || '',
      title: currentHeader?.title || '',
      week: currentWeek,
      flower: currentFlower,
      inputCustomer: customerText,
      inputProduct: productText,
      qty,
      unit,
      action: normalizeAction(itemText),
      sourceLine: line,
    });
  }
  return requests;
}

function matchCustomer(customers, inputCustomer) {
  const matches = customers.filter(c => customerMatchesSearch(c, inputCustomer));
  matches.sort((a, b) => String(a.CustName).length - String(b.CustName).length);
  return matches[0] || null;
}

function matchProduct(products, inputProduct) {
  const candidates = filterProducts(products, inputProduct, 0.55)
    .map(p => ({ ...p, _score: scoreMatch(inputProduct, p, inputProduct) }))
    .sort((a, b) => b._score - a._score)
    .slice(0, 5);
  return { match: candidates[0] || null, candidates };
}

async function getDbState(reqs) {
  const pairs = reqs
    .filter(r => r.week && r.custMatch?.CustKey && r.prodMatch?.ProdKey)
    .map(r => `${r.week}|${r.custMatch.CustKey}|${r.prodMatch.ProdKey}`);
  const unique = [...new Set(pairs)];
  if (unique.length === 0) return new Map();

  const values = unique.map((key, i) => {
    const [week, custKey, prodKey] = key.split('|');
    return { key, i, week, custKey: Number(custKey), prodKey: Number(prodKey) };
  });
  const rowsSql = values.map(v => `SELECT @w${v.i} AS week, @c${v.i} AS custKey, @p${v.i} AS prodKey`).join(' UNION ALL ');
  const params = {};
  for (const v of values) {
    params[`w${v.i}`] = { type: sql.NVarChar, value: v.week };
    params[`c${v.i}`] = { type: sql.Int, value: v.custKey };
    params[`p${v.i}`] = { type: sql.Int, value: v.prodKey };
  }

  const result = await query(
    `WITH targets AS (${rowsSql})
     SELECT
       t.week, t.custKey, t.prodKey,
       ISNULL(o.orderQty, 0) AS orderQty,
       ISNULL(s.shipQty, 0) AS shipQty,
       ISNULL(oh.orderHistoryCnt, 0) AS orderHistoryCnt,
       ISNULL(sh.shipHistoryCnt, 0) AS shipHistoryCnt,
       oh.lastOrderChangeDtm,
       sh.lastShipChangeDtm
     FROM targets t
     OUTER APPLY (
       SELECT SUM(ISNULL(od.OutQuantity,0)) AS orderQty
       FROM OrderMaster om
       JOIN OrderDetail od ON od.OrderMasterKey = om.OrderMasterKey AND ISNULL(od.isDeleted,0)=0
       WHERE ISNULL(om.isDeleted,0)=0 AND om.OrderWeek=t.week AND om.CustKey=t.custKey AND od.ProdKey=t.prodKey
     ) o
     OUTER APPLY (
       SELECT SUM(ISNULL(sd.OutQuantity,0)) AS shipQty
       FROM ShipmentMaster sm
       JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
       WHERE ISNULL(sm.isDeleted,0)=0 AND sm.OrderWeek=t.week AND sm.CustKey=t.custKey AND sd.ProdKey=t.prodKey
     ) s
     OUTER APPLY (
       SELECT COUNT(*) AS orderHistoryCnt, CONVERT(NVARCHAR(19), MAX(oh.ChangeDtm), 120) AS lastOrderChangeDtm
       FROM OrderHistory oh
       JOIN OrderDetail od ON oh.OrderDetailKey = od.OrderDetailKey
       JOIN OrderMaster om ON od.OrderMasterKey = om.OrderMasterKey
       WHERE om.OrderWeek=t.week AND om.CustKey=t.custKey AND od.ProdKey=t.prodKey
     ) oh
     OUTER APPLY (
       SELECT COUNT(*) AS shipHistoryCnt, CONVERT(NVARCHAR(19), MAX(sh.ChangeDtm), 120) AS lastShipChangeDtm
       FROM ShipmentHistory sh
       JOIN ShipmentDetail sd ON sh.SdetailKey = sd.SdetailKey
       JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
       WHERE sm.OrderWeek=t.week AND sm.CustKey=t.custKey AND sd.ProdKey=t.prodKey
     ) sh`,
    params
  );

  return new Map(result.recordset.map(r => [`${r.week}|${r.custKey}|${r.prodKey}`, r]));
}

export default withAuth(async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { text } = req.body || {};
  if (!text?.trim()) return res.status(400).json({ success: false, error: 'text 필요' });

  const [custRes, prodRes] = await Promise.all([
    query(`SELECT CustKey, CustCode, CustName, CustArea, Manager, OrderCode FROM Customer WHERE ISNULL(isDeleted,0)=0 ORDER BY CustName`),
    query(`SELECT ProdKey, ProdCode, ProdName, ISNULL(DisplayName, ProdName) AS DisplayName, FlowerName, CounName, OutUnit
           FROM Product WHERE ISNULL(isDeleted,0)=0 ORDER BY ProdName`),
  ]);
  const customers = custRes.recordset;
  const products = prodRes.recordset;

  const parsed = parseKakaoRequests(text).map(r => {
    const custMatch = matchCustomer(customers, r.inputCustomer);
    const prodInfo = matchProduct(products, r.inputProduct);
    return {
      ...r,
      custMatch,
      prodMatch: prodInfo.match ? {
        ProdKey: prodInfo.match.ProdKey,
        ProdName: prodInfo.match.ProdName,
        DisplayName: getDisplayName(prodInfo.match),
        FlowerName: prodInfo.match.FlowerName,
        CounName: prodInfo.match.CounName,
        score: prodInfo.match._score,
      } : null,
      prodCandidates: prodInfo.candidates.map(p => ({
        ProdKey: p.ProdKey,
        ProdName: p.ProdName,
        DisplayName: getDisplayName(p),
        FlowerName: p.FlowerName,
        CounName: p.CounName,
        score: p._score,
      })),
    };
  });

  const dbState = await getDbState(parsed);
  const rows = parsed.map(r => {
    const key = r.week && r.custMatch?.CustKey && r.prodMatch?.ProdKey
      ? `${r.week}|${r.custMatch.CustKey}|${r.prodMatch.ProdKey}`
      : null;
    const db = key ? dbState.get(key) : null;
    const issues = [];
    if (!r.week) issues.push('차수 미감지');
    if (!r.custMatch) issues.push('업체 미매칭');
    if (!r.prodMatch) issues.push('품목 미매칭');
    if (r.prodMatch && r.prodMatch.score < 55) issues.push('품목 매칭 낮음');
    if (key && !db) issues.push('DB 조회 없음');
    if (db && Number(db.orderQty || 0) === 0) issues.push('주문등록 합계 0');
    if (db && Number(db.shipQty || 0) === 0) issues.push('출고분배 합계 0');
    if (db && r.action === '취소' && Number(db.shipQty || 0) > Number(db.orderQty || 0)) issues.push('취소 후 출고가 주문보다 큼');
    return {
      ...r,
      db: db || null,
      status: issues.length ? '확인필요' : '일치가능',
      issues,
    };
  });

  const summary = {
    total: rows.length,
    needReview: rows.filter(r => r.status === '확인필요').length,
    customerUnmatched: rows.filter(r => !r.custMatch).length,
    productUnmatched: rows.filter(r => !r.prodMatch).length,
    missingOrder: rows.filter(r => r.db && Number(r.db.orderQty || 0) === 0).length,
    missingShipment: rows.filter(r => r.db && Number(r.db.shipQty || 0) === 0).length,
  };

  return res.status(200).json({ success: true, summary, rows });
});
