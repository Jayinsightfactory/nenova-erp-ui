// 매출원가 양식(원본 xlsx)과 Nenovaweb 계산 규칙의 차이를 항목별로 찾아낸다 — 읽기 전용, DB 미사용.
//
//   node scripts/diff-profit-workbook-vs-web.mjs <xlsx가 있는 디렉터리>
//
// 검사 항목
//   1. 전차수 기말 F → 다음차수 기초 E 연결(엑셀 파일들 사이)
//   2. F 산출 방식 — 엑셀 카테고리 평균원가 수식 / 사람이 직접 입력
//   3. 과세환율 R 카테고리별 주차 시프트
//   4. 콜롬비아 배분 풀에 수국이 들어간 반차수
//   5. J 수식에 박힌 차수이월 수기 보정
//   6. 매출이 없는데 F/G/H가 있는 행
//   7. 국가별 그외통관비 H — 엑셀 vs 웹 computeCountryCustomsTotal
//   8. 콜롬비아 반차수 TOTAL·배분비율·트럭 — 엑셀 vs 웹
//   9. 기말상품재고액 — 엑셀 수식 vs 웹(그 차수 매입 평균원가 × 기말수량)
//  10. 호주 재고 평가(재고잔량 R/Q열) 재현
//  11. 본표 수기 셀의 파일 내부 근거 추적
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import XLSX from 'xlsx-js-style';
import { computeCountryCustomsTotal, computeColombiaCustomsTotal, computeColombiaRatios, colombiaUsesWeightRatio } from '../lib/customsForwardingCalc.js';
import { deriveTruckPlan, truckPlanAmount } from '../lib/colombiaTruck.js';
import { computeCategoryAverageInventoryValue, weeklyAverageInventoryUnitCost } from '../lib/profitReportCalc.js';
import { RATE_DEFAULTS } from '../lib/customsForwarding.js';

const dir = process.argv[2] || '.';
const MAIN = '주차별 매출이익 보고서';
const CATS = ['콜롬비아 수국', '콜롬비아 카네이션', '콜롬비아 장미', '콜롬비아 루스커스', '콜롬비아 알스트로',
  '네덜란드', '호주', '태국', '중국', '에콰도르', '미국', '이스라엘', '뉴질랜드', '일본', '베트남'];
const COUNTRY_ROWS = ['콜롬비아 수국', '네덜란드', '태국', '호주', '미국', '중국', '에콰도르', '이스라엘', '뉴질랜드', '일본', '베트남'];
// 엑셀 본표 F 수식이 참조하는 재고잔량 시트 행 범위(하드코딩된 범위 — 시트 구조가 바뀌면 어긋난다)
const STOCK_RANGES = {
  '콜롬비아 수국': [7, 23], '콜롬비아 카네이션': [30, 32], '콜롬비아 장미': [92, 92],
  '콜롬비아 루스커스': [72, 72], '콜롬비아 알스트로': [79, 85], '베트남': [152, 155],
};

const num = (sh, a) => (typeof sh?.[a]?.v === 'number' ? sh[a].v : 0);
const raw = (sh, a) => sh?.[a]?.v ?? null;
const fml = (sh, a) => sh?.[a]?.f ?? null;
const money = (x) => (x == null ? '-' : Number(x).toLocaleString('ko-KR', { maximumFractionDigits: 2 }));
const near = (a, b, tol = 0.51) => a != null && b != null && Math.abs(Number(a) - Number(b)) <= tol;

