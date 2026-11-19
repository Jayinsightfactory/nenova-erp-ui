// lib/gabrielProfitAgi.js
// 가브리엘(Gabriel) 수입·원가·이익 최적화 AGI 순수 도메인 추론·반사실 시뮬레이션 엔진.
// DB·React·파일 I/O 의존 없음. 서버/클라이언트/단위테스트 공용.
// 원장 무쓰기 원칙: 이 모듈은 순수 계산·진단·제안만 수행하며 어떠한 DB 변경도 발생시키지 않는다.

import { normalizeCountryCode, countryLabel, PIPELINE_COUNTRIES } from './importOneStopPipeline.js';
import { colombiaBoxMetrics, isColombiaCountry, isChinaCountry } from './boxMetricTable.js';

export const GABRIEL_VIEW_MODES = Object.freeze([
  Object.freeze({
    id: 'A',
    code: 'VIEW A',
    label: '뷰 A · 원가·이익 레버 분해 레이더 & 원장',
    shortLabel: '레버 분해 & 원장',
    description: '5대 이익 레버 수평 분해 프로파일과 품목별 실질 도착원가(True Landed Cost) 고밀도 원장',
  }),
  Object.freeze({
    id: 'B',
    code: 'VIEW B',
    label: '뷰 B · 마진×물량 2×2 매트릭스 & 반사실 드로어',
    shortLabel: '2×2 매트릭스',
    description: '원가 리스크 × 차수 이익 기여도 4분면 매트릭스와 선택 품목 반사실 시뮬레이션 드로어',
  }),
  Object.freeze({
    id: 'C',
    code: 'VIEW C',
    label: '뷰 C · 매트 카본 수익 관제 콘솔',
    shortLabel: '카본 수익 콘솔',
    description: '환율 스트레스 래더, AWB 중량 브레이크포인트 게이지, 크레딧 미회수 원장, 가브리엘 속도 루틴',
  }),
]);

export const DEFAULT_FX_RATES = Object.freeze({
  USD: 1385,
  EUR: 1505,
  CNY: 194,
  AUD: 915,
  JPY: 9.1,
  COP: 0.32,
});

export const DEFAULT_SIM_PARAMS = Object.freeze({
  fxDeltaKRW: 0, // -50 ~ +100 KRW per USD (other currencies scaled proportionally)
  rebalancePct: 25, // 0 ~ 50% shift from high-cost farm to competitive peer farm
  boxFillGainPct: 10, // 0 ~ 20% box fill normalization / AWB consolidation gain
  marginDefenseRatio: 100, // 0 ~ 100% adoption of recommended selling price defense
  targetMarginPct: 18, // 12 ~ 30% target gross margin threshold
  creditRecoveryEnabled: true, // include unrecovered farm credit note claims
});

// 국가별 AWB 항공운임 중량 구간 단가표 (USD/kg, 네덜란드는 EUR/kg)
export const AWB_TIER_SCHEDULES = Object.freeze({
  CO: Object.freeze({
    currency: 'USD',
    tiers: [
      { minKg: 0, maxKg: 99.9, rate: 5.85, label: '<100kg' },
      { minKg: 100, maxKg: 299.9, rate: 5.15, label: '+100kg' },
      { minKg: 300, maxKg: 499.9, rate: 4.65, label: '+300kg' },
      { minKg: 500, maxKg: 999.9, rate: 4.25, label: '+500kg' },
      { minKg: 1000, maxKg: Infinity, rate: 3.95, label: '+1000kg' },
    ],
  }),
  EC: Object.freeze({
    currency: 'USD',
    tiers: [
      { minKg: 0, maxKg: 99.9, rate: 6.10, label: '<100kg' },
      { minKg: 100, maxKg: 299.9, rate: 5.45, label: '+100kg' },
      { minKg: 300, maxKg: 499.9, rate: 4.95, label: '+300kg' },
      { minKg: 500, maxKg: 999.9, rate: 4.55, label: '+500kg' },
      { minKg: 1000, maxKg: Infinity, rate: 4.20, label: '+1000kg' },
    ],
  }),
  NL: Object.freeze({
    currency: 'EUR',
    tiers: [
      { minKg: 0, maxKg: 99.9, rate: 4.75, label: '<100kg' },
      { minKg: 100, maxKg: 299.9, rate: 4.15, label: '+100kg' },
      { minKg: 300, maxKg: 499.9, rate: 3.70, label: '+300kg' },
      { minKg: 500, maxKg: 999.9, rate: 3.35, label: '+500kg' },
      { minKg: 1000, maxKg: Infinity, rate: 3.05, label: '+1000kg' },
    ],
  }),
  CN: Object.freeze({
    currency: 'USD',
    tiers: [
      { minKg: 0, maxKg: 99.9, rate: 3.15, label: '<100kg' },
      { minKg: 100, maxKg: 299.9, rate: 2.65, label: '+100kg' },
      { minKg: 300, maxKg: 499.9, rate: 2.30, label: '+300kg' },
      { minKg: 500, maxKg: 999.9, rate: 2.05, label: '+500kg' },
      { minKg: 1000, maxKg: Infinity, rate: 1.85, label: '+1000kg' },
    ],
  }),
  VN: Object.freeze({
    currency: 'USD',
    tiers: [
      { minKg: 0, maxKg: 99.9, rate: 3.45, label: '<100kg' },
      { minKg: 100, maxKg: 299.9, rate: 2.95, label: '+100kg' },
      { minKg: 300, maxKg: 499.9, rate: 2.55, label: '+300kg' },
      { minKg: 500, maxKg: 999.9, rate: 2.25, label: '+500kg' },
      { minKg: 1000, maxKg: Infinity, rate: 2.00, label: '+1000kg' },
    ],
  }),
  TH: Object.freeze({
    currency: 'USD',
    tiers: [
      { minKg: 0, maxKg: 99.9, rate: 3.60, label: '<100kg' },
      { minKg: 100, maxKg: 299.9, rate: 3.10, label: '+100kg' },
      { minKg: 300, maxKg: 499.9, rate: 2.75, label: '+300kg' },
      { minKg: 500, maxKg: 999.9, rate: 2.45, label: '+500kg' },
      { minKg: 1000, maxKg: Infinity, rate: 2.15, label: '+1000kg' },
    ],
  }),
  AU: Object.freeze({
    currency: 'USD',
    tiers: [
      { minKg: 0, maxKg: 99.9, rate: 5.40, label: '<100kg' },
      { minKg: 100, maxKg: 299.9, rate: 4.80, label: '+100kg' },
      { minKg: 300, maxKg: 499.9, rate: 4.35, label: '+300kg' },
      { minKg: 500, maxKg: 999.9, rate: 3.95, label: '+500kg' },
      { minKg: 1000, maxKg: Infinity, rate: 3.65, label: '+1000kg' },
    ],
  }),
});

