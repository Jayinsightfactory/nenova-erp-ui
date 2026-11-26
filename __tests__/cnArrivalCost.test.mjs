// 중국 도착원가 CLOUD(항공) · HUBFRESH(해상) 이원화 엔진 백테스트 + 화면/엑셀 동기화 검증.
// 픽스처: 운영 DB SELECT-only 추출(dbWrites 0) + 정답 엑셀(47-2A/B·46-2·47-1·48-1 등) 셀 값.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { matchCnCategory, cnCategory, CN_CATEGORIES, isCnMetaName } from '../lib/cnArrivalCostRules.js';
import { cnSourceFromDbRows, buildCnDraft, computeCnCost, applyCnCategory, detectCnMode, normalizeCnPayload, reconcileCnAutoHeader } from '../lib/cnArrivalCostEngine.js';
import { createCnArrivalCostWorkbook, cnWorkbookLayout } from '../lib/cnArrivalCostWorkbook.js';
import { createCnArrivalCostHandler } from '../lib/cnArrivalCostHttp.js';
import { packingErpProducts } from '../lib/importPackingErpMatches.js';
import { parseHubfreshInvoice } from '../lib/hubfreshPacking.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'cnArrivalCost');
const fixture = name => JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), 'utf8'));
const key = (name, fob) => `${String(name).replace(/\s+/g, ' ').trim()}|${Number(fob)}`;

function draftFor(name, mode) {
  const f = fixture(name);
  return { f, draft: buildCnDraft(cnSourceFromDbRows(f.dbRows), { mode }) };
}
function backtest({ f, draft }, header, { overrides = {}, skip = [] } = {}) {
  const rows = draft.rows.map(row => {
    const o = Object.entries(overrides).find(([pattern]) => row.name.includes(pattern));
    if (!o) return row;
    const next = o[1].categoryCode ? applyCnCategory(row, o[1].categoryCode, draft.mode) : row;
    return { ...next, ...o[1] };
  });
  const result = computeCnCost({ mode: draft.mode, header: { ...draft.header, ...header }, rows });
  assert.deepEqual(result.issues, []);
  // 원가표 작성자가 엑셀 SEARCH 회피용으로 바꾼 품명('Eucalyptu ', 'ROS CHINA')과 ERP 품명을 맞춘다.
  const norm = name => String(name).replace(/^Eucalyptu(?!s)\b/, 'Eucalyptus').replace(/^ROS CHINA/, 'ROSE CHINA').replace(/\s+/g, '');
  const pool = f.excel.rows.map(r => ({ ...r, n: norm(r.name) }));
  const findExcel = row => pool.find(e => e.n === norm(row.name) && Number(e.fob) === Number(row.fob))
    ?? pool.find(e => Number(e.fob) === Number(row.fob) && e.n.slice(0, 16) === norm(row.name).slice(0, 16) && e.n.split('/')[0] === norm(row.name).split('/')[0]);
  let compared = 0; const misses = [];
  for (const row of result.rows) {
    const e = findExcel(row);
    if (!e || skip.some(s => row.name.includes(s))) continue;
    compared++;
    if (Math.abs(row.cost - e.cost) >= 1) misses.push(`${row.name} 엔진 ${row.cost.toFixed(2)} ≠ 엑셀 ${Number(e.cost).toFixed(2)} (운송 ${row.freight.toFixed(4)}/${Number(e.freight).toFixed(4)})`);
  }
  return { result, compared, misses };
}