function load(file) {
  const full = path.join(dir, file);
  const wb = XLSX.readFile(full, { cellFormula: true });
  const ms = wb.Sheets[MAIN];
  if (!ms) return null;
  const major = String(raw(ms, 'B1') || '').match(/(\d+)차/)?.[1]?.padStart(2, '0') || null;
  const rowOf = (cat) => {
    for (let r = 7; r <= 23; r += 1) if (String(raw(ms, `B${r}`) || '') === cat) return r;
    return null;
  };
  const rows = {};
  for (const cat of CATS.concat(['국내', '공제'])) {
    const r = rowOf(cat);
    if (r == null) continue;
    rows[cat] = { row: r };
    for (const col of ['C', 'E', 'F', 'G', 'H', 'I', 'J', 'N', 'O', 'P', 'Q', 'R', 'S', 'T']) {
      rows[cat][col] = { v: raw(ms, `${col}${r}`), f: fml(ms, `${col}${r}`) };
    }
  }
  const purchaseQty = {};
  const ps = wb.Sheets['구매현황'];
  if (ps?.['!ref']) {
    const ref = XLSX.utils.decode_range(ps['!ref']);
    for (let r = ref.s.r; r <= ref.e.r; r += 1) {
      const cat = raw(ps, XLSX.utils.encode_cell({ c: 13, r }));
      if (!cat) continue;
      purchaseQty[String(cat)] = (purchaseQty[String(cat)] || 0) + (Number(raw(ps, XLSX.utils.encode_cell({ c: 3, r }))) || 0);
    }
  }
  return {
    file, major, wb, ms, rows, purchaseQty,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex'),
  };
}

const weeks = fs.readdirSync(dir).filter((f) => f.endsWith('.xlsx') && !f.startsWith('~$'))
  .map(load).filter(Boolean).sort((a, b) => Number(a.major) - Number(b.major));

if (!weeks.length) {
  console.error(`${dir} 에 매출원가 양식 xlsx가 없습니다.`);
  process.exit(1);
}

console.log('=== 대상 파일 ===');
for (const w of weeks) console.log(`  ${w.major}차  sha256:${w.sha256.slice(0, 16)}  ${w.file}`);

console.log('\n=== 1. 전차수 기말 F → 다음차수 기초 E (엑셀 파일들 사이) ===');
for (let i = 1; i < weeks.length; i += 1) {
  const [prev, cur] = [weeks[i - 1], weeks[i]];
  const bad = [];
  for (const cat of CATS) {
    const pf = Number(prev.rows[cat]?.F?.v ?? 0);
    const ce = Number(cur.rows[cat]?.E?.v ?? 0);
    if (!near(pf, ce, 0.005)) bad.push(`${cat} F=${money(pf)} → E=${money(ce)} (Δ ${money(ce - pf)})`);
  }
  console.log(`  ${prev.major}→${cur.major}차 : ${bad.length ? `★ ${bad.length}건 불일치` : '전 품목 일치'}`);
  bad.forEach((b) => console.log(`      ${b}`));
}

console.log('\n=== 2. 기말재고 F 산출 방식 ===');
for (const w of weeks) {
  const byFormula = [];
  const byHand = [];
  for (const cat of CATS) {
    const cell = w.rows[cat]?.F;
    if (!cell) continue;
    if (cell.f) byFormula.push(cat);
    else if (cell.v != null) byHand.push(`${cat}=${money(cell.v)}`);
  }
  console.log(`  ${w.major}차 수식(카테고리 평균원가): ${byFormula.join(', ') || '-'}`);
  console.log(`        사람이 직접 입력        : ${byHand.join(' | ') || '-'}`);
}

console.log('\n=== 3. 과세환율 R (같은 통화인데 카테고리별로 다른 주차 값) ===');
const rateCats = ['콜롬비아 수국', '네덜란드', '호주', '태국', '중국', '에콰도르', '베트남'];
console.log(`  차수 ${rateCats.map((c) => c.padStart(13)).join('')}`);
for (const w of weeks) {
  console.log(`  ${w.major}차 ${rateCats.map((c) => String(w.rows[c]?.R?.v ?? '-').padStart(13)).join('')}`);
}

console.log('\n=== 4. 콜롬비아 배분 풀에 수국 포함 여부 (본표 수국 H/S 수식) ===');
for (const w of weeks) {
  const h = w.rows['콜롬비아 수국']?.H?.f || '(수기)';
  const s = w.rows['콜롬비아 수국']?.S?.f || '(수기)';
  console.log(`  ${w.major}차 ${/콜롬비아 \d차/.test(h) ? '★ 반차수 풀 포함' : '나라 단위'}  H=${h}`);
  console.log(`         S=${s}`);
}

