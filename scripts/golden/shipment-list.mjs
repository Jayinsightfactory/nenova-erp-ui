#!/usr/bin/env node
// Golden test: 출고 내역서(영업부 수기 엑셀) ↔ ERP DB 재생성 규칙 대조.
// READ-ONLY (SELECT only). 사용법:
//   node scripts/golden/shipment-list.mjs [파일 또는 폴더 ...] [--json out.json] [--mode final|first]
// 기본 입력: %USERPROFILE%/Documents/카카오톡 받은 파일/*출고*내역서*.xlsx
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';
import { suggestDisplayName, jamoSimilarity } from '../../lib/displayName.js';

const require = createRequire(import.meta.url);
const ExcelJS = require('exceljs');
const { q, close } = require('./_db.js');

// ───────────────────────── 1. 골든 파일 파싱 ─────────────────────────
const txt = (v) => {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if ('result' in v) return v.result == null ? '' : String(v.result);
    if (v.formula) return '';
    if (v instanceof Date) return v.toISOString();
  }
  return String(v);
};
const num = (v) => {
  if (v && typeof v === 'object') { if (v.formula || v.sharedFormula) return null; v = v.result; }
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const isSubtotal = (s) => /합\s*계|총\s*합|총\s*박스/.test(s);

export async function parseGolden(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  const title = clean(txt(ws.getCell('B1').value));
  // 제목: "<거래처> <NN>차 (예상) 출고리스트(M월D일 ...)"
  const tm = title.match(/^(.*?)\s*(\d{1,2})차.*?\((\d{1,2})월\s*(\d{1,2})일/);
  const fm = path.basename(file).match(/(\d{1,2})차\s*(.+?)\s*출고/);
  const customer = clean(fm ? fm[2] : tm ? tm[1] : '');
  const week = Number(fm ? fm[1] : tm ? tm[2] : 0);
  // 헤더 행 탐색
  let hdr = 0; const col = {};
  for (let r = 1; r <= 10 && !hdr; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= 12; c++) {
      const h = txt(row.getCell(c).value).replace(/\s/g, '');
      if (!h) continue;
      if (/^품명$/.test(h) && !col.cat) { col.cat = c; hdr = r; }
      else if (/^(컬러|칼라)$/.test(h) && !col.variety) col.variety = c;
      else if (/(주문|발주)수량/.test(h) && !col.order) col.order = c;
      else if (/출고수량/.test(h) && !col.out) col.out = c;
      else if (/^단가$/.test(h) && !col.price) col.price = c;
      else if (/비고/.test(h) && !col.remark) col.remark = c;
    }
  }
  if (!hdr) throw new Error(`헤더 없음: ${file}`);
  const rows = []; let groupOrder = -1; let lastCat = null; let remark = ''; let rowOrder = 0;
  for (let r = hdr + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cat = clean(txt(row.getCell(col.cat).value));
    const variety = clean(txt(row.getCell(col.variety).value));
    const rm = col.remark ? clean(txt(row.getCell(col.remark).value)) : '';
    if (rm && /\d+\/\d+/.test(rm)) remark = rm;
    if (!variety || isSubtotal(variety) || isSubtotal(cat)) continue;
    if (cat !== lastCat) { groupOrder++; lastCat = cat; rowOrder = 0; }
    rows.push({
      customer, week, category: cat, variety,
      orderQty: num(row.getCell(col.order).value),
      unitPrice: col.price ? num(row.getCell(col.price).value) : null,
      remark, shipDate: (remark.match(/(\d{1,2})\/(\d{1,2})/) || []).slice(1).map(Number).join('/'),
      groupOrder, rowOrder: rowOrder++, excelRow: r,
    });
  }
  // docProps modified = 파일 작성 시점
  // 파일 저장시각(docProps modified, UTC) → DB naive KST 비교용으로 +9h
  const savedKst = wb.modified ? new Date(wb.modified.getTime() + 9 * 3600e3) : null;
  return { file, title, customer, week, savedKst, titleDate: tm ? `${+tm[3]}/${+tm[4]}` : null, rows };
}

// ───────────────────────── 2. DB 재생성 규칙 ─────────────────────────
const HANGUL = /[가-힣]/;
const FLOWER_KO = /^(카네이션|장미|수국|루스커스|알스트로|레몬잎|MOK|모카라|DEN\.?|덴파레|튤립|스프레이 장미)\s*/i;
/** Product → 출고 내역서 '컬러' 칸 표기 */
const EXTRA_KO = [ // suggestDisplayName 사전에 없는 품종 음역 (골든 표기 기준)
  [/PRADO\s*MINT/i, '프라도 민트'], [/DILETTA\s*\(?YELLOW\)?/i, '딜레타 옐로우'], [/LION\s*KING/i, '라이온킹'],
  [/LOLLIPOP\s*WHITE\s*BLUE/i, '염색 블루 화이트'], [/TINTED\s*AURORA/i, '염색 오로라'], [/TINTED\s*BLUE/i, '염색 블루'],
  [/ORANGE\s*FLAME/i, '오렌지'], [/CRIMEA/i, '크리미아'], [/DAMINA/i, '다미나'], [/KAORI/i, '카오리'], [/JODIE/i, '조디에'],
  [/MANDALA/i, '만달라'], [/MOMENTUM/i, '모멘텀'], [/COUNTRY\s*BLUES?/i, '컨트리블루'], [/BRIGHTON/i, '브라이튼'], [/IGUANA/i, '이구아나'],
  [/LAURA/i, '로라'], [/MAMMA\s*MIA/i, '맘마미아'], [/LA\s*GAZZA/i, '라가짜'], [/BLESSING/i, '블레싱'], [/HERMOSA/i, '헤르모사'],
  [/SUGAR\s*DOLL/i, '슈가돌'], [/ORANGE\s*CRUSH/i, '오렌지 크러쉬'], [/MONDIAL\s*PINK|PINK\s*MONDIAL/i, '몬디알핑크'], [/ALTAIR/i, '알테어'],
  [/EDMOND/i, '에드몬드'], [/QUICK\s*SAND/i, '퀵샌드'], [/BE\s*SWEET/i, '비스위트'], [/RED\s*PANTHER/i, '레드팬서'],
  [/NAHEMA/i, '나헤마'], [/CHERRIO/i, '체리오'], [/WEDDING/i, '웨딩'], [/DON\s*PEDRO/i, '돈페드로'], [/ZURIGO/i, '쥬리고'], [/TINTED\s*MIX/i, '염색 믹스'], [/PLAYA\s*BLANCA/i, '플라야블랑카'],
];
const ALSTRO_COLOR = { WHISTLER: '화이트', DUBAI: '연핑크', FIFI: '라벤다', PACIFIC: '피치' }; // 알스트로=품종명 대신 색상으로 적음
function rawLabel(p) {
  const name = String(p.ProdName || '').trim();
  const flower = String(p.FlowerName || '');
  if (flower === '알스트로') { const k = name.replace(/^ALSTROMERIA\s*/i, '').toUpperCase(); return ALSTRO_COLOR[k] || k; }
  if (flower === '루스커스' || flower === '레몬잎') return flower;
  for (const [re, ko] of EXTRA_KO) if (re.test(name)) return ko;
  if (HANGUL.test(name)) {
    const afterSlash = name.includes('/') ? name.split('/').slice(1).join('/') : '';
    const bare = clean(afterSlash.replace(/\(.*?\)|\[.*?\]|（.*?）|\d+\s*(g|kg)\b/ig, ''));
    if (HANGUL.test(bare)) return clean(bare.replace(/^(달리아)\s*/, '다알리아 '));
    const paren = [...name.matchAll(/[(（]([^()（）]*[가-힣][^()（）]*)[)）]/g)].map((m) => m[1]);
    if (paren.length) return clean(paren[paren.length - 1]);
    const tail = name.match(/([가-힣][가-힣\s]*)\s*[A-Z]*\s*$/);
    if (tail) return clean(tail[1]);
  }
  let ko = suggestDisplayName(name) || name;
  ko = ko.replace(/^(장미|스프레이 장미)\s*(CHINA)?\s*\/\s*/i, '').replace(FLOWER_KO, '').replace(/\s*\d+\s*CM\b/i, '');
  if (/^MINICARNATION|^미니카네이션/i.test(name)) ko = '스프레이 ' + ko.replace(/^MINICARNATION\s*/i, '');
  ko = ko.replace(/^TINTED\s+/i, '염색 ').replace(/\s*\([A-Z\s]+\)\s*$/i, '').replace(/\s*\d+\s*CM\b/ig, '');
  return clean(ko) || flower;
}

const HYD_KO = { '염색 연한 라벤더': '라벤다', '미니 그린 베이스': '미니그린', '염색연그린': '연그린', '라벤더': '라벤다' };
/** Product → 출고 내역서 '컬러' 칸 표기 (정재훈 파일 관례: 알스트로=색상, 미니카네이션=스프레이, 태국=덴파레/모카라 접두) */
export function varietyLabel(p) {
  const name = String(p.ProdName || '');
  let v = rawLabel(p).replace(/\s*\d+\s*CM\b/ig, '').replace(/\s*\d+\s*k?g\b/ig, '').replace(/[\s.]+$/, '');
  if (p.FlowerName === '수국') v = HYD_KO[v] || v;
  if (/^MINI\s*CARNATION/i.test(name) && !/^스프레이/.test(v)) v = '스프레이 ' + v;
  if (/^MOK\b/i.test(name)) v = '모카라 ' + v;
  if (/^DEN\./i.test(name)) v = '덴파레 ' + v;
  return clean(v);
}
/** 대분류(골든 비교용 family) */
export function familyOfProduct(p) {
  const f = String(p.FlowerName || ''); const c = String(p.CounName || ''); const n = String(p.ProdName || '').toUpperCase();
  if (f === '카네이션') return /MINI/.test(n) ? 'carnation' : 'carnation';
  if (f === '장미') return c === '중국' ? 'china' : 'rose';
  if (c === '중국') return 'china';
  if (f === '수국') return 'hydrangea';
  if (f === '루스커스' || f === '레몬잎') return 'greens';
  if (f === '알스트로') return 'alstro';
  if (c === '태국') return 'thai';
  if (c === '네덜란드') return 'dutch';
  return f || 'etc';
}
export function familyOfGolden(g) {
  const s = `${g.category} ${g.variety}`;
  if (/중국|다알리아|퐁퐁/.test(s)) return 'china';
  if (/덴파레|모카라|온시디움|태국/.test(s)) return 'thai';
  if (/네덜란드|튤립|네리네|아스틸베/.test(s)) return 'dutch';
  if (/카네이션/.test(g.category)) return 'carnation';
  if (/장미|제주/.test(g.category)) return 'rose';
  if (/수국/.test(s)) return 'hydrangea';
  if (/루스커스|레몬잎|소재/.test(s)) return 'greens';
  if (/알스트로/.test(s)) return 'alstro';
  return null; // 주말도착건 등 = 날짜 그룹
}
const unitQty = (p, box, bunch, steam) => {
  const u = String(p.OutUnit || '');
  if (/박스|box/i.test(u)) return box; if (/단|bunch/i.test(u)) return bunch; if (/송이|st/i.test(u)) return steam; return box;
};
/** 표시 단가: ShipmentDate.Cost(견적단가, EstUnit 기준). EstUnit=송이 & OutUnit=단 이면 단 단가로 환산 */
export function displayPrice(p, cost, estQty, outQty) {
  if (cost == null) return null;
  const est = String(p.EstUnit || ''); const out = String(p.OutUnit || '');
  if (/송이/.test(est) && /단/.test(out)) {
    const spb = Number(p.SteamOf1Bunch) || (outQty ? estQty / outQty : 0) || (Number(p.SteamOf1Box) / (Number(p.BunchOf1Box) || 1));
    return Math.round(cost * spb);
  }
  return Math.round(cost);
}

async function loadWeek(year, week) {
  const wk = String(week).padStart(2, '0');
  // 주문 (OrderDetail: isDeleted 있음) + 같은 차수 출고 (ShipmentDetail: isDeleted 없음 → sm.isDeleted로만)
  const orders = await q(`
    SELECT om.CustKey, c.CustName, c.BaseOutDay, om.OrderYear, om.OrderWeek, od.OrderDetailKey, od.CreateDtm, p.ProdKey, p.ProdName, p.FlowerName, p.CounName,
           p.OutUnit, p.EstUnit, p.BunchOf1Box, p.SteamOf1Bunch, p.SteamOf1Box,
           od.BoxQuantity, od.BunchQuantity, od.SteamQuantity
      FROM OrderMaster om
      JOIN OrderDetail od ON od.OrderMasterKey = om.OrderMasterKey
      JOIN Product p ON p.ProdKey = od.ProdKey
      JOIN Customer c ON c.CustKey = om.CustKey
     WHERE om.OrderYear = @y AND om.OrderWeek LIKE @w
       AND ISNULL(om.isDeleted,0)=0 AND ISNULL(od.isDeleted,0)=0`, { y: String(year), w: `${wk}-%` });
  const ships = await q(`
    SELECT sm.CustKey, sm.OrderWeek, sd.ProdKey, sd.OutQuantity, sd.EstQuantity, d.ShipmentDtm, d.Cost, d.EstQuantity AS DEst
      FROM ShipmentMaster sm
      JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
      LEFT JOIN ShipmentDate d ON d.SdetailKey = sd.SdetailKey
     WHERE sm.OrderYear = @y AND sm.OrderWeek LIKE @w AND ISNULL(sm.isDeleted,0)=0`, { y: String(year), w: `${wk}-%` });
  // 단가 폴백: 이번 차수에 출고행(ShipmentDate)이 아직 없으면 같은 거래처·품목의 직전 견적단가
  const prevCost = await q(`
    SELECT x.CustKey, x.ProdKey, x.Cost, x.EstQuantity, x.OutQuantity FROM (
      SELECT sm.CustKey, sd.ProdKey, d.Cost, sd.EstQuantity, sd.OutQuantity,
             ROW_NUMBER() OVER (PARTITION BY sm.CustKey, sd.ProdKey ORDER BY sm.OrderYear DESC, sm.OrderWeek DESC, d.ShipmentDtm DESC) rn
        FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
        JOIN ShipmentDate d ON d.SdetailKey = sd.SdetailKey
       WHERE ISNULL(sm.isDeleted,0)=0 AND d.Cost > 0 AND sm.OrderYear = @y AND sm.OrderWeek < @w0
    ) x WHERE x.rn = 1`, { y: String(year), w0: `${wk}-00` });
  return { orders, ships, prevCost };
}

const EXCLUDE = (p) => p.FlowerName === '왁스' || /운송료|운임/.test(p.ProdName);

/** 루트 CLAUDE.md 규칙3: 차수 시작일(1/1+(N-1)*7)의 당일/직전 수요일 + BaseOutDay 오프셋 */
// 주말도착건(태국·네덜란드·에콰도르 항공 주말 입고) = 다음 화요일 출고로 적는 관례. ERP ShipmentDtm엔 반영 안 됨.
const WEEKEND_ARRIVAL = new Set(['태국', '네덜란드', '에콰도르']);
const OUT_OFFSET = [0, 4, 5, 6, 1, 3, 2];
export function baseOutDate(year, orderWeek, baseOutDay) {
  const n = parseInt(String(orderWeek), 10); if (!n || baseOutDay == null) return '';
  const d = new Date(Date.UTC(+year, 0, 1, 12) + (n - 1) * 7 * 864e5);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() - 3 + 7) % 7));
  d.setUTCDate(d.getUTCDate() + (OUT_OFFSET[+baseOutDay] ?? 0));
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}
function prevPrice(keys, prodKey, p, data) {
  const r = (data.prevCost || []).find((x) => keys.has(x.CustKey) && x.ProdKey === prodKey);
  return r ? displayPrice(p, +r.Cost, +r.EstQuantity, +r.OutQuantity) : null;
}
/** 한 거래처·차수의 출고 내역서 행 생성 */
export function buildRows(custKey, data, { mode = 'final' } = {}) {
  const keys = new Set([].concat(custKey));
  const byProd = new Map();
  for (const o of data.orders) {
    if (!keys.has(o.CustKey) || EXCLUDE(o)) continue;
    if (mode === 'first' && !/-01$/.test(o.OrderWeek)) continue;
    const k = o.ProdKey;
    const cur = byProd.get(k) || { p: o, orderQty: 0, weeks: new Set() };
    cur.orderQty += Number(unitQty(o, +o.BoxQuantity, +o.BunchQuantity, +o.SteamQuantity)) || 0;
    cur.weeks.add(o.OrderWeek);
    const cd = o.CreateDtm ? new Date(o.CreateDtm) : null; if (cd && (!cur.firstCreated || cd < cur.firstCreated)) cur.firstCreated = cd;
    byProd.set(k, cur);
  }
  const rows = [];
  for (const [k, v] of byProd) {
    if (!(v.orderQty > 0)) continue;
    const sh = data.ships.filter((s) => keys.has(s.CustKey) && s.ProdKey === k && (mode !== 'first' || /-01$/.test(s.OrderWeek)));
    const withCost = sh.filter((s) => s.Cost != null);
    const s0 = withCost.sort((a, b) => (b.DEst || 0) - (a.DEst || 0))[0];
    const dt = s0?.ShipmentDtm ? new Date(s0.ShipmentDtm) : null; // DB datetime = KST naive
    rows.push({
      prodKey: k, prodName: v.p.ProdName, family: familyOfProduct(v.p), variety: varietyLabel(v.p),
      orderQty: Math.round(v.orderQty * 100) / 100,
      unitPrice: s0 ? displayPrice(v.p, +s0.Cost, +s0.EstQuantity, +s0.OutQuantity) : prevPrice(keys, k, v.p, data),
      priceSource: s0 ? 'ShipmentDate.Cost' : 'prevWeek.ShipmentDate.Cost',
      shipDateDb: dt ? `${dt.getUTCMonth() + 1}/${dt.getUTCDate()}` : '',
      shipDate: baseOutDate(v.p.OrderYear, v.p.OrderWeek, WEEKEND_ARRIVAL.has(v.p.CounName) ? 3 : v.p.BaseOutDay) || (dt ? `${dt.getUTCMonth() + 1}/${dt.getUTCDate()}` : ''),
      weeks: [...v.weeks].sort().join(','), firstCreated: v.firstCreated,
    });
  }
  return rows;
}