test('41순위 매처: 함정 품목을 올바른 카테고리로 분류', () => {
  const cases = {
    'Eucalyptus CHINA / 포퓰러스 그레인, 열매 (populus grain) 600g': 'POPULUS',
    '[MEL] Eucalyptus CHINA / 포퓰러스 그레인, 열매 (round with fruit) 600g': 'POPULUS',
    '[MEL] Eucalyptus CHINA / 포퓰러스 시드, 다이브': 'EUCALYPTUS_SEEDS',
    'Greens Blue Star Fern CHINA / 블루스타펀': 'BLUE_STAR_FERN',
    'Greens CHINA / 보리사초 Chasmanthium': 'CHASMANTHIUM',
    'Greens CHINA / 패니쿰 Panicum': 'PANICUM',
    'Greens CHINA / 필리카 Phylica': 'PHYLICA',
    'ASPARAGUS CHINA Preserved White / 미디오': 'ASPARAGUS_PRESERVED',
    'Amaranthus CHINA Fresh / 줄맨드라미 생화 그린': 'AMARANTHUS_FRESH',
    'Preserved Amaranthus CHINA / 줄맨드라미 화이트': 'AMARANTHUS_PRESERVED',
    'ROSE CHINA / 꽃잎용 Petal Use (White) 40cm': 'ROSE_PETAL',
    'ROS CHINA / 꽃잎용 Petal Use (White) 40cm': 'ROSE_PETAL',
    'SPRAY ROSE CHINA / Fairy Kiss': 'SPRAY_ROSE',
    'Acasia CHINA / 미모사 Mimosa': 'GOLDEN_WATREE_ACACIA',
    'CHINA GoldenWatree / 골든와트리': 'GOLDEN_WATREE_ACACIA',
    'Eucalyptus CHINA / 블랙잭 (베이비 블루) (대) 1Kg': 'EUCALYPTUS_STANDARD_1KG',
    'Eucalyptus CHINA / 블랙잭 (베이비 블루) (소) 600g': 'EUCALYPTUS_BLACKJACK_600G',
    'Eucalyptu CHINA / 블랙잭 미니 (Baby Blue Mini) 300g': 'EUCALYPTUS_BLACKJACK_300G',
    'Eucalyptus CHINA / 유칼리튭스_시네리아 Cinerea': 'EUCALYPTUS_CINEREA',
    'Spray Carnation CHINA / 솔로미오 Solomio Cas': 'SPRAY_CARNATION',
    'Carnation CHINA / 돈셀 (Doncel)': 'CARNATION',
    'CHINA / 리모늄 미스티 블루(Limonium Misty blue) 500g': 'LIMONIUM_MISTY',
    'CHINA / 리모늄 시네신스 화이트 (Sinensis white) 500g': 'SINENSIS',
    'CHINA / 리모늄 스타티스 Statice Mix Box': 'STATICE_LIMONIUM',
    'CHINA / 코치아 (Kochia scoparia)': 'KOCHIA',
    'ORCHID CHINA / 호접란 White': 'ORCHID',
    'CHINA / 디디스커스 DIDSICUS': 'DIDISCUS',
  };
  for (const [name, code] of Object.entries(cases)) assert.equal(matchCnCategory(name)?.code, code, name);
  assert.equal(matchCnCategory('운송료'), null);
  assert.ok(isCnMetaName('Chargeable weight') && isCnMetaName('중국 TOTAL'));
  assert.equal(matchCnCategory('CHINA / 블러싱 브라이드 Serruria'), null, '미등록 품종은 조용히 GREENS 10단으로 흡수하지 않는다');
  assert.equal(cnCategory('KOCHIA').air.tariffRate, 0.214); assert.equal(cnCategory('KOCHIA').sea.tariffRate, 0.032);
  assert.equal(cnCategory('ASPARAGUS_PRESERVED').air.tariffRate, 0.25);
  assert.ok(CN_CATEGORIES.length >= 41);
});

test('운영 대상 7건 품목행 100% 자동 매칭 (메타·공란 행 제외)', () => {
  for (const name of ['cloud-8249', 'cloud-8250', 'cloud-8160', 'cloud-8064', 'hubfresh-8082', 'hubfresh-8170', 'hubfresh-8259']) {
    const { draft } = draftFor(name);
    assert.equal(draft.rows.filter(r => r.needsReview).length, 0, name);
    assert.ok(draft.rows.every(r => r.quantity > 0), `${name} 수량`);
  }
  assert.equal(draftFor('hubfresh-8259').draft.rows.length, 169, '#8259 주문별 분할 169행 그대로 처리');
});

test('모드 감지: HUBFRESH=해상, Cloudland=항공, 멜로디·헨지 레거시는 CLOUD 엔진 수수료 0%', () => {
  assert.equal(detectCnMode('KUN MING HUBFRESH SUPPLY CHAIN').mode, 'HUBFRESH');
  assert.equal(detectCnMode('Cloudland').mode, 'CLOUD');
  const legacy = buildCnDraft({ farmName: 'MELODY FLOWER', lines: [{ wdetailKey: 1, prodKey: 1, name: 'ROSE CHINA / 레드', outUnit: '단', bunchQuantity: 10, unitPrice: 20 }] });
  assert.equal(legacy.mode, 'CLOUD'); assert.equal(legacy.legacy, true); assert.equal(legacy.header.commissionRate, 0);
});