console.log('\n=== 5. J 수식에 박힌 차수이월 수기 보정 ===');
for (const w of weeks) {
  for (const cat of CATS.concat(['국내'])) {
    const f = w.rows[cat]?.J?.f;
    if (f && /[+-]\s*\d{3,}/.test(f)) console.log(`  ${w.major}차 ${cat}: J=${f}`);
  }
}

console.log('\n=== 6. 매출 0인데 재고·매입이 있는 행 ===');
for (const w of weeks) {
  for (const cat of CATS) {
    const r = w.rows[cat];
    if (!r) continue;
    const C = Number(r.C?.v || 0);
    if (Math.abs(C) < 0.5 && (Math.abs(Number(r.F?.v || 0)) > 0.5 || Math.abs(Number(r.G?.v || 0)) > 0.5)) {
      console.log(`  ${w.major}차 ${cat}: C=${money(C)} E=${money(r.E?.v)} F=${money(r.F?.v)} G=${money(r.G?.v)} H=${money(r.H?.v)} I=${money(r.I?.v)}`);
    }
  }
}

console.log('\n=== 7. 국가별 그외통관비 H — 엑셀 vs 웹 computeCountryCustomsTotal ===');
for (const w of weeks) {
  const cs = w.wb.Sheets['그외통관비'];
  if (!cs) continue;
  const bakRate = num(cs, 'C3');
  console.log(`  ${w.major}차 (백상요율 ${bakRate}원/kg)`);
  COUNTRY_ROWS.forEach((cat, i) => {
    const row = {
      GW1: num(cs, `C${5 + i}`), GW2: num(cs, `D${5 + i}`),
      Customs1: num(cs, `I${5 + i}`), Customs2: num(cs, `J${5 + i}`),
      SunYul1: num(cs, `C${20 + i}`), SunYul2: num(cs, `D${20 + i}`),
      WorldFreight1: num(cs, `I${20 + i}`), WorldFreight2: num(cs, `J${20 + i}`),
      Quarantine1: num(cs, `C${35 + i}`), Quarantine2: num(cs, `D${35 + i}`),
      BakSangRateApplied: bakRate,
    };
    const excelH = num(cs, `I${35 + i}`);
    if (!excelH) return;
    const webH = computeCountryCustomsTotal(row, RATE_DEFAULTS, cat);
    const gw = row.GW1 + row.GW2;
    const plan = deriveTruckPlan(gw);
    const webWorld = plan ? truckPlanAmount(plan, RATE_DEFAULTS) : 0;
    const excelWorld = row.WorldFreight1 + row.WorldFreight2;
    console.log(`    ${cat.padEnd(9)} H 엑셀=${money(excelH).padStart(12)} 웹=${money(webH).padStart(12)} ${near(excelH, webH) ? '일치' : `★차이 ${money(webH - excelH)}`}`
      + `  |  월드운송료 엑셀=${money(excelWorld).padStart(9)} 웹추천=${money(webWorld).padStart(9)} (GW ${gw}kg) ${near(excelWorld, webWorld) ? '일치' : '★차이'}`);
  });
}