// ───────────────────────── 3. 대조 ─────────────────────────
const norm = (s) => String(s || '').toLowerCase().replace(/[\s()\[\]\-_.*/,]/g, '').replace(/컬러|칼라/g, '');
const ALIAS = [ // 골든 표기 → 생성 표기 정규화(동의어). 규칙 버그가 아니라 표기 흔들림.
  [/^(.+)염색$/, '염색$1'], [/화이트블루/g, '블루화이트'], [/비스윗$/, '비스위트'], [/안네슬리/g, '안슬레이'], [/블라이드/g, '브라이드'],
  [/라벤다/g, '라벤더'], [/다알리아/g, '달리아'], [/로다스크림/g, '로다스'],
  [/알바리코게/g, '피치'], [/미니그린진?/g, '미니그린'],
];
const alias = (s) => ALIAS.reduce((a, [re, to]) => a.replace(re, to), norm(s));
function nameScore(g, d) {
  const a = alias(g.variety.replace(/^수국\s*/, '')); const b = alias(d.variety);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (b.includes(a) || a.includes(b)) return 0.9;
  let s = 0; try { s = jamoSimilarity(a, b) || 0; } catch { s = 0; }
  return s;
}
export function compare(golden, gen) {
  const pairs = [];
  for (const g of golden.rows) {
    const fam = familyOfGolden(g);
    for (const d of gen) {
      if (fam && fam !== d.family) continue;
      const s = nameScore(g, d);
      if (s >= 0.6) pairs.push({ g, d, s: s + (g.orderQty === d.orderQty ? 0.05 : 0) });
    }
  }
  pairs.sort((x, y) => y.s - x.s);
  const usedG = new Set(); const usedD = new Set(); const matched = [];
  for (const p of pairs) { if (usedG.has(p.g) || usedD.has(p.d)) continue; usedG.add(p.g); usedD.add(p.d); matched.push(p); }
  const fields = ['variety', 'orderQty', 'unitPrice', 'shipDate', 'family'];
  const res = { matched: [], missing: golden.rows.filter((g) => !usedG.has(g)), extra: gen.filter((d) => !usedD.has(d)), cells: { total: 0, ok: 0 }, byField: {} };
  for (const f of fields) res.byField[f] = { ok: 0, total: 0 };
  for (const { g, d } of matched) {
    const mism = [];
    const chk = (f, e, got, eq) => { res.byField[f].total++; res.cells.total++; if (eq) { res.byField[f].ok++; res.cells.ok++; } else mism.push({ field: f, expected: e, got }); };
    chk('variety', g.variety, d.variety, alias(g.variety.replace(/^수국\s*/, '')) === alias(d.variety));
    chk('orderQty', g.orderQty, d.orderQty, (g.orderQty ?? 0) === d.orderQty);
    chk('unitPrice', g.unitPrice, d.unitPrice, g.unitPrice == null || g.unitPrice === d.unitPrice); // 골든 빈칸(중국 단가 미정) = 비교 제외
    chk('shipDate', g.shipDate, d.shipDate, !g.shipDate || g.shipDate === d.shipDate);
    res.byField.shipDateDb = res.byField.shipDateDb || { ok: 0, total: 0, note: '참고용(점수 제외): ShipmentDate.ShipmentDtm' };
    res.byField.shipDateDb.total++; if (!g.shipDate || g.shipDate === d.shipDateDb) res.byField.shipDateDb.ok++;
    const fam = familyOfGolden(g); chk('family', fam || '(날짜그룹)', d.family, !fam || fam === d.family);
    res.matched.push({ excelRow: g.excelRow, category: g.category, golden: g.variety, prod: d.prodName, weeks: d.weeks, mism });
  }
  // 누락/초과 행도 셀 분모에 포함 (행당 5칸)
  res.cells.total += (res.missing.length + res.extra.length) * fields.length;
  res.rowMatchPct = golden.rows.length ? Math.round((matched.length / golden.rows.length) * 1000) / 10 : 0;
  res.cellMatchPct = res.cells.total ? Math.round((res.cells.ok / res.cells.total) * 1000) / 10 : 0;
  return res;
}