test('HUBFRESH 47-01 #8170: 정답 엑셀 47-1 해상 HUB 64행 원 단위 일치 + 운송료 40,191 함정 분리', () => {
  const ctx = draftFor('hubfresh-8170');
  assert.ok(ctx.draft.notices.some(n => /40,191/.test(n.text)), '#8170 합산 운송료 감지 안내');
  assert.ok(ctx.draft.header.seaFreight > 0 && ctx.draft.header.seaFreight < 40191, 'SEA FREIGHT 초안은 박스비를 뗀 값');
  const { result, compared, misses } = backtest(ctx, { exchangeRate: 210, nenovaCbm: 15.266, realCbm: 57.50352749999988, docFee: 1000,
    processUnit: 2.5, processBoxes: 342, quarantineBoxUnit: 5, quarantineBoxes: 418, seaFreight: 29600, logger: 300, loading: 1000 });
  assert.deepEqual(misses, []); assert.equal(compared, 64);
  assert.ok(Math.abs(result.derived.allocatedFreight - 9250.6285) < 1e-3, 'C11 안분운송료');
  assert.ok(Math.abs(result.derived.rate - 605.962825) < 1e-5, 'P5 Rate');
  assert.ok(Math.abs(result.derived.customsPerBunch - 1649.51237) < 1e-4, 'D32 그외통관');
  const sale = result.rows.find(r => r.name.includes('돈셀'));
  assert.ok(Math.abs(sale.salePrice - 8759.6225) < 0.01, 'S열 =P/0.85*1.1');
});

test('HUBFRESH 48-01 #8259: 정답 엑셀 48-1 해상 HUB 원 단위 일치 (주문별 분할 169행)', () => {
  const ctx = draftFor('hubfresh-8259');
  const { result, compared, misses } = backtest(ctx, { exchangeRate: 210, nenovaCbm: 23.63, realCbm: 68.00902199999976, processBoxes: 466, quarantineBoxes: 513, seaFreight: 55600 },
    // 48-1 시트는 블랙잭 600g을 300g 소박스(0.084 CBM)로 계산했다 → 행 카테고리 수정(override)으로 재현.
    { overrides: { '(소) 600g': { categoryCode: 'BLACKJACK_600G_SMALLBOX' } } });
  assert.deepEqual(misses, []); assert.ok(compared >= 160, `비교 ${compared}행`);
  assert.ok(Math.abs(result.derived.rate - 906.203298) < 1e-5);
  assert.ok(Math.abs(result.derived.customsTotal - 3989815.6042) < 0.01);
  assert.equal(result.totals.quantity, 3510);
});

test('HUBFRESH 46-01 #8082: 같은 최종본 수식으로 무결 계산 (구 50% 분할 시트는 참고)', () => {
  const ctx = draftFor('hubfresh-8082');
  const result = computeCnCost({ mode: 'HUBFRESH', header: { ...ctx.draft.header, nenovaCbm: 15.69683, realCbm: 46, seaFreight: 33000, processBoxes: 294, quarantineBoxes: 532 }, rows: ctx.draft.rows });
  assert.deepEqual(result.issues, []);
  assert.equal(result.totals.quantity, 2630);
  assert.ok(Math.abs(result.derived.customsTotal - (4000000 * 15.69683 / 46 + 2600000)) < 1e-6);
});

test('CLOUD 47-02A #8249: 정답 엑셀 47-2A CLOUD cbm 원 단위 일치', () => {
  const ctx = draftFor('cloud-8249');
  const { result, compared, misses } = backtest(ctx, { exchangeRate: 210, gw: 1823, cw: 2452, airFreight: 23168, quarantineCount: 18, allocationBasisCbm: 1 }, {
    // 시트는 미스티블루 60단을 시네신스 CBM(16kg/20단)으로 합산했다 → 단당CBM override 0.8.
    overrides: { '미스티 블루': { cbmPerBunch: 0.8 } },
    // 엑셀 수기 입력/참조 오류 셀: 미스티블루 H34=7.48·M34=1010 수기값, 코치아 P27이 POPULUS 점유율(AL28) 참조.
    skip: ['미스티 블루', '코치아'],
  });
  assert.deepEqual(misses, []); assert.equal(compared, 35);
  assert.ok(Math.abs(result.derived.customsPerBunch - 628.5750528541226) < 1e-9, 'T11 = T10 ÷ 총단수');
  assert.ok(Math.abs(result.derived.rate - 8.722026807081125) < 1e-9, 'E9 Rate = 항공료 ÷ 총CBM');
});

test('CLOUD 47-02B #8250: 호접란 송이 단위 422 없이 계산 + 정답 엑셀 47-2B 일치', () => {
  const ctx = draftFor('cloud-8250');
  const orchid = ctx.draft.rows.find(r => r.categoryCode === 'ORCHID');
  assert.equal(orchid.quantity, 90); assert.equal(orchid.stemsPerBunch, 1);
  assert.equal(ctx.draft.header.orchidPermit, 300, '호접란 포함 기본 300 CNY');
  const { compared, misses } = backtest(ctx, { exchangeRate: 210, gw: 21, cw: 70, airFreight: 1830, quarantineCount: 18, orchidPermit: 0 },
    // 47-2B 시트는 프리저브드 아스파라거스에 생화 세율 3.2%를 썼다 → 행 관세율 override로 재현(기본값은 25%).
    { overrides: { 'ASPARAGUS CHINA Preserved': { tariffRate: 0.032 } } });
  assert.deepEqual(misses, []); assert.equal(compared, 2);
  assert.equal(ctx.draft.rows.find(r => /Preserved/.test(r.name)).tariffRate, 0.25);
});