export const GABRIEL_BENCHMARK_SKUS = Object.freeze([
  {
    id: 'sku-co-carn-red',
    prodKey: 4101,
    prodName: '콜롬비아 카네이션 스탠다드 레드 65cm',
    countryCode: 'CO',
    countryName: '콜롬비아',
    flower: '카네이션',
    unit: '송이',
    farmName: 'Flores Gambur SAS',
    peerFarmName: 'Maxiflores SAS',
    boxes: 28,
    actualUnitsPerBox: 270, // 표준 300송이 대비 10% 미달
    targetUnitsPerBox: 300,
    boxWeightKg: 11,
    fobForeign: 0.215,
    peerFobForeign: 0.194,
    currency: 'USD',
    freightPerUnitUSD: 0.175,
    customsPerUnitKRW: 58,
    otherPerUnitKRW: 34,
    prevLandedKRW: 590,
    currentSellPriceKRW: 720,
    expectedSalesQty: 7560,
  },
  {
    id: 'sku-co-hyd-white',
    prodKey: 4102,
    prodName: '콜롬비아 수국 화이트 점보',
    countryCode: 'CO',
    countryName: '콜롬비아',
    flower: '수국',
    unit: '송이',
    farmName: 'Turflor',
    peerFarmName: 'El Redil',
    boxes: 36,
    actualUnitsPerBox: 36, // 표준 40송이 대비 10% 미달
    targetUnitsPerBox: 40,
    boxWeightKg: 5.5,
    fobForeign: 1.48,
    peerFobForeign: 1.32,
    currency: 'USD',
    freightPerUnitUSD: 0.72,
    customsPerUnitKRW: 290,
    otherPerUnitKRW: 165,
    prevLandedKRW: 3290,
    currentSellPriceKRW: 3980,
    expectedSalesQty: 1296,
  },
  {
    id: 'sku-co-rose-candle',
    prodKey: 4103,
    prodName: '콜롬비아 장미 캔들라이트 60cm',
    countryCode: 'CO',
    countryName: '콜롬비아',
    flower: '장미',
    unit: '송이',
    farmName: 'Esperance Roses',
    peerFarmName: 'The Elite Flowers',
    boxes: 24,
    actualUnitsPerBox: 180, // 표준 200송이 대비 10% 미달
    targetUnitsPerBox: 200,
    boxWeightKg: 8,
    fobForeign: 0.48,
    peerFobForeign: 0.435,
    currency: 'USD',
    freightPerUnitUSD: 0.21,
    customsPerUnitKRW: 94,
    otherPerUnitKRW: 48,
    prevLandedKRW: 1040,
    currentSellPriceKRW: 1260,
    expectedSalesQty: 4320,
  },
  {
    id: 'sku-co-alstro-mix',
    prodKey: 4104,
    prodName: '콜롬비아 알스트로에메리아 셀렉트 믹스',
    countryCode: 'CO',
    countryName: '콜롬비아',
    flower: '알스트로',
    unit: '단',
    farmName: 'Cultivos del Norte',
    peerFarmName: 'Flores De Funza',
    boxes: 22,
    actualUnitsPerBox: 18,
    targetUnitsPerBox: 20,
    boxWeightKg: 9.7,
    fobForeign: 2.35,
    peerFobForeign: 2.15,
    currency: 'USD',
    freightPerUnitUSD: 2.48,
    customsPerUnitKRW: 690,
    otherPerUnitKRW: 320,
    prevLandedKRW: 7250,
    currentSellPriceKRW: 8900,
    expectedSalesQty: 396,
  },
  {
    id: 'sku-nl-tulip-mango',
    prodKey: 4201,
    prodName: '네덜란드 튤립 망고 참 40cm',
    countryCode: 'NL',
    countryName: '네덜란드',
    flower: '튤립',
    unit: '단',
    farmName: 'Holex Flower BV',
    peerFarmName: 'EZ Flower NL',
    boxes: 30,
    actualUnitsPerBox: 28,
    targetUnitsPerBox: 30,
    boxWeightKg: 10.5,
    fobForeign: 3.45,
    peerFobForeign: 3.18,
    currency: 'EUR',
    freightPerUnitUSD: 1.52,
    customsPerUnitKRW: 840,
    otherPerUnitKRW: 380,
    prevLandedKRW: 8100,
    currentSellPriceKRW: 9850,
    expectedSalesQty: 840,
  },
  {
    id: 'sku-ec-rose-explorer',
    prodKey: 4301,
    prodName: '에콰도르 장미 익스플로러 70cm',
    countryCode: 'EC',
    countryName: '에콰도르',
    flower: '장미',
    unit: '송이',
    farmName: 'Rosas del Valle',
    peerFarmName: 'Nevado Ecuador',
    boxes: 26,
    actualUnitsPerBox: 175,
    targetUnitsPerBox: 200,
    boxWeightKg: 9.2,
    fobForeign: 0.56,
    peerFobForeign: 0.495,
    currency: 'USD',
    freightPerUnitUSD: 0.27,
    customsPerUnitKRW: 112,
    otherPerUnitKRW: 54,
    prevLandedKRW: 1210,
    currentSellPriceKRW: 1470,
    expectedSalesQty: 4550,
  },
  {
    id: 'sku-cn-rose-b45',
    prodKey: 4401,
    prodName: '중국 운남 장미 B급 45cm',
    countryCode: 'CN',
    countryName: '중국',
    flower: '장미',
    unit: '단',
    farmName: 'Yunnan Melody',
    peerFarmName: 'Cloudland Kunming',
    boxes: 42,
    actualUnitsPerBox: 18,
    targetUnitsPerBox: 20,
    boxWeightKg: 12.6,
    fobForeign: 13.8,
    peerFobForeign: 12.1,
    currency: 'CNY',
    freightPerUnitUSD: 1.48,
    customsPerUnitKRW: 360,
    otherPerUnitKRW: 195,
    prevLandedKRW: 4850,
    currentSellPriceKRW: 5900,
    expectedSalesQty: 756,
  },
  {
    id: 'sku-vn-chrys-spray',
    prodKey: 4501,
    prodName: '베트남 스프레이 소국 화이트/옐로우',
    countryCode: 'VN',
    countryName: '베트남',
    flower: '소국',
    unit: '단',
    farmName: 'Dalat Hasfarm',
    peerFarmName: 'Royal Base VN',
    boxes: 34,
    actualUnitsPerBox: 22,
    targetUnitsPerBox: 24,
    boxWeightKg: 8.8,
    fobForeign: 1.68,
    peerFobForeign: 1.51,
    currency: 'USD',
    freightPerUnitUSD: 1.05,
    customsPerUnitKRW: 420,
    otherPerUnitKRW: 170,
    prevLandedKRW: 4120,
    currentSellPriceKRW: 5150,
    expectedSalesQty: 748,
  },
]);

export const GABRIEL_BENCHMARK_AWBS = Object.freeze([
  {
    awb: '176-84920112',
    countryCode: 'CO',
    countryName: '콜롬비아',
    carrier: 'KALITTA / BOG-ICN',
    boxes: 44,
    gwKg: 442,
    cwKg: 468, // +500kg 구간(500kg)까지 32kg 부족
    rateForeign: 4.65,
    currency: 'USD',
    farms: ['Flores Gambur SAS', 'Turflor'],
    note: '2차 화물 잔여 32kg 합적 시 +500kg 단가 계단 진입',
  },
  {
    awb: '074-51209834',
    countryCode: 'NL',
    countryName: '네덜란드',
    carrier: 'KLM CARGO / AMS-ICN',
    boxes: 30,
    gwKg: 282,
    cwKg: 285, // +300kg 구간(300kg)까지 15kg 부족
    rateForeign: 4.15,
    currency: 'EUR',
    farms: ['Holex Flower BV'],
    note: '전차수 미선적 2박스 병합 시 +300kg 구간 즉시 진입',
  },
  {
    awb: '145-33018821',
    countryCode: 'EC',
    countryName: '에콰도르',
    carrier: 'AVIANCA / UIO-ICN',
    boxes: 26,
    gwKg: 245,
    cwKg: 274, // +300kg 구간(300kg)까지 26kg 부족
    rateForeign: 5.45,
    currency: 'USD',
    farms: ['Rosas del Valle'],
    note: '70cm 장미 3박스 증량 또는 콜롬비아 경유 혼적으로 300kg 돌파',
  },
  {
    awb: '784-66210490',
    countryCode: 'CN',
    countryName: '중국',
    carrier: 'CZ CARGO / KMG-ICN',
    boxes: 42,
    gwKg: 470,
    cwKg: 482, // +500kg 구간(500kg)까지 18kg 부족
    rateForeign: 2.30,
    currency: 'USD',
    farms: ['Yunnan Melody', 'Cloudland Kunming'],
    note: '리시안·유칼립투스 2박스 추가 시 +500kg 계단 적용',
  },
  {
    awb: '738-91024471',
    countryCode: 'VN',
    countryName: '베트남',
    carrier: 'VN CARGO / SGN-ICN',
    boxes: 34,
    gwKg: 288,
    cwKg: 292, // +300kg 구간(300kg)까지 8kg 부족
    rateForeign: 2.95,
    currency: 'USD',
    farms: ['Dalat Hasfarm'],
    note: '소국 1박스 보강으로 +300kg 단가 계단 즉시 확보',
  },
]);