// 거래처 해석: 이름 토큰 + 생성 행과의 대조 점수 최대
function nameHint(golden, custName) {
  const a = golden.customer.replace(/남대문|대구|원협|\(주\)|꽃도매/g, ''); const b = custName.replace(/\(주\)|（.*?）|\(.*?\)/g, '');
  const t = [...a.matchAll(/[가-힣]{2}/g)].map((m) => m[0]);
  return t.some((x) => b.includes(x) || custName.includes(x)) ? 1 : 0;
}

async function main() {
  const args = process.argv.slice(2);
  const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
  const modeArg = args.includes('--mode') ? args[args.indexOf('--mode') + 1] : null;
  const inputs = args.filter((a, i) => !a.startsWith('--') && !['--json', '--mode'].includes(args[i - 1]));
  if (!inputs.length) inputs.push(path.join(os.homedir(), 'Documents', '카카오톡 받은 파일'));
  const files = inputs.flatMap((p) => fs.statSync(p).isDirectory()
    ? fs.readdirSync(p).filter((f) => /출고\s*내역서.*\.xlsx$/i.test(f) && !f.startsWith('~$')).map((f) => path.join(p, f)) : [p]);
  const cache = new Map(); const report = [];
  for (const file of files.sort()) {
    const golden = await parseGolden(file);
    const year = 2026; // 파일명에 연도 없음: 현재 운영연도
    if (!cache.has(golden.week)) cache.set(golden.week, await loadWeek(year, golden.week));
    const data = cache.get(golden.week);
    const custs = [...new Map(data.orders.map((o) => [o.CustKey, o.CustName])).entries()];
    let best = null;
    const hinted = custs.filter(([, cn]) => nameHint(golden, cn));
    const cands = [...custs.map(([k, n]) => [k, n])];
    for (let i = 0; i < hinted.length; i++) for (let j = i + 1; j < hinted.length; j++) cands.push([[hinted[i][0], hinted[j][0]], `${hinted[i][1]} + ${hinted[j][1]}`]);
    for (const [ck, cn] of cands) {
      for (const mode of modeArg ? [modeArg] : ['final', 'first']) {
        const gen = buildRows(ck, data, { mode });
        const cmp = compare(golden, gen);
        const score = cmp.cellMatchPct + (String(cn).split(' + ').every((n) => nameHint(golden, n)) ? 5 : 0);
        if (!best || score > best.score) best = { score, custKey: ck, custName: cn, mode, cmp, gen };
      }
    }
    const { cmp } = best;
    report.push({ file: path.basename(file), customer: golden.customer, week: golden.week, custKey: best.custKey, custName: best.custName, mode: best.mode,
      goldenRows: golden.rows.length, genRows: best.gen.length, matchedRows: cmp.matched.length, rowMatchPct: cmp.rowMatchPct, cellMatchPct: cmp.cellMatchPct,
      byField: cmp.byField,
      mismatches: cmp.matched.filter((m) => m.mism.length),
      missing: cmp.missing.map((g) => ({ excelRow: g.excelRow, category: g.category, variety: g.variety, orderQty: g.orderQty, unitPrice: g.unitPrice })),
      extra: cmp.extra.map((d) => ({ prod: d.prodName, variety: d.variety, orderQty: d.orderQty, weeks: d.weeks,
        cause: golden.savedKst && d.firstCreated > golden.savedKst ? '파일 저장 후 주문 추가(타이밍)' : '파일에 없음(수기 삭제/다른 파일)' })),
      missingCause: 'ERP 해당 거래처 주문에 대응 품목 없음(수기 추가·타 거래처코드·단가미정 중국)' });
  }
  await close();
  for (const r of report) {
    console.log(`\n== ${r.file} → CustKey ${r.custKey} ${r.custName} [mode=${r.mode}]`);
    console.log(`   rows golden ${r.goldenRows} / gen ${r.genRows} / matched ${r.matchedRows} (${r.rowMatchPct}%)  cell match ${r.cellMatchPct}%`);
    console.log('   field: ' + Object.entries(r.byField).map(([f, v]) => `${f} ${v.ok}/${v.total}`).join(', '));
    for (const m of r.mismatches) console.log(`   ≠ R${m.excelRow} ${m.golden} ⇐ ${m.prod} [${m.weeks}] ` + m.mism.map((x) => `${x.field}: ${x.expected}→${x.got}`).join('; '));
    for (const g of r.missing) console.log(`   - 누락 R${g.excelRow} ${g.category}/${g.variety} ${g.orderQty ?? ''}`);
    for (const d of r.extra) console.log(`   + 초과 ${d.prod} (${d.variety}) ${d.orderQty} [${d.weeks}] — ${d.cause}`);
  }
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  main().catch(async (e) => { console.error(e.message); await close(); process.exit(1); });
}