console.log('\n=== 8. 콜롬비아 반차수 TOTAL·배분비율·트럭 — 엑셀 vs 웹 ===');
for (const w of weeks) {
  for (const half of ['1차', '2차']) {
    const sh = w.wb.Sheets[`콜롬비아 ${half}`];
    if (!sh) continue;
    const gw = num(sh, 'L30');
    const cw = num(sh, 'L29');
    const row = {
      GW: num(sh, 'E10'), CW: cw, HandlingFee: num(sh, 'C11'), ItemCount: num(sh, 'E12'),
      Truck1t: num(sh, 'I5'), Truck2_5t: num(sh, 'I6'), Truck5t: num(sh, 'I7'),
      CustomsFee: num(sh, 'C14'), DisinfectFee: num(sh, 'C15'), QuarantineDeductFee: num(sh, 'C16'),
      BakSangRateApplied: 460,
    };
    const excelTotal = num(sh, 'C17');
    const webTotal = computeColombiaCustomsTotal(row, RATE_DEFAULTS);
    const plan = deriveTruckPlan(row.GW);
    const webTruck = plan ? truckPlanAmount(plan, RATE_DEFAULTS) : 0;
    const boxQty = {
      '콜롬비아 장미': num(sh, 'L37'), '콜롬비아 카네이션': num(sh, 'L38'),
      '콜롬비아 알스트로': num(sh, 'L39'), '콜롬비아 루스커스': num(sh, 'L40'), '콜롬비아 수국': num(sh, 'L41'),
    };
    const includeHydrangea = boxQty['콜롬비아 수국'] > 0;
    const ratios = computeColombiaRatios(boxQty, RATE_DEFAULTS, { includeHydrangea });
    // 웹·엑셀 모두 그외통관비는 항상 무게비율, 항공료만 과금중량=총중량 여부로 갈린다.
    const webAirUsesWeight = colombiaUsesWeightRatio(gw, cw);
    const excelHUsesWeight = /M3\d/.test(fml(sh, 'H21') || '');
    const excelAirUsesWeight = Math.abs(cw - gw) <= 0.01;
    console.log(`  ${w.major}차 ${half}  GW=${gw} CW=${cw}  TOTAL 엑셀=${money(excelTotal)} 웹=${money(webTotal)} ${near(excelTotal, webTotal) ? '일치' : `★차이 ${money(webTotal - excelTotal)}`}`);
    console.log(`         트럭 엑셀=${money(num(sh, 'C13'))} 웹추천=${money(webTruck)} ${near(num(sh, 'C13'), webTruck) ? '일치' : '★차이'}`);
    console.log(`         그외통관비 배분 엑셀=${excelHUsesWeight ? '무게고정' : 'CBM'} 웹=무게고정 ${excelHUsesWeight ? '일치' : '★차이'}`
      + `   |   항공료 배분 엑셀=${excelAirUsesWeight ? '무게' : 'CBM'} 웹=${webAirUsesWeight ? '무게' : 'CBM'} ${excelAirUsesWeight === webAirUsesWeight ? '일치' : '★차이'}`);
    console.log(`         수국 포함 ${includeHydrangea ? 'O' : 'X'}  박스수 ${JSON.stringify(boxQty)}`);
    if (includeHydrangea) {
      const sameWeight = num(sh, 'K41') === RATE_DEFAULTS.BoxWeight_콜롬비아수국;
      const sameCbm = num(sh, 'P41') === RATE_DEFAULTS.BoxCBM_콜롬비아수국;
      console.log(`         수국 박스계수 엑셀 무게=${num(sh, 'K41')} CBM=${num(sh, 'P41')} / 웹 무게=${RATE_DEFAULTS.BoxWeight_콜롬비아수국} CBM=${RATE_DEFAULTS.BoxCBM_콜롬비아수국}`
        + ` ${sameWeight && sameCbm ? '일치' : '★차이'}`);
    }
    const excelAlloc = {
      '콜롬비아 장미': num(sh, 'H21'), '콜롬비아 카네이션': num(sh, 'H22'),
      '콜롬비아 알스트로': num(sh, 'H23'), '콜롬비아 루스커스': num(sh, 'H24'), '콜롬비아 수국': num(sh, 'H25'),
    };
    for (const [cat, val] of Object.entries(excelAlloc)) {
      if (!val) continue;
      const webVal = excelTotal * (ratios.weightRatio[cat] || 0);
      if (!near(val, webVal, 1)) console.log(`           ${cat.padEnd(9)} 그외통관비 엑셀=${money(val).padStart(12)} 웹=${money(webVal).padStart(12)} ★차이 ${money(webVal - val)}`);
    }
  }
}