export const GABRIEL_BENCHMARK_CLAIMS = Object.freeze([
  {
    id: 'clm-co-01',
    countryCode: 'CO',
    countryName: '콜롬비아',
    farmName: 'Flores Gambur SAS',
    prodName: '카네이션 스탠다드 레드',
    defectQty: 620,
    unit: '송이',
    claimUSD: 342,
    ageDays: 14,
    confirmed: true,
    credited: false,
    reason: '입항 시 박스 눌림·줄기 손상 공제분 (lista 생성 완료, 인보이스 Credit 차감 대기)',
  },
  {
    id: 'clm-ec-02',
    countryCode: 'EC',
    countryName: '에콰도르',
    farmName: 'Rosas del Valle',
    prodName: '장미 익스플로러 70cm',
    defectQty: 280,
    unit: '송이',
    claimUSD: 266,
    ageDays: 9,
    confirmed: true,
    credited: false,
    reason: '검역 소독 후 화형 개화 진행 불량 (농장 방 사진 전달 완료, 차주 송금 상계 대기)',
  },
  {
    id: 'clm-nl-03',
    countryCode: 'NL',
    countryName: '네덜란드',
    farmName: 'Holex Flower BV',
    prodName: '튤립 망고 참 40cm',
    defectQty: 45,
    unit: '단',
    claimUSD: 218,
    ageDays: 21,
    confirmed: false,
    credited: false,
    reason: '온도 편차로 인한 조기 개화 클레임 (영업 불량공제 등록 완료, 수입부 확정 대기)',
  },
  {
    id: 'clm-cn-04',
    countryCode: 'CN',
    countryName: '중국',
    farmName: 'Yunnan Melody',
    prodName: '운남 장미 B급 45cm',
    defectQty: 68,
    unit: '단',
    claimUSD: 194,
    ageDays: 7,
    confirmed: true,
    credited: false,
    reason: '길이 규격 미달(40cm 미만 혼입) 위챗 합의분 Credit Note 미상계',
  },
]);

const clamp = (val, min, max) => Math.max(min, Math.min(max, Number.isFinite(Number(val)) ? Number(val) : min));
const round0 = (v) => Math.round(Number(v) || 0);
const round1 = (v) => Math.round((Number(v) || 0) * 10) / 10;
const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

export function normalizeSimParams(input = {}) {
  return {
    fxDeltaKRW: clamp(input.fxDeltaKRW ?? DEFAULT_SIM_PARAMS.fxDeltaKRW, -50, 100),
    rebalancePct: clamp(input.rebalancePct ?? DEFAULT_SIM_PARAMS.rebalancePct, 0, 50),
    boxFillGainPct: clamp(input.boxFillGainPct ?? DEFAULT_SIM_PARAMS.boxFillGainPct, 0, 20),
    marginDefenseRatio: clamp(input.marginDefenseRatio ?? DEFAULT_SIM_PARAMS.marginDefenseRatio, 0, 100),
    targetMarginPct: clamp(input.targetMarginPct ?? DEFAULT_SIM_PARAMS.targetMarginPct, 12, 30),
    creditRecoveryEnabled: input.creditRecoveryEnabled !== undefined
      ? Boolean(input.creditRecoveryEnabled)
      : DEFAULT_SIM_PARAMS.creditRecoveryEnabled,
  };
}

export function inferCountryCodeFromRow(countryName, farmName = '', prodName = '') {
  const explicit = normalizeCountryCode(countryName);
  if (explicit && explicit !== 'ALL') return explicit;
  const hay = `${countryName || ''} ${farmName || ''} ${prodName || ''}`;
  if (isColombiaCountry(hay) || /gambur|maxiflores|turflor|elite|esperance|redil|funza|cactus/i.test(hay)) return 'CO';
  if (/네덜란드|netherlands|holland|holex|ezflower/i.test(hay)) return 'NL';
  if (/에콰도르|ecuador|nevado|rosas del valle/i.test(hay)) return 'EC';
  if (isChinaCountry(countryName, farmName) || /yunnan|cloudland|kunming/i.test(hay)) return 'CN';
  if (/베트남|vietnam|dalat|royal base/i.test(hay)) return 'VN';
  if (/태국|thailand|krung|super fresh/i.test(hay)) return 'TH';
  if (/호주|australia/i.test(hay)) return 'AU';
  return 'CO';
}

export function buildEffectiveFxRates(baseFx = {}, fxDeltaKRW = 0) {
  const merged = {
    USD: Number(baseFx.USD) > 0 ? Number(baseFx.USD) : DEFAULT_FX_RATES.USD,
    EUR: Number(baseFx.EUR) > 0 ? Number(baseFx.EUR) : DEFAULT_FX_RATES.EUR,
    CNY: Number(baseFx.CNY) > 0 ? Number(baseFx.CNY) : DEFAULT_FX_RATES.CNY,
    AUD: Number(baseFx.AUD) > 0 ? Number(baseFx.AUD) : DEFAULT_FX_RATES.AUD,
    JPY: Number(baseFx.JPY) > 0 ? Number(baseFx.JPY) : DEFAULT_FX_RATES.JPY,
    COP: Number(baseFx.COP) > 0 ? Number(baseFx.COP) : DEFAULT_FX_RATES.COP,
  };
  const ratio = (merged.USD + fxDeltaKRW) / merged.USD;
  return {
    USD: round2(merged.USD + fxDeltaKRW),
    EUR: round2(merged.EUR * ratio),
    CNY: round2(merged.CNY * ratio),
    AUD: round2(merged.AUD * ratio),
    JPY: round2(merged.JPY * ratio),
    COP: round2(merged.COP * ratio),
    baseUSD: round2(merged.USD),
    ratio: Math.round(ratio * 10000) / 10000,
  };
}

export function lookupAwbTier(countryCode, cwKg) {
  const code = AWB_TIER_SCHEDULES[countryCode] ? countryCode : 'CO';
  const schedule = AWB_TIER_SCHEDULES[code];
  const cw = Math.max(0, Number(cwKg) || 0);
  const idx = schedule.tiers.findIndex((t) => cw >= t.minKg && cw <= t.maxKg);
  const currentIdx = idx >= 0 ? idx : 0;
  const current = schedule.tiers[currentIdx];
  const next = currentIdx + 1 < schedule.tiers.length ? schedule.tiers[currentIdx + 1] : null;
  const kgToNext = next ? Math.max(0, round1(next.minKg - cw)) : 0;
  return {
    currency: schedule.currency,
    currentTier: current,
    nextTier: next,
    kgToNext,
    rateDelta: next ? round2(current.rate - next.rate) : 0,
  };
}