test('CLOUD 46-02 #8160: 입고 운송료 행 24,087 CNY 자동추출 + 정답 엑셀 46-2 일치', () => {
  const ctx = draftFor('cloud-8160');
  assert.equal(ctx.draft.header.airFreight, 24087);
  assert.equal(ctx.draft.header.cw, 2543);
  assert.ok(ctx.draft.notices.some(n => /GW와 CW를 구분/.test(n.text)), '공란 중량행 두 값이 같으면 GW 확인 안내');
  const { result, compared, misses } = backtest(ctx, { exchangeRate: 210, gw: 1896, cw: 2543, quarantineCount: 18 }, {
    // 46-2 시트(구 분류): 필리카를 ACASIA(10단·100*30*20)로, 프리저브드 아스파라거스를 생화 3.2%로 계산 → 행 override로 재현.
    overrides: { '필리카': { bunchesPerBox: 10, cbmPerBunch: 1 }, 'ASPARAGUS CHINA Preserved': { tariffRate: 0.032 } } });
  assert.deepEqual(misses, []); assert.ok(compared >= 40, `비교 ${compared}행`);
  assert.ok(Math.abs(result.derived.rate - 9.341634595371652) < 1e-9, 'E9 Rate');
});

test('CLOUD 46-03 #8064: 정적 JSON 없이 호접란 송이 입고 계산 (구세대 99,000 운송 시트는 참고)', () => {
  const ctx = draftFor('cloud-8064');
  assert.equal(ctx.draft.header.airFreight, 4649);
  const result = computeCnCost({ mode: 'CLOUD', header: { ...ctx.draft.header, gw: 234 }, rows: ctx.draft.rows });
  assert.deepEqual(result.issues, []); assert.equal(result.totals.quantity, 310);
  assert.ok(result.rows.find(r => r.categoryCode === 'ORCHID').permit > 0);
});

test('CLOUD GW = CW 이면 중량 비례, 3% 수수료는 관세 과세표준 미포함', () => {
  const rows = [{ lineId: 'a', name: 'ROSE', quantity: 10, fob: 20, bunchesPerBox: 10, cbmPerBunch: 1.3333, weightKgPerBunch: 0.8, tariffRate: 0.214, stemsPerBunch: 10, orchid: 0 },
    { lineId: 'b', name: 'EUC', quantity: 10, fob: 10, bunchesPerBox: 10, cbmPerBunch: 1.5, weightKgPerBunch: 1.1, tariffRate: 0.032, stemsPerBunch: 5, orchid: 0 }];
  const header = { exchangeRate: 200, gw: 100, cw: 100, airFreight: 190, allocationBasisCbm: 0, orchidPermit: 0, quarantineCount: 2 };
  const r = computeCnCost({ mode: 'CLOUD', header, rows });
  assert.ok(Math.abs(r.rows[0].freight - 0.8 * 190 / 19) < 1e-12);
  const rose = r.rows[0];
  assert.ok(Math.abs(rose.duty - rose.cnf * 200 * 0.214) < 1e-9 && Math.abs(rose.fee - rose.cnf * 0.03 * 200) < 1e-9);
  assert.ok(Math.abs(rose.costPerStem - rose.cost / 10) < 1e-9);
});