console.log('\n=== 9. 기말상품재고액 — 엑셀 수식 vs 웹 (그 차수 매입 평균원가 × 기말수량) ===');
for (const w of weeks) {
  const inv = w.wb.Sheets['재고잔량'];
  for (const [cat, [a, b]] of Object.entries(STOCK_RANGES)) {
    const r = w.rows[cat];
    if (!r) continue;
    let endQty = 0;
    const items = [];
    for (let rr = a; rr <= b; rr += 1) {
      endQty += Number(raw(inv, `M${rr}`)) || 0;
      const nm = raw(inv, `J${rr}`) ?? raw(inv, `B${rr}`);
      if (nm) items.push(String(nm));
    }
    const qty = w.purchaseQty[cat] || 0;
    const Q = Number(r.Q?.v || 0);
    const R = Number(r.R?.v || 0);
    const S = Number(r.S?.v || 0);
    const H = Number(r.H?.v || 0);
    const avg = computeCategoryAverageInventoryValue({
      category: cat, purchaseForeign: Q, forwardingForeign: S, taxableRate: R, customsCost: H, purchaseQty: qty, stockQty: endQty,
    });
    const unitCost = weeklyAverageInventoryUnitCost({
      purchaseForeign: Q, forwardingForeign: S, taxableRate: R, customsCost: H, purchaseQty: qty,
    });
    console.log(`  ${w.major}차 ${cat.padEnd(9)} 기말수량=${String(endQty).padStart(6)}(재고잔량!M${a}:M${b}, ${items.length}품목) 매입수량=${String(qty).padStart(6)}`
      + `  엑셀F=${money(r.F?.v).padStart(14)} 웹평균식=${money(avg?.value).padStart(14)} ${avg && near(avg.value, Number(r.F?.v), 1) ? '일치' : '★차이'}`
      + `  그차수단가=${money(unitCost)}`);
  }
}

console.log('\n=== 10. 호주 재고 평가 재현 (재고잔량 Q/R열) ===');
for (const w of weeks) {
  const inv = w.wb.Sheets['재고잔량'];
  if (!inv) continue;
  const rate = num(inv, 'O37');
  const r54 = num(inv, 'R54');
  const q54 = num(inv, 'Q54');
  const p54 = num(inv, 'P54');
  const excelF = Number(w.rows['호주']?.F?.v ?? 0);
  const which = near(excelF, r54) ? 'R54 (통관비 미포함)'
    : near(excelF, r54 + q54) ? 'R54+Q54 (단당 통관비 포함)'
      : '★ 어느 쪽과도 불일치';
  console.log(`  ${w.major}차 호주 평가환율=${rate}(재고잔량!O37) 단당통관비=${money(p54)}(${fml(inv, 'P54') || '-'})`);
  console.log(`         R54=${money(r54)} Q54=${money(q54)} 본표F=${money(excelF)} → ${which}`);
}

console.log('\n=== 11. 본표 수기 셀(E/F)의 파일 내부 근거 추적 ===');
for (const w of weeks) {
  console.log(`  ${w.major}차`);
  for (const cat of CATS) {
    const r = w.rows[cat];
    if (!r) continue;
    for (const col of ['E', 'F']) {
      const cell = r[col];
      if (!cell || cell.f || cell.v == null || Number(cell.v) === 0) continue;
      const target = Number(cell.v);
      const hits = [];
      for (const sheetName of w.wb.SheetNames) {
        const sh = w.wb.Sheets[sheetName];
        if (!sh?.['!ref']) continue;
        const ref = XLSX.utils.decode_range(sh['!ref']);
        for (let rr = ref.s.r; rr <= ref.e.r; rr += 1) {
          for (let cc = ref.s.c; cc <= ref.e.c; cc += 1) {
            const addr = XLSX.utils.encode_cell({ c: cc, r: rr });
            if (sheetName === MAIN && addr === `${col}${r.row}`) continue;
            if (typeof sh[addr]?.v !== 'number') continue;
            if (near(sh[addr].v, target)) hits.push(`${sheetName}!${addr}`);
          }
        }
      }
      console.log(`    ${cat.padEnd(9)} ${col}${r.row}=${money(target).padStart(14)} → ${hits.length ? hits.slice(0, 4).join(', ') : '⚠ 파일 내부 근거 없음(외부 수기)'}`);
    }
  }
}