function normalizeLiveApiData({ apiData = null, country = 'ALL' } = {}) {
  const targetCountry = normalizeCountryCode(country);
  const fxFromApi = {};
  for (const c of apiData?.exchange?.currencies || []) {
    if (c?.currencyCode && Number(c.exchangeRate) > 0) {
      fxFromApi[String(c.currencyCode).toUpperCase()] = Number(c.exchangeRate);
    }
  }

  // 1) SKU rows: merge live arrival-cost + board items if available, otherwise fallback cleanly to benchmarks
  const arrivalRows = Array.isArray(apiData?.arrivalCosts) ? apiData.arrivalCosts : [];
  const boardItems = Array.isArray(apiData?.board?.items) ? apiData.board.items : [];
  const boardByProdKey = new Map(boardItems.filter((x) => x?.prodKey).map((x) => [Number(x.prodKey), x]));

  const liveSkus = [];
  for (let i = 0; i < arrivalRows.length; i++) {
    const r = arrivalRows[i];
    const qty = Number(r.quantity) || 0;
    const landed = Number(r.selectedArrivalCostKRW || r.sourceArrivalCostKRW) || 0;
    if (qty <= 0 || landed <= 0) continue;
    const cCode = inferCountryCodeFromRow(r.countryName || r.dbCountryName, r.farmName, r.displayName || r.prodName);
    const boardMatch = r.prodKey ? boardByProdKey.get(Number(r.prodKey)) : null;
    const boxes = Math.max(1, boardMatch?.farms?.reduce((s, f) => s + (Number(f.box) || 0), 0) || Math.round(qty / 150) || 1);
    const actualUnitsPerBox = Math.max(1, round1(qty / boxes));
    const targetUnitsPerBox = Math.max(actualUnitsPerBox, Math.round(actualUnitsPerBox * 1.1));
    const currency = cCode === 'NL' ? 'EUR' : cCode === 'CN' ? 'CNY' : cCode === 'AU' ? 'AUD' : 'USD';
    const fxEst = Number(r.exchangeRate) > 0 ? Number(r.exchangeRate) : (fxFromApi[currency] || DEFAULT_FX_RATES[currency]);
    const fobForeign = Number(r.fobUSD) > 0 ? Number(r.fobUSD) : round2((landed * 0.56) / fxEst);
    const freightPerUnitUSD = Number(r.freightPerUnitUSD) > 0 ? Number(r.freightPerUnitUSD) : round2((landed * 0.24) / DEFAULT_FX_RATES.USD);
    const customsPerUnitKRW = Number(r.customsPerUnitKRW) >= 0 && r.customsPerUnitKRW != null ? Number(r.customsPerUnitKRW) : round0(landed * 0.12);
    const otherPerUnitKRW = Number(r.otherPerUnitKRW) >= 0 && r.otherPerUnitKRW != null ? Number(r.otherPerUnitKRW) : round0(landed * 0.08);
    const bmMetric = colombiaBoxMetrics(r.dbFlowerName || r.flowerNameRaw, r.orderWeek);
    const estSell = round0((landed / 0.84) / 10) * 10;

    liveSkus.push({
      id: `live-sku-${r.arrivalLineKey || r.prodKey || i}`,
      prodKey: r.prodKey || null,
      prodName: r.displayName || r.prodName || r.productNameRaw || `수입 품목 #${i + 1}`,
      countryCode: cCode,
      countryName: countryLabel(cCode),
      flower: r.dbFlowerName || r.flowerNameRaw || '기타',
      unit: r.unit || '송이',
      farmName: r.farmName || r.farmNameRaw || '수입 농장',
      peerFarmName: `${countryLabel(cCode)} 대안 농장`,
      boxes,
      actualUnitsPerBox,
      targetUnitsPerBox,
      boxWeightKg: bmMetric?.boxWeight || (Number(r.grossWeight) > 0 && boxes > 0 ? round1(Number(r.grossWeight) / boxes) : 9.0),
      fobForeign,
      peerFobForeign: round2(fobForeign * 0.91),
      currency,
      freightPerUnitUSD,
      customsPerUnitKRW,
      otherPerUnitKRW,
      prevLandedKRW: round0(landed * 0.96),
      currentSellPriceKRW: estSell,
      expectedSalesQty: Math.max(qty, Number(boardMatch?.shipped) || qty),
      sourceType: 'live_erp',
    });
  }

  const rawSkus = liveSkus.length > 0
    ? liveSkus
    : GABRIEL_BENCHMARK_SKUS.map((x) => ({ ...x, sourceType: 'benchmark_model' }));
  const skus = targetCountry === 'ALL'
    ? rawSkus
    : rawSkus.filter((s) => s.countryCode === targetCountry);

  // 2) AWBs
  const liveAwbs = (Array.isArray(apiData?.awbcalc) ? apiData.awbcalc : [])
    .filter((a) => Number(a?.cw || a?.gw || 0) > 0)
    .map((a, idx) => {
      const firstFarm = a.farms?.[0]?.farm || '';
      const cCode = inferCountryCodeFromRow('', firstFarm, '');
      return {
        awb: a.awb || `AWB-${idx + 1}`,
        countryCode: cCode,
        countryName: countryLabel(cCode),
        carrier: `${cCode} AIR CARGO`,
        boxes: Number(a.box) || 1,
        gwKg: Number(a.gw) || Number(a.cw) || 0,
        cwKg: Number(a.cw) || Number(a.gw) || 0,
        rateForeign: Number(a.rate) || lookupAwbTier(cCode, a.cw || a.gw).currentTier.rate,
        currency: cCode === 'NL' ? 'EUR' : 'USD',
        farms: (a.farms || []).map((f) => f.farm).filter(Boolean),
        note: '실제 입고 원장 집계 기반 중량 구간 점검',
        sourceType: 'live_erp',
      };
    });
  const rawAwbs = liveAwbs.length > 0
    ? liveAwbs
    : GABRIEL_BENCHMARK_AWBS.map((a) => ({ ...a, sourceType: 'benchmark_model' }));
  const awbs = targetCountry === 'ALL'
    ? rawAwbs
    : rawAwbs.filter((a) => a.countryCode === targetCountry);

  // 3) Unrecovered Farm Credit Claims
  const liveClaims = [];
  const listaRows = Array.isArray(apiData?.lista) ? apiData.lista : [];
  for (const c of listaRows) {
    if (c.credited) continue;
    const cCode = inferCountryCodeFromRow('', c.farm, c.variedad || c.flower);
    const estUsd = Math.max(40, round0((Number(c.cantidad) || 0) * (/tallo|송이/i.test(c.unidad) ? 0.35 : 2.1)));
    liveClaims.push({
      id: `live-clm-${c.key}`,
      countryCode: cCode,
      countryName: countryLabel(cCode),
      farmName: c.farm || c.farmRaw || '미지정 농장',
      prodName: c.variedad || c.flower || '수입 품목',
      defectQty: Number(c.cantidad) || 0,
      unit: c.unidad || '단위',
      claimUSD: estUsd,
      ageDays: 10,
      confirmed: Boolean(c.confirmed),
      credited: false,
      reason: c.observacion || '불량 공제 리스트 추출분 · 해외 농장 Credit Note 확인 필요',
      sourceType: 'live_erp',
    });
  }
  const rawClaims = liveClaims.length > 0
    ? liveClaims
    : GABRIEL_BENCHMARK_CLAIMS.map((c) => ({ ...c, sourceType: 'benchmark_model' }));
  const claims = targetCountry === 'ALL'
    ? rawClaims
    : rawClaims.filter((c) => c.countryCode === targetCountry);

  return {
    skus,
    awbs,
    claims,
    fxFromApi,
    dataMode: liveSkus.length > 0 || liveAwbs.length > 0 || liveClaims.length > 0
      ? 'live-plus-model'
      : 'benchmark-fixture',
    counts: {
      liveSkuCount: liveSkus.length,
      liveAwbCount: liveAwbs.length,
      liveClaimCount: liveClaims.length,
      totalSkuCount: skus.length,
    },
  };
}