// ---- 화면 수정값 → 엑셀 수식 동기화: 생성된 .xlsx 수식을 직접 다시 계산해 엔진 결과와 대조한다 ----
function evaluateWorkbook(ws) {
  const cache = new Map();
  const raw = addr => ws.getCell(addr).value;
  const valueOf = addr => {
    addr = addr.replace(/\$/g, '');
    if (cache.has(addr)) return cache.get(addr);
    const v = raw(addr);
    const out = v && typeof v === 'object' && 'formula' in v ? evalFormula(v.formula) : typeof v === 'number' ? v : 0;
    cache.set(addr, out); return out;
  };
  function evalFormula(src) {
    const tokens = src.match(/\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?|\d+(?:\.\d+)?(?:e[+-]?\d+)?|[A-Z]+(?=\()|<=|>=|<>|[-+*/(),=<>]/g);
    let i = 0;
    const peek = () => tokens[i], next = () => tokens[i++];
    const range = ref => {
      const [a, b] = ref.replace(/\$/g, '').split(':');
      const [, ca, ra] = /([A-Z]+)(\d+)/.exec(a), [, , rb] = /([A-Z]+)(\d+)/.exec(b);
      const list = []; for (let r = +ra; r <= +rb; r++) list.push(valueOf(`${ca}${r}`)); return list;
    };
    function primary() {
      const t = next();
      if (t === '(') { const v = comparison(); next(); return v; }
      if (t === '-') return -primary();
      if (t === 'SUM' || t === 'IF') {
        next(); const args = [];
        while (peek() !== ')') { args.push(/:/.test(peek()) && t === 'SUM' ? range(next()) : comparison()); if (peek() === ',') next(); }
        next();
        return t === 'SUM' ? args.flat().reduce((s, v) => s + v, 0) : (args[0] ? args[1] : args[2]);
      }
      if (/^\d/.test(t)) return Number(t);
      return valueOf(t);
    }
    function term() { let v = primary(); while (peek() === '*' || peek() === '/') v = next() === '*' ? v * primary() : v / primary(); return v; }
    function expr() { let v = term(); while (peek() === '+' || peek() === '-') v = next() === '+' ? v + term() : v - term(); return v; }
    function comparison() {
      const a = expr();
      if (['=', '>', '<', '>=', '<=', '<>'].includes(peek())) { const op = next(), b = expr(); return { '=': a === b, '>': a > b, '<': a < b, '>=': a >= b, '<=': a <= b, '<>': a !== b }[op]; }
      return a;
    }
    return comparison();
  }
  return valueOf;
}

async function loadSheet(buffer) {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buffer); return wb;
}

for (const [name, mode, edits] of [
  ['hubfresh-8170', 'HUBFRESH', { header: { exchangeRate: 215, realCbm: 40, seaFreight: 31000, commonCustoms: 3500000, commissionRate: 0.01, marginRate: 0.2 }, row: { tariffRate: 0.25, stemsPerBunch: 12, bunchesPerBox: 20, cbmPerBunch: 0.005 } }],
  ['cloud-8160', 'CLOUD', { header: { exchangeRate: 205, gw: 1700, airFreight: 25000, disinfection: 150000, quarantineCount: 11, quarantinePerItem: 12000, commissionRate: 0.02 }, row: { tariffRate: 0.032, stemsPerBunch: 7, cbmPerBunch: 2, weightKgPerBunch: 0.9 } }],
]) {
  test(`화면 수정값 → 미리보기·엑셀 100% 동기화 (${mode} ${name})`, async () => {
    const { draft } = draftFor(name);
    const rows = draft.rows.map((row, index) => index === 0 ? { ...applyCnCategory(row, mode === 'CLOUD' ? 'GYPSOPHILA' : 'LISIANTHUS', mode), ...edits.row } : row);
    const payload = normalizeCnPayload({ mode, header: { ...draft.header, ...edits.header }, rows, warehouseKey: draft.warehouseKey, orderYear: draft.orderYear, orderWeek: draft.orderWeek, farmName: draft.farmName });
    const preview = computeCnCost(payload);
    const { buffer, layout } = await createCnArrivalCostWorkbook(payload);
    const wb = await loadSheet(buffer), ws = wb.getWorksheet('도착원가');
    // 1) 수정한 상단 입력값이 입력칸에 그대로 기록
    for (const [k, v] of Object.entries(edits.header)) assert.equal(ws.getCell(layout.input[k].replace(/\$/g, '')).value, v, k);
    // 2) 수정한 행 입력값이 행 입력칸에 그대로 기록
    for (const [k, v] of Object.entries(edits.row)) assert.equal(ws.getCell(`${layout.col[k]}${layout.firstLine}`).value, v, k);
    // 3) 엑셀 수식을 직접 재계산 = 화면 미리보기 = 수식 캐시값
    const evalCell = evaluateWorkbook(ws);
    preview.rows.forEach((row, index) => {
      const r = layout.firstLine + index;
      for (const k of ['freight', 'cnf', 'fee', 'cnfKrw', 'duty', 'customs', 'cost', 'costPerStem', 'salePrice']) {
        const recalculated = evalCell(`${layout.col[k]}${r}`), cached = ws.getCell(`${layout.col[k]}${r}`).value.result;
        assert.ok(Math.abs(recalculated - row[k]) < 1e-6, `${row.name} ${k} 재계산 ${recalculated} ≠ 화면 ${row[k]}`);
        assert.ok(Math.abs(cached - row[k]) < 1e-9, `${k} 캐시`);
      }
    });
    // 4) 수정값이 실제 원가를 바꿨는지(기본값 계산과 다름)
    const base = computeCnCost({ mode, header: draft.header, rows: draft.rows });
    assert.notEqual(Math.round(base.rows[0].cost), Math.round(preview.rows[0].cost));
    // 5) 글꼴: 맑은 고딕만, 굴림체 0건
    let cells = 0;
    ws.eachRow(row => row.eachCell(cell => { cells++; assert.equal(cell.font?.name, '맑은 고딕', cell.address); }));
    assert.ok(cells > 100);
    const zip = await JSZip.loadAsync(buffer);
    const styles = await zip.file('xl/styles.xml').async('string');
    assert.ok(!/굴림/.test(styles), '굴림체 0건');
  });
}

test('미등록 신품종은 422 대신 행 강조 + 카테고리 선택으로 즉시 해결, ProdKey 기억값 적용', () => {
  const source = { farmName: 'Cloudland', lines: [
    { wdetailKey: 1, prodKey: 2950, name: 'CHINA / 블러싱 브라이드 Serruria Florida', outUnit: '단', bunchQuantity: 20, unitPrice: 30 },
    { wdetailKey: 2, prodKey: 10, name: 'ROSE CHINA / 레드', outUnit: '단', bunchQuantity: 30, unitPrice: 20 }] };
  const draft = buildCnDraft(source, { mode: 'CLOUD' });
  assert.equal(draft.rows[0].needsReview, true);
  assert.ok(draft.notices.some(n => /미등록 품종 1건/.test(n.text)));
  assert.equal(computeCnCost(draft).issues.length, 0, '미등록 행이 있어도 계산은 막지 않는다');
  const fixed = applyCnCategory(draft.rows[0], 'SCABIOSA', 'CLOUD');
  assert.equal(fixed.needsReview, false); assert.equal(fixed.bunchesPerBox, 10);
  const remembered = buildCnDraft(source, { mode: 'CLOUD', memory: { 2950: { categoryCode: 'PHYLICA', tariffRate: 0.032, stemsPerBunch: 8 } } });
  assert.equal(remembered.rows[0].categoryCode, 'PHYLICA'); assert.equal(remembered.rows[0].needsReview, false);
  assert.equal(remembered.rows[0].memoryApplied, true); assert.equal(remembered.rows[0].stemsPerBunch, 8);
});

test('기본값 선입력: 빈칸 없이 모든 상단 필드가 숫자로 채워진다', () => {
  for (const name of ['cloud-8160', 'hubfresh-8259']) {
    const { draft } = draftFor(name);
    for (const [k, v] of Object.entries(draft.header)) assert.ok(Number.isFinite(v), `${name} ${k}`);
    assert.ok(Object.keys(draft.headerSources).length === Object.keys(draft.header).length);
  }
  const sea = draftFor('hubfresh-8259').draft.header;
  assert.equal(sea.commonCustoms, 4000000); assert.equal(sea.dedicatedCustoms, 2600000); assert.equal(sea.boxUnitPrice, 27); assert.equal(sea.commissionRate, 0);
  const air = draftFor('cloud-8160').draft.header;
  assert.equal(air.disinfection, 200000); assert.equal(air.domesticTransport, 195000); assert.equal(air.commissionRate, 0.03); assert.equal(air.warehousePerKg, 460);
});

test('API: GET은 SELECT 1건만(dbWrites 0)으로 소스 반환, POST는 화면 값 그대로 xlsx 생성', async () => {
  const f = fixture('hubfresh-8170');
  const sqlSeen = [];
  const types = { Int: 'Int', NVarChar: () => 'NVarChar' };
  const handler = createCnArrivalCostHandler({ queryFn: async text => { sqlSeen.push(text); return { recordset: f.dbRows.map(r => ({ ...r, FileName: null })) }; }, types,
    authorize: () => true, fetchRate: async () => { throw new Error('offline'); }, readExpenses: async () => null, resolveReference: () => null });
  const res = () => { const r = { headers: {}, statusCode: 0, body: null, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, send(b) { this.body = b; return this; }, end() { return this; } }; return r; };
  const get = res();
  await handler({ method: 'GET', user: {}, query: { warehouseKey: '8170', orderYear: '2026', orderWeek: '47-01' } }, get);
  assert.equal(get.statusCode, 200, JSON.stringify(get.body));
  assert.equal(get.body.dbWrites, 0);
  assert.ok(sqlSeen.every(q => /^\s*\/\*[^*]*\*\/\s*SELECT\b/i.test(q) && !/\b(INSERT|UPDATE|DELETE|MERGE|EXEC)\b/i.test(q)));
  const draft = buildCnDraft(get.body.source, {});
  assert.equal(draft.mode, 'HUBFRESH'); assert.equal(draft.rows.length, 64);
  const post = res();
  await handler({ method: 'POST', user: {}, body: { mode: draft.mode, header: { ...draft.header, seaFreight: 29600 }, rows: draft.rows, warehouseKey: 8170, orderYear: '2026', orderWeek: '47-01' } }, post);
  assert.equal(post.statusCode, 200);
  assert.match(post.headers['Content-Type'], /spreadsheetml/);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(post.body);
  const ws = wb.getWorksheet('도착원가');
  const layout = cnWorkbookLayout('HUBFRESH', 64);
  assert.equal(ws.getCell(layout.input.seaFreight.replace(/\$/g, '')).value, 29600);
  const denied = res();
  await createCnArrivalCostHandler({ queryFn: async () => ({ recordset: [] }), types, authorize: () => false })({ method: 'GET', user: {}, query: {} }, denied);
  assert.equal(denied.statusCode, 403);
});