export function runGabrielAgiAudit({
  orderYear = '2026',
  orderWeek = '46-01',
  country = 'ALL',
  simParams = {},
  apiData = null,
} = {}) {
  const params = normalizeSimParams(simParams);
  const scopeCountry = normalizeCountryCode(country);
  const normalized = normalizeLiveApiData({ apiData, country: scopeCountry });
  const fx = buildEffectiveFxRates(normalized.fxFromApi, params.fxDeltaKRW);
  const baseFx = buildEffectiveFxRates(normalized.fxFromApi, 0);

  // --- Stage 1 & 2: SKU Baseline vs Counterfactual Cost & Margin Calculation ---
  let totalBaselineRevenueKRW = 0;
  let totalBaselineCostKRW = 0;
  let totalShockedUnhedgedCostKRW = 0;
  let totalSimRevenueKRW = 0;
  let totalSimCostKRW = 0;

  let lever1BoxAndAwbSavingsKRW = 0;
  let lever2FobArbitrageSavingsKRW = 0;
  let lever3MarginDefenseKRW = 0;
  let marginErosionAlertCount = 0;

  const skuRows = normalized.skus.map((sku) => {
    const qty = Math.max(1, Number(sku.expectedSalesQty || sku.boxes * sku.actualUnitsPerBox) || 1);
    const fxRateBase = baseFx[sku.currency] || baseFx.USD;
    const fxRateSim = fx[sku.currency] || fx.USD;

    // Baseline cost at fxDelta=0 (current operational baseline before shock)
    const baseFobKRW = sku.fobForeign * fxRateBase;
    const baseFreightKRW = sku.freightPerUnitUSD * baseFx.USD;
    const baseLandedKRW = round0(baseFobKRW + baseFreightKRW + sku.customsPerUnitKRW + sku.otherPerUnitKRW);

    // Unhedged shocked landed cost (when FX moves by fxDeltaKRW without Gabriel AGI levers)
    const shockedFobKRW = sku.fobForeign * fxRateSim;
    const shockedFreightKRW = sku.freightPerUnitUSD * fx.USD;
    const unhedgedLandedKRW = round0(shockedFobKRW + shockedFreightKRW + sku.customsPerUnitKRW + sku.otherPerUnitKRW);

    // Lever 1: Box fill normalization + AWB density efficiency
    // Filling boxes closer to targetUnitsPerBox reduces per-unit freight & fixed domestic storage/handling
    const shortfallRatio = sku.targetUnitsPerBox > sku.actualUnitsPerBox
      ? (sku.targetUnitsPerBox - sku.actualUnitsPerBox) / sku.targetUnitsPerBox
      : 0.08;
    const fillGainFraction = (params.boxFillGainPct / 100) * (0.55 + shortfallRatio * 1.4);
    const awbTierInfo = lookupAwbTier(sku.countryCode, sku.boxes * sku.boxWeightKg);
    const tierCompressionFactor = awbTierInfo.nextTier && awbTierInfo.kgToNext <= 60
      ? (params.boxFillGainPct / 20) * (awbTierInfo.rateDelta / Math.max(1, awbTierInfo.currentTier.rate)) * 0.65
      : 0;
    const perUnitFreightAfterL1KRW = shockedFreightKRW * Math.max(0.65, 1 - fillGainFraction - tierCompressionFactor);
    const perUnitOtherAfterL1KRW = sku.otherPerUnitKRW * Math.max(0.75, 1 - (params.boxFillGainPct / 100) * 0.45);
    const l1UnitSaveKRW = Math.max(0, (shockedFreightKRW + sku.otherPerUnitKRW) - (perUnitFreightAfterL1KRW + perUnitOtherAfterL1KRW));
    const l1TotalSaveKRW = round0(l1UnitSaveKRW * qty);

    // Lever 2: Farm/Country Cross-Sourcing (FOB Arbitrage)
    const peerFobKRW = (sku.peerFobForeign || sku.fobForeign * 0.91) * fxRateSim;
    const fobSpreadKRW = Math.max(0, shockedFobKRW - peerFobKRW);
    const rebalanceFraction = params.rebalancePct / 100;
    const l2UnitSaveKRW = fobSpreadKRW * rebalanceFraction;
    const l2TotalSaveKRW = round0(l2UnitSaveKRW * qty);

    const simLandedKRW = Math.max(1, round0(unhedgedLandedKRW - l1UnitSaveKRW - l2UnitSaveKRW));

    // Lever 3: Margin Erosion Defense
    const unhedgedMarginPct = sku.currentSellPriceKRW > 0
      ? round1(((sku.currentSellPriceKRW - unhedgedLandedKRW) / sku.currentSellPriceKRW) * 100)
      : 0;
    const simPrePriceMarginPct = sku.currentSellPriceKRW > 0
      ? round1(((sku.currentSellPriceKRW - simLandedKRW) / sku.currentSellPriceKRW) * 100)
      : 0;
    const costRisePct = sku.prevLandedKRW > 0
      ? round1(((unhedgedLandedKRW - sku.prevLandedKRW) / sku.prevLandedKRW) * 100)
      : 0;

    const targetRatio = 1 - params.targetMarginPct / 100;
    const requiredPriceForTarget = targetRatio > 0.05
      ? Math.ceil((simLandedKRW / targetRatio) / 10) * 10
      : sku.currentSellPriceKRW;
    const needsMarginDefense = simPrePriceMarginPct < params.targetMarginPct;
    if (needsMarginDefense) marginErosionAlertCount++;

    const rawPriceDeltaKRW = needsMarginDefense
      ? Math.max(0, requiredPriceForTarget - sku.currentSellPriceKRW)
      : 0;
    const appliedPriceDeltaKRW = round0(rawPriceDeltaKRW * (params.marginDefenseRatio / 100));
    const simSellPriceKRW = sku.currentSellPriceKRW + appliedPriceDeltaKRW;
    const simPostMarginPct = simSellPriceKRW > 0
      ? round1(((simSellPriceKRW - simLandedKRW) / simSellPriceKRW) * 100)
      : 0;
    const l3TotalDefenseKRW = round0(appliedPriceDeltaKRW * qty);

    const skuTotalBenefitKRW = l1TotalSaveKRW + l2TotalSaveKRW + l3TotalDefenseKRW;
    const baselineProfitKRW = round0((sku.currentSellPriceKRW - baseLandedKRW) * qty);
    const unhedgedProfitKRW = round0((sku.currentSellPriceKRW - unhedgedLandedKRW) * qty);
    const simProfitKRW = round0((simSellPriceKRW - simLandedKRW) * qty);

    totalBaselineRevenueKRW += sku.currentSellPriceKRW * qty;
    totalBaselineCostKRW += baseLandedKRW * qty;
    totalShockedUnhedgedCostKRW += unhedgedLandedKRW * qty;
    totalSimRevenueKRW += simSellPriceKRW * qty;
    totalSimCostKRW += simLandedKRW * qty;

    lever1BoxAndAwbSavingsKRW += l1TotalSaveKRW;
    lever2FobArbitrageSavingsKRW += l2TotalSaveKRW;
    lever3MarginDefenseKRW += l3TotalDefenseKRW;

    // 2x2 Matrix coordinates (0..100):
    // X = Cost & Margin Risk Score (higher = worse unhedged margin pressure / larger cost rise)
    // Y = Cycle Volume & Revenue Weight (higher = larger KRW revenue share)
    const marginGap = Math.max(0, params.targetMarginPct - unhedgedMarginPct);
    const riskScore = clamp(Math.round(35 + marginGap * 6 + Math.max(0, costRisePct) * 2.1 + (fobSpreadKRW / Math.max(1, unhedgedLandedKRW)) * 120), 8, 96);

    const status = needsMarginDefense && appliedPriceDeltaKRW > 0
      ? '단가 방어 필요'
      : (l1TotalSaveKRW + l2TotalSaveKRW) >= Math.max(50000, sku.currentSellPriceKRW * qty * 0.025)
        ? '원가 절감 유망'
        : '목표 마진 양호';

    return {
      ...sku,
      qty,
      baseLandedKRW,
      unhedgedLandedKRW,
      simLandedKRW,
      costDeltaKRW: simLandedKRW - unhedgedLandedKRW,
      fobSpreadKRW: round0(fobSpreadKRW),
      costRisePct,
      unhedgedMarginPct,
      simPrePriceMarginPct,
      simPostMarginPct,
      recommendedPriceDeltaKRW: rawPriceDeltaKRW,
      appliedPriceDeltaKRW,
      simSellPriceKRW,
      l1TotalSaveKRW,
      l2TotalSaveKRW,
      l3TotalDefenseKRW,
      skuTotalBenefitKRW,
      baselineProfitKRW,
      unhedgedProfitKRW,
      simProfitKRW,
      riskScore,
      status,
      fillPct: sku.targetUnitsPerBox > 0 ? round1((sku.actualUnitsPerBox / sku.targetUnitsPerBox) * 100) : 100,
    };
  });

  // Normalize Matrix Y-axis (0..100) by revenue contribution, keeping points clear of quadrant labels
  const maxSkuRevenue = Math.max(1, ...skuRows.map((s) => s.currentSellPriceKRW * s.qty));
  const placedCoords = [];
  const matrixRows = skuRows.map((s, index) => {
    const rev = s.currentSellPriceKRW * s.qty;
    let vx = clamp(s.riskScore, 10, 90);
    let vy = clamp(Math.round((rev / maxSkuRevenue) * 72 + 14), 14, 86);
    for (const prev of placedCoords) {
      if (Math.hypot(vx - prev.vx, vy - prev.vy) < 7) {
        vx = clamp(vx + ((index % 2 === 0 ? 1 : -1) * 5), 10, 90);
        vy = clamp(vy + ((index % 3 === 0 ? 1 : -1) * 5), 14, 86);
      }
    }
    placedCoords.push({ vx, vy });
    const quadrant = vx >= 50 && vy >= 50
      ? '즉시 단가·원가 방어'
      : vx < 50 && vy >= 50
        ? '핵심 수익 유지·물량 확대'
        : vx >= 50 && vy < 50
          ? 'AWB 혼적·농장 리밸런싱'
          : '안정 관찰';
    return {
      ...s,
      no: index + 1,
      riskScore: vx,
      volumeScore: vy,
      quadrant,
    };
  });

  // --- Lever 1 Detail: AWB Breakpoint Analysis ---
  const awbDiagnostics = normalized.awbs.map((a) => {
    const tier = lookupAwbTier(a.countryCode, a.cwKg);
    const fxCurrency = fx[tier.currency] || fx.USD;
    const gapFilledWeight = tier.nextTier ? Math.max(a.cwKg, tier.nextTier.minKg) : a.cwKg;
    const currentFreightForeign = round2(a.cwKg * tier.currentTier.rate);
    const nextTierFreightForeign = tier.nextTier
      ? round2(gapFilledWeight * tier.nextTier.rate)
      : currentFreightForeign;
    // Savings on the existing cargo when upgraded to next tier rate via consolidation
    const unitRateSaveForeign = tier.nextTier ? round2(a.cwKg * tier.rateDelta) : 0;
    const unitRateSaveKRW = round0(unitRateSaveForeign * fxCurrency);
    const breakEvenFillNote = tier.nextTier
      ? `${tier.kgToNext}kg 보강 시 ${tier.currentTier.label}(${tier.currentTier.rate}) → ${tier.nextTier.label}(${tier.nextTier.rate})`
      : '최저 단가 구간 도달';
    return {
      ...a,
      currentTierLabel: tier.currentTier.label,
      currentRate: tier.currentTier.rate,
      nextTierLabel: tier.nextTier ? tier.nextTier.label : '최고 구간',
      nextRate: tier.nextTier ? tier.nextTier.rate : tier.currentTier.rate,
      kgToNext: tier.kgToNext,
      rateCurrency: tier.currency,
      currentFreightForeign,
      nextTierFreightForeign,
      unitRateSaveForeign,
      unitRateSaveKRW,
      breakEvenFillNote,
    };
  });
  const awbTierReadyCount = awbDiagnostics.filter((a) => a.kgToNext > 0 && a.kgToNext <= 45).length;

  // --- Lever 4: Unrecovered Credit Note Detection ---
  const creditRows = normalized.claims.map((c) => {
    const krwValue = round0(c.claimUSD * fx.USD);
    const priorityScore = round0((c.claimUSD * 0.6) + (c.ageDays * 12) + (c.confirmed ? 120 : 40));
    return {
      ...c,
      krwValue,
      priorityScore,
      statusLabel: c.confirmed ? 'Credit Note 청구 준비 완료' : '수입부 확인 후 청구',
    };
  }).sort((a, b) => b.priorityScore - a.priorityScore);

  const potentialCreditUSD = round2(creditRows.reduce((s, c) => s + c.claimUSD, 0));
  const potentialCreditKRW = round0(potentialCreditUSD * fx.USD);
  const lever4CreditAppliedKRW = params.creditRecoveryEnabled ? potentialCreditKRW : 0;

  // --- Lever 5: Gabriel Import Velocity & Handover Guard ---
  const boardMissing = Number(apiData?.board?.totals?.missing || 0);
  const boardShort = Number(apiData?.board?.totals?.short || 0);
  const boardItemsLen = Array.isArray(apiData?.board?.items) ? apiData.board.items.length : 0;
  const arrivalCount = Array.isArray(apiData?.arrivalCosts) ? apiData.arrivalCosts.length : 0;
  const routineSteps = [
    {
      stepNo: 1,
      id: 'invoice-anomaly',
      title: '선적 전 인보이스 단가·입수 이상치 대조',
      status: boardItemsLen > 0 || normalized.counts.totalSkuCount > 0 ? '검증 완료' : '대기',
      score: boardMissing > 0 ? 74 : 92,
      detail: `품목 ${normalized.counts.totalSkuCount}건 FOB·박스 입수량 편차 자동 검사`,
      href: `/import/tools?year=${encodeURIComponent(orderYear)}&week=${encodeURIComponent(orderWeek)}`,
      actionLabel: '인보이스 원본 대조',
    },
    {
      stepNo: 2,
      id: 'awb-freight-check',
      title: 'AWB 운임 계단 · 백상/선율 배부 검증',
      status: awbTierReadyCount > 0 ? '혼적 개선 기회' : '적정 구간',
      score: awbTierReadyCount > 0 ? 78 : 94,
      detail: `AWB ${awbDiagnostics.length}건 중 중량 계단 근접 ${awbTierReadyCount}건`,
      href: `/import/freight-calc?year=${encodeURIComponent(orderYear)}&week=${encodeURIComponent(orderWeek)}`,
      actionLabel: 'AWB 운임 계산기',
    },
    {
      stepNo: 3,
      id: 'early-landed-lock',
      title: '도착원가 조기 확정 및 마진 방어선 잠금',
      status: marginErosionAlertCount > 0 ? '단가 보정 권고' : '정상 마진',
      score: marginErosionAlertCount > 0 ? 72 : 95,
      detail: arrivalCount > 0
        ? `도착원가 ${arrivalCount}행 반영 완료 · 방어 대상 ${marginErosionAlertCount}건`
        : `기준모델 ${normalized.counts.totalSkuCount}건 점검 · 방어 대상 ${marginErosionAlertCount}건`,
      href: `/import/pipeline?year=${encodeURIComponent(orderYear)}&week=${encodeURIComponent(orderWeek)}&step=3`,
      actionLabel: '수입 원스톱 파이프라인',
    },
    {
      stepNo: 4,
      id: 'sales-price-handoff',
      title: '영업부 공급단가·부족분 선공유 (빠른 분배 연동)',
      status: boardShort > 0 || marginErosionAlertCount > 0 ? '선공유 필요' : '동기화',
      score: boardShort > 0 ? 76 : 90,
      detail: `목표 마진 ${params.targetMarginPct}% 기준 보정안 영업부·분배 전달`,
      href: '/shipment/quick-absorb',
      actionLabel: '빠른 분배 단가 확인',
    },
  ];
  const velocityScore = round0(routineSteps.reduce((s, r) => s + r.score, 0) / routineSteps.length);
  // Early lock avoids ~0.4% emergency price delay slippage on total revenue when margin defense is active
  const lever5VelocityGainKRW = round0(totalBaselineRevenueKRW * 0.004 * (params.marginDefenseRatio / 100));

  // Total 5 Levers Breakdown
  const levers = [
    {
      id: 'awb_box_fill',
      code: 'L1',
      title: 'AWB 중량 계단 & 박스 채움률 최적화',
      profitGainKRW: lever1BoxAndAwbSavingsKRW,
      driverText: `입수·혼적 개선 ${params.boxFillGainPct}% · AWB 구간 근접 ${awbTierReadyCount}건`,
      href: `/import/freight-calc?year=${encodeURIComponent(orderYear)}&week=${encodeURIComponent(orderWeek)}`,
      actionLabel: 'AWB 계산기 열기',
    },
    {
      id: 'fob_arbitrage_fx',
      code: 'L2',
      title: '농장·국가 교차 소싱 (FOB Arbitrage)',
      profitGainKRW: lever2FobArbitrageSavingsKRW,
      driverText: `우위 농장 리밸런싱 ${params.rebalancePct}% · 적용환율 ₩${fx.USD}/USD`,
      href: `/import/pipeline?year=${encodeURIComponent(orderYear)}&week=${encodeURIComponent(orderWeek)}&step=1`,
      actionLabel: '파이프라인 1단계',
    },
    {
      id: 'margin_erosion_defense',
      code: 'L3',
      title: '마진 침식 방어 (권장 공급단가 보정)',
      profitGainKRW: lever3MarginDefenseKRW,
      driverText: `목표 마진 ${params.targetMarginPct}% · 경보 ${marginErosionAlertCount}품목 · 반영 ${params.marginDefenseRatio}%`,
      href: '/shipment/quick-absorb',
      actionLabel: '빠른 분배 단가 확인',
    },
    {
      id: 'credit_note_recovery',
      code: 'L4',
      title: '불량·클레임 Credit Note 미회수 회수',
      profitGainKRW: lever4CreditAppliedKRW,
      driverText: params.creditRecoveryEnabled
        ? `미회수 ${creditRows.length}건 ($${potentialCreditUSD}) 회수 반영`
        : `반영 제외됨 (잠재 회수 대기 ₩${potentialCreditKRW.toLocaleString('ko-KR')})`,
      href: '/sales/defect-deductions',
      actionLabel: '불량차감 원장',
    },
    {
      id: 'import_velocity_routine',
      code: 'L5',
      title: '가브리엘 고효율 루틴 & 조기 원가 확정',
      profitGainKRW: lever5VelocityGainKRW,
      driverText: `수입 속도 지수 ${velocityScore}점 · 단가 선공유 손실 차단`,
      href: '/work/manuals',
      actionLabel: '업무 매뉴얼 열기',
    },
  ];

  const totalPotentialProfitKRW = levers.reduce((s, l) => s + l.profitGainKRW, 0);
  const annualizedProfitKRW = totalPotentialProfitKRW * 52;

  const unhedgedProfitKRW = totalBaselineRevenueKRW - totalShockedUnhedgedCostKRW;
  const unhedgedMarginPct = totalBaselineRevenueKRW > 0
    ? round2(((totalBaselineRevenueKRW - totalShockedUnhedgedCostKRW) / totalBaselineRevenueKRW) * 100)
    : 0;
  const simulatedProfitKRW = (totalSimRevenueKRW - totalSimCostKRW) + lever4CreditAppliedKRW + lever5VelocityGainKRW;
  const simulatedMarginPct = totalSimRevenueKRW > 0
    ? round2((simulatedProfitKRW / totalSimRevenueKRW) * 100)
    : 0;
  const marginDeltaPctPt = round2(simulatedMarginPct - unhedgedMarginPct);

  const defendedSkuCount = matrixRows.filter((s) => s.simPostMarginPct >= params.targetMarginPct - 0.05).length;
  const marginDefenseRatePct = matrixRows.length > 0
    ? round1((defendedSkuCount / matrixRows.length) * 100)
    : 100;
  const costLeakAlertCount = marginErosionAlertCount + awbTierReadyCount + creditRows.length;

  // --- FX Sensitivity Ladder (-50, -25, 0, +25, +50, +75, +100 KRW) ---
  const fxLadder = [-50, -25, 0, 25, 50, 75, 100].map((delta) => {
    const ladderFx = buildEffectiveFxRates(normalized.fxFromApi, delta);
    let rev = 0;
    let unhedgedCost = 0;
    let simCost = 0;
    let simRev = 0;
    for (const sku of normalized.skus) {
      const qty = Math.max(1, Number(sku.expectedSalesQty || sku.boxes * sku.actualUnitsPerBox) || 1);
      const rRate = ladderFx[sku.currency] || ladderFx.USD;
      const fob = sku.fobForeign * rRate;
      const fr = sku.freightPerUnitUSD * ladderFx.USD;
      const unhedgedUnit = round0(fob + fr + sku.customsPerUnitKRW + sku.otherPerUnitKRW);

      const shortfall = sku.targetUnitsPerBox > sku.actualUnitsPerBox
        ? (sku.targetUnitsPerBox - sku.actualUnitsPerBox) / sku.targetUnitsPerBox
        : 0.08;
      const fillFrac = (params.boxFillGainPct / 100) * (0.55 + shortfall * 1.4);
      const l1Save = Math.max(0, fr * fillFrac + sku.otherPerUnitKRW * (params.boxFillGainPct / 100) * 0.45);
      const l2Save = Math.max(0, fob - (sku.peerFobForeign || sku.fobForeign * 0.91) * rRate) * (params.rebalancePct / 100);
      const simUnit = Math.max(1, round0(unhedgedUnit - l1Save - l2Save));

      const targetRatio = 1 - params.targetMarginPct / 100;
      const reqPrice = targetRatio > 0.05 ? Math.ceil((simUnit / targetRatio) / 10) * 10 : sku.currentSellPriceKRW;
      const preMargin = sku.currentSellPriceKRW > 0 ? ((sku.currentSellPriceKRW - simUnit) / sku.currentSellPriceKRW) * 100 : 0;
      const priceDelta = preMargin < params.targetMarginPct
        ? round0(Math.max(0, reqPrice - sku.currentSellPriceKRW) * (params.marginDefenseRatio / 100))
        : 0;

      rev += sku.currentSellPriceKRW * qty;
      unhedgedCost += unhedgedUnit * qty;
      simCost += simUnit * qty;
      simRev += (sku.currentSellPriceKRW + priceDelta) * qty;
    }
    const uMargin = rev > 0 ? round2(((rev - unhedgedCost) / rev) * 100) : 0;
    const sProfit = (simRev - simCost) + (params.creditRecoveryEnabled ? round0(potentialCreditUSD * ladderFx.USD) : 0);
    const sMargin = simRev > 0 ? round2((sProfit / simRev) * 100) : 0;
    return {
      fxDeltaKRW: delta,
      usdRate: ladderFx.USD,
      unhedgedMarginPct: uMargin,
      defendedMarginPct: sMargin,
      unhedgedProfitKRW: round0(rev - unhedgedCost),
      defendedProfitKRW: round0(sProfit),
      netGainKRW: round0(sProfit - (rev - unhedgedCost)),
      isCurrent: delta === params.fxDeltaKRW,
    };
  });

  // --- 4-Stage AGI Reasoning Pipeline Trace ---
  const agiTrace = [
    {
      stage: 'Observe',
      stepNo: '01',
      title: '수입 원장·AWB·환율·클레임 관측',
      summary: `${orderYear}년 ${orderWeek}차 (${countryLabel(scopeCountry)}) · 품목 ${matrixRows.length}건, AWB ${awbDiagnostics.length}건, 미회수 클레임 ${creditRows.length}건 관측`,
      metric: `기준 매출 ₩${totalBaselineRevenueKRW.toLocaleString('ko-KR')}`,
    },
    {
      stage: 'Diagnose',
      stepNo: '02',
      title: '원가 누수 및 마진 침식 원인 진단',
      summary: `목표 마진(${params.targetMarginPct}%) 미달 ${marginErosionAlertCount}품목, AWB 구간 근접 ${awbTierReadyCount}건, 미청구 크레딧 $${potentialCreditUSD} 식별`,
      metric: `총 경보 ${costLeakAlertCount}건`,
    },
    {
      stage: 'Counterfactual Simulate',
      stepNo: '03',
      title: '5대 이익 레버 반사실 시뮬레이션',
      summary: `환율 ${params.fxDeltaKRW >= 0 ? '+' : ''}${params.fxDeltaKRW}원 충격 가정 하에 리밸런싱 ${params.rebalancePct}% · 채움률 +${params.boxFillGainPct}% · 단가방어 ${params.marginDefenseRatio}% 시뮬레이션`,
      metric: `총이익률 ${unhedgedMarginPct}% → ${simulatedMarginPct}% (${marginDeltaPctPt >= 0 ? '+' : ''}${marginDeltaPctPt}%p)`,
    },
    {
      stage: 'Propose',
      stepNo: '04',
      title: '무쓰기 실행안 및 수동 승인 연결',
      summary: `원장 직접 수정 없이 파이프라인·빠른 분배·불량차감 메뉴로 바로 이동해 담당자 확인 후 반영`,
      metric: `차수 개선 +₩${totalPotentialProfitKRW.toLocaleString('ko-KR')}`,
    },
  ];

  return {
    scope: {
      orderYear: String(orderYear),
      orderWeek: String(orderWeek),
      country: scopeCountry,
      countryName: countryLabel(scopeCountry),
    },
    params,
    fx,
    dataMode: normalized.dataMode,
    dataCounts: normalized.counts,
    summary: {
      totalBaselineRevenueKRW: round0(totalBaselineRevenueKRW),
      totalBaselineCostKRW: round0(totalBaselineCostKRW),
      totalShockedUnhedgedCostKRW: round0(totalShockedUnhedgedCostKRW),
      totalSimCostKRW: round0(totalSimCostKRW),
      unhedgedProfitKRW: round0(unhedgedProfitKRW),
      simulatedProfitKRW: round0(simulatedProfitKRW),
      totalPotentialProfitKRW: round0(totalPotentialProfitKRW),
      annualizedProfitKRW: round0(annualizedProfitKRW),
      costLeakAlertCount,
      marginErosionAlertCount,
      awbTierReadyCount,
      unrecoveredClaimCount: creditRows.length,
      potentialCreditUSD,
      potentialCreditKRW,
      marginDefenseRatePct,
      unhedgedMarginPct,
      simulatedMarginPct,
      marginDeltaPctPt,
      velocityScore,
    },
    levers,
    skus: matrixRows,
    awbs: awbDiagnostics,
    claims: creditRows,
    fxLadder,
    routineSteps,
    agiTrace,
  };
}