test('PM-1 국가오염 보정: [MEL]/[오경]/CHINA 오등록(콜롬비아·네덜란드·중국TOTAL) 품목을 CN 후보로 상속', () => {
  const products = packingErpProducts([
    { ProdKey: 3031, ProdName: '[MEL] Eucalyptus CHINA / 포퓰러스 시드, 다이브', CounName: '콜롬비아', FlowerName: '아나나스', isDeleted: 0 },
    { ProdKey: 3086, ProdName: '[오경] ASPARAGUS CHINA Preserved Red', CounName: '콜롬비아', isDeleted: 0 },
    { ProdKey: 3501, ProdName: 'ROSE CHINA / 카푸치노', CounName: '네덜란드', isDeleted: 0 },
    { ProdKey: 3610, ProdName: '중국 TOTAL', CounName: '중국TOTAL', isDeleted: 0 },
    { ProdKey: 9001, ProdName: 'ROSE / 문라이트 60cm', CounName: '콜롬비아', isDeleted: 0 },
  ]);
  assert.equal(products.find(p => p.ProdKey === 3031)?.country, 'CN');
  assert.equal(products.find(p => p.ProdKey === 3031)?.selectable, true);
  assert.equal(products.find(p => p.ProdKey === 3086)?.country, 'CN');
  assert.equal(products.find(p => p.ProdKey === 3501)?.country, 'CN');
  assert.equal(products.find(p => p.ProdKey === 3610)?.country, 'CN');
  assert.equal(products.find(p => p.ProdKey === 9001)?.country, 'CO', '정상 콜롬비아 품목은 CO 유지');
});

test('PM-2 HUBFRESH 상세 인보이스 파서: CL 네노바 vs 타사 CBM 지분율 및 하단 부대비 추출', () => {
  const header = ['English name', 'Chinese name', 'Customer Code', 'Ctn No', 'Code', 'Length', 'Specification',
    'Box specifications', 'Order Quantities', 'Total of bunches', 'Stems', 'UNIT PRICE', 'AMOUNT'];
  const grid = [
    ['KUN MING HUBFRESH', 'INVOICE NO. XJ-2026-NN011'],
    header,
    ['Carnation Doncel', '', 'CL1', '1-2', 'C', '60CM', '20Stem', '100*40*20', 2, 30, 600, 16, 480],
    ['Rose Proud', '', 'HUB2', '3-8', 'R', '70CM', '10Stem', '100*40*20', 6, 60, 600, 20, 1200],
    ['', '', '', '', '', '', '', '', 8, 90, 1200, '', 1680],
    ['Phyto, Customs, CO', '', 1, 1000, 1000],
    ['PROCESS COST', '', 342, 2.5, 855],
    ['Quarantine box', '', 418, 5, 2090],
    ['SEA FREIGHT CHARGE/Logistics Fee', '', 1, 29600, 29600],
    ['Temperature Data Logger', '', 1, 300, 300],
    ['Loading and Unloading Fee', '', 1, 1000, 1000],
  ];
  const parsed = parseHubfreshInvoice(grid);
  assert.equal(parsed.cbmSummary.nenovaBoxes, 2);
  assert.equal(parsed.cbmSummary.nenovaCbm, 0.16);
  assert.equal(parsed.cbmSummary.realCbm, 0.64);
  assert.equal(parsed.cbmSummary.cbmShare, 0.25);
  assert.deepEqual(parsed.charges, { docFee: 1000, processUnit: 2.5, processBoxes: 342, quarantineBoxUnit: 5, quarantineBoxes: 418, seaFreight: 29600, logger: 300, loading: 1000 });
});