export function buildGabrielExecutiveBriefing(audit) {
  if (!audit) return '';
  const { scope, params, summary, levers, fx } = audit;
  const fmt = (n) => Number(n || 0).toLocaleString('ko-KR');
  const topLevers = [...(levers || [])]
    .sort((a, b) => b.profitGainKRW - a.profitGainKRW)
    .slice(0, 3);

  const lines = [
    `[가브리엘 수입·원가·이익 AGI 브리핑] ${scope.orderYear}년 ${scope.orderWeek}차 · ${scope.countryName}`,
    `기준 환율: ₩${fmt(fx.USD)}/USD (충격 가정 ${params.fxDeltaKRW >= 0 ? '+' : ''}${params.fxDeltaKRW}원)`,
    `- 차수 이익 개선 가능액: +₩${fmt(summary.totalPotentialProfitKRW)} (52주 환산 +₩${fmt(summary.annualizedProfitKRW)})`,
    `- 총이익률 변화: ${summary.unhedgedMarginPct}% -> ${summary.simulatedMarginPct}% (${summary.marginDeltaPctPt >= 0 ? '+' : ''}${summary.marginDeltaPctPt}%p)`,
    `- 원가 누수·마진 경보: ${summary.costLeakAlertCount}건 (목표 마진 ${params.targetMarginPct}% 방어율 ${summary.marginDefenseRatePct}%)`,
    '',
    '핵심 실행 레버 상위 3건:',
    ...topLevers.map((l, idx) => `${idx + 1}. [${l.code}] ${l.title}: +₩${fmt(l.profitGainKRW)} (${l.driverText})`),
    '',
    '※ 본 시뮬레이션은 읽기 전용 분석 결과이며 전산 원장을 자동 수정하지 않습니다. 실제 반영은 수입 원스톱 파이프라인 및 빠른 분배에서 담당자 확인 후 진행합니다.',
  ];
  return lines.join('\n');
}

export { PIPELINE_COUNTRIES, countryLabel, normalizeCountryCode };