test('CLOUD 자동 배분(allocationMode=0): 엑셀 셀에서 GW=CW로 수정 시 수식이 중량 비례로 즉시 전환 + 백상비 직접입력 연동', async () => {
  const rows = [
    { lineId: 'a', name: 'ROSE CHINA / 프라우드', categoryCode: 'ROSE', quantity: 20, fob: 25, bunchesPerBox: 10, cbmPerBunch: 1.333333, weightKgPerBunch: 0.8, tariffRate: 0.214, stemsPerBunch: 10, orchid: 0 },
    { lineId: 'b', name: 'Eucalyptus CHINA / 블랙잭 1kg', categoryCode: 'EUCALYPTUS_STANDARD_1KG', quantity: 20, fob: 18, bunchesPerBox: 10, cbmPerBunch: 1.5, weightKgPerBunch: 1.1, tariffRate: 0.032, stemsPerBunch: 5, orchid: 0 },
  ];
  const payload = normalizeCnPayload({ mode: 'CLOUD', header: { exchangeRate: 210, gw: 380, cw: 500, airFreight: 3800, allocationMode: 0, warehouseFeeOverride: 250000, quarantineCount: 2 }, rows, warehouseKey: 8249, orderYear: '2026', orderWeek: '47-02' });
  const cbmPreview = computeCnCost(payload);
  assert.equal(cbmPreview.derived.useWeight, false);
  assert.equal(cbmPreview.derived.warehouseFee, 250000, '백상비 직접입력 우선');
  const { buffer, layout } = await createCnArrivalCostWorkbook(payload);
  const wb = await loadSheet(buffer), ws = wb.getWorksheet('도착원가');
  // 엑셀 파일 안에서 사용자가 CW를 GW(380)와 같게 바꿨을 때 수식이 자동으로 중량 비례로 재계산되는지 검증
  ws.getCell(layout.input.cw.replace(/\$/g, '')).value = 380;
  const weightPreview = computeCnCost({ ...payload, header: { ...payload.header, cw: 380 } });
  assert.equal(weightPreview.derived.useWeight, true);
  const evalAfterEdit = evaluateWorkbook(ws);
  weightPreview.rows.forEach((row, index) => {
    const r = layout.firstLine + index;
    assert.ok(Math.abs(evalAfterEdit(`${layout.col.freight}${r}`) - row.freight) < 1e-6);
    assert.ok(Math.abs(evalAfterEdit(`${layout.col.cost}${r}`) - row.cost) < 1e-6);
  });
});

test('복수 입고(#8249+#8250) 통합 조회·정적 JSON 무의존 검증 및 행 수정 시 자동 헤더 동기화', async () => {
  const httpSource = fs.readFileSync(new URL('../lib/cnArrivalCostHttp.js', import.meta.url), 'utf8');
  assert.doesNotMatch(httpSource, /cloudCostReferenceEvidence|cloud-cost-reference-evidence/, '#8249/#8250 정적 JSON 의존 0건');
  const fA = fixture('cloud-8249'), fB = fixture('cloud-8250');
  const types = { Int: 'Int', NVarChar: () => 'NVarChar' };
  const handler = createCnArrivalCostHandler({
    queryFn: async (_sql, params) => ({ recordset: (params.warehouseKey.value === 8249 ? fA.dbRows : fB.dbRows).map(r => ({ ...r, FileName: null })) }),
    types, authorize: () => true, fetchRate: async () => ({ marketRate: 196.5, rate: 211.5 }), readExpenses: async () => null,
  });
  let body = null;
  await handler({ method: 'GET', user: {}, query: { warehouseKeys: '8249,8250', orderYear: '2026', orderWeek: '47-02' } },
    { setHeader() {}, status() { return this; }, json(b) { body = b; return this; } });
  assert.deepEqual(body.source.warehouseKeys, [8249, 8250]);
  assert.equal(body.source.exchangeRate, 211.5);
  const combined = buildCnDraft(body.source, {});
  assert.equal(combined.rows.length, 40, '38행 + 2행 = 40행');
  assert.equal(combined.header.orchidPermit, 300);

  // HUB2 중국 TOTAL 단독 전표 방어 + reconcileCnAutoHeader 검증
  const hub2 = buildCnDraft(cnSourceFromDbRows([{ WarehouseKey: 8257, OrderYear: '2026', OrderWeek: '47-01', FarmName: 'HUB2', ProdKey: 3610, ProdName: '중국 TOTAL', TPrice: 50023709 }]), {});
  assert.equal(hub2.rows.length, 0);
  assert.ok(hub2.notices.some(n => /HUB2/.test(n.text)));

  const seaDraft = draftFor('hubfresh-8170').draft;
  const beforeBoxes = seaDraft.header.processBoxes;
  const editedSea = reconcileCnAutoHeader({ ...seaDraft, rows: seaDraft.rows.map((r, i) => i === 0 ? { ...r, quantity: r.quantity + 150 } : r) });
  assert.ok(editedSea.header.processBoxes > beforeBoxes, '수동 수정 전에는 규격표 역산 박스수가 행 수량 변경에 자동 반응');
});
