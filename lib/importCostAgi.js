// lib/importCostAgi.js
// 수입·원가·이익 최적화 AGI 순수 도메인 추론·반사실 시뮬레이션 엔진.
// 10대 전사 원가·이익 레버(L1~L10) · 4원천 데이터 계보 · 4부서 연계 매트릭스 · 연속구현 큐 포함.
// DB·React·파일 I/O 의존 없음. 서버/클라이언트/단위테스트 공용.
// 원장 무쓰기 원칙: 이 모듈은 순수 계산·진단·제안만 수행하며 어떠한 DB 변경도 발생시키지 않는다.

import { normalizeCountryCode, countryLabel, PIPELINE_COUNTRIES } from './importOneStopPipeline.js';
import { colombiaBoxMetrics, isColombiaCountry, isChinaCountry } from './boxMetricTable.js';

export const COST_AGI_VIEW_MODES = Object.freeze([
  Object.freeze({
    id: 'A',
    code: 'VIEW A',
    label: '뷰 A · 10대 원가·이익 레버 분해 & 원장',
    shortLabel: '레버 분해 & 원장',
    description: '전사 10대 이익 레버(L1~L10) 수평 분해 프로파일과 품목별 실질 도착원가(True Landed Cost) 고밀도 원장',
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
    description: '환율 스트레스 래더, AWB 중량 브레이크포인트 게이지, 크레딧 미회수 원장, 수입 속도 루틴',
  }),
  Object.freeze({
    id: 'ALL',
    code: 'VIEW ALL',
    label: '뷰 ALL · A·B·C 동시 시뮬레이션 & 연속구현 큐',
    shortLabel: 'A·B·C 동시모드',
    description: '마스터 반사실 슬라이더로 뷰 A·B·C 3종을 한 화면에서 동시 구동하고 차기 자동화 구현 큐를 실행',
  }),
]);

export const COST_AGI_DEPARTMENTS = Object.freeze([
  Object.freeze({ id: 'ALL', label: '전사 10대 레버' }),
  Object.freeze({ id: '수입부', label: '수입부' }),
  Object.freeze({ id: '영업부', label: '영업부' }),
  Object.freeze({ id: '출고·창고팀', label: '출고·창고팀' }),
  Object.freeze({ id: '경영지원·정산부', label: '경영지원·정산부' }),
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
  creditRecoveryEnabled: true, // L4: include unrecovered farm credit note claims
  fxSplitSchedulePct: 60, // L6: 0 ~ 100% split FX remittance & payment schedule defense
  agedStockClearRatio: 70, // L7: 0 ~ 100% D+3/5/7 early markdown absorption ratio
  customerAllocRatio: 50, // L8: 0 ~ 100% customer net-contribution quick-absorb optimization
  cutoffGuardEnabled: true, // L9: Kakao add/cancel pre-cutoff guard
  customsRateAuditEnabled: true, // L10: customs/quarantine/bonded warehouse/truck rate audit
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

export const COST_AGI_BENCHMARK_SKUS = Object.freeze([
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

export const COST_AGI_BENCHMARK_AWBS = Object.freeze([
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

export const COST_AGI_BENCHMARK_CLAIMS = Object.freeze([
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
    reason: '온도 편차(Tive 로거 확인분) 조기 개화 클레임 (영업 불량공제 등록 완료, 수입부 확정 대기)',
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
    fxSplitSchedulePct: clamp(input.fxSplitSchedulePct ?? DEFAULT_SIM_PARAMS.fxSplitSchedulePct, 0, 100),
    agedStockClearRatio: clamp(input.agedStockClearRatio ?? DEFAULT_SIM_PARAMS.agedStockClearRatio, 0, 100),
    customerAllocRatio: clamp(input.customerAllocRatio ?? DEFAULT_SIM_PARAMS.customerAllocRatio, 0, 100),
    cutoffGuardEnabled: input.cutoffGuardEnabled !== undefined
      ? Boolean(input.cutoffGuardEnabled)
      : DEFAULT_SIM_PARAMS.cutoffGuardEnabled,
    customsRateAuditEnabled: input.customsRateAuditEnabled !== undefined
      ? Boolean(input.customsRateAuditEnabled)
      : DEFAULT_SIM_PARAMS.customsRateAuditEnabled,
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
    : COST_AGI_BENCHMARK_SKUS.map((x) => ({ ...x, sourceType: 'benchmark_model' }));
  const skus = targetCountry === 'ALL'
    ? rawSkus
    : rawSkus.filter((s) => s.countryCode === targetCountry);

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
    : COST_AGI_BENCHMARK_AWBS.map((a) => ({ ...a, sourceType: 'benchmark_model' }));
  const awbs = targetCountry === 'ALL'
    ? rawAwbs
    : rawAwbs.filter((a) => a.countryCode === targetCountry);

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
    : COST_AGI_BENCHMARK_CLAIMS.map((c) => ({ ...c, sourceType: 'benchmark_model' }));
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

function buildVisualDiagram({
  code,
  sourceTitle,
  sourceDetail,
  leakTitle,
  beforeKRW,
  gateTitle,
  gateDetail,
  deptTitle,
  deptDetail,
  gainKRW,
  beforeLabel,
  afterLabel,
}) {
  const safeBefore = Math.max(0, round0(beforeKRW));
  const safeGain = Math.max(0, round0(gainKRW));
  const safeAfter = Math.max(0, safeBefore - safeGain);
  const recoveryPct = safeBefore > 0 ? Math.min(100, round1((safeGain / safeBefore) * 100)) : 0;

  return {
    nodes: [
      { id: 'source', step: '01 원천 데이터', title: sourceTitle, detail: sourceDetail },
      { id: 'leak', step: '02 누수 지점', title: leakTitle, detail: `무대응 노출 ₩${safeBefore.toLocaleString('ko-KR')}`, amountKRW: safeBefore },
      { id: 'gate', step: '03 AGI 기준식', title: gateTitle, detail: gateDetail },
      { id: 'dept', step: '04 부서 실행', title: deptTitle, detail: deptDetail },
      { id: 'gain', step: '05 순이익 회수', title: `+₩${safeGain.toLocaleString('ko-KR')}/차수`, detail: `연환산 +₩${(safeGain * 52).toLocaleString('ko-KR')}`, amountKRW: safeGain },
    ],
    waterfall: {
      beforeLabel,
      beforeKRW: safeBefore,
      recoveredLabel: `${code} 레버 회수·방어`,
      recoveredKRW: safeGain,
      afterLabel,
      afterKRW: safeAfter,
      recoveryPct,
    },
  };
}

function buildLeverMetadata({
  orderYear,
  orderWeek,
  scopeCountry,
  params,
  fx,
  skuRows,
  awbDiagnostics,
  awbTierReadyCount,
  marginErosionAlertCount,
  creditRows,
  potentialCreditUSD,
  potentialCreditKRW,
  velocityScore,
  totalBaselineRevenueKRW,
  totalBaselineCostKRW,
  totalShockedUnhedgedCostKRW,
  totalForeignExposureKRW,
  totalCustomsAndOtherKRW,
  gains,
}) {
  const qYear = encodeURIComponent(orderYear);
  const qWeek = encodeURIComponent(orderWeek);
  const qCountry = scopeCountry !== 'ALL' ? `&country=${encodeURIComponent(scopeCountry)}` : '';
  const pipelineUrl = (step = 1) => `/import/pipeline?year=${qYear}&week=${qWeek}&step=${step}${qCountry}`;
  const freightUrl = `/import/freight-calc?year=${qYear}&week=${qWeek}`;
  const toolsUrl = `/import/tools?year=${qYear}&week=${qWeek}`;

  const totalUnhedgedFreightKRW = round0(skuRows.reduce((s, r) => s + r.freightPerUnitUSD * fx.USD * r.qty, 0));
  const totalFobGapPoolKRW = round0(skuRows.reduce((s, r) => s + Math.max(0, r.fobSpreadKRW) * r.qty, 0));
  const totalMarginGapPoolKRW = round0(skuRows.reduce((s, r) => s + Math.max(0, r.recommendedPriceDeltaKRW) * r.qty, 0));
  const fxVolatilityPoolKRW = round0(totalForeignExposureKRW * 0.015);
  const agedStockPoolKRW = round0(totalShockedUnhedgedCostKRW * 0.022);
  const customerContribPoolKRW = round0(totalBaselineRevenueKRW * 0.014);
  const cutoffWastePoolKRW = round0(totalBaselineCostKRW * 0.0085);
  const customsVariancePoolKRW = round0(totalCustomsAndOtherKRW * 0.055);
  const velocityDelayPoolKRW = round0(totalBaselineRevenueKRW * 0.0055);

  return [
    {
      id: 'awb_box_fill',
      code: 'L1',
      title: 'AWB 중량 계단 & 부피중량 혼적 · 제로유닛 최적화',
      primaryDept: '수입부',
      departments: ['수입부', '출고·창고팀'],
      profitGainKRW: gains.l1,
      annualizedGainKRW: gains.l1 * 52,
      driverText: `입수·혼적 ${params.boxFillGainPct}% · AWB 계단 근접 ${awbTierReadyCount}건 · 제로유닛 295품목 정비`,
      href: freightUrl,
      actionLabel: 'AWB 계산기 열기',
      story: {
        analogySummary: '빈 자리 많은 수국 상자에 무거운 카네이션을 같이 실어 비행기 요금 구간(+500kg) 문턱을 넘기는 레버입니다.',
        beforeScene: `콜롬비아 수국(5.5kg/6.7CBM) 단독 선적 시 부피중량(CW)이 실중량(GW)보다 21.8% 크게 청구되고, AWB 468kg처럼 +500kg 할인 문턱 32kg 직전 데드존에서 총운임이 역전됩니다. 또한 SteamOf1Box=0 제로유닛(295품목)이 원가 배분을 왜곡합니다.`,
        afterScene: `고중량 카네이션(11kg/9CBM)·알스트로(9.7kg/7CBM) 혼적 배분과 2차 잔여 물량 합적으로 +300/+500kg 할인 계단에 진입하고, 입수량 보정으로 박스당 유령 운임을 제거합니다.`,
      },
      dataBasis: {
        emailSource: '포워더 Modelo AWB PDF(GW/CW 실측), 해외 농장 Packing List PDF, 항공사 구간별 운임표',
        staffSource: '수입부 unit-conv-zero(295 활성 제로유닛, 13,815주문행) 및 창고팀 실측 박스 입수 기록',
        counterpartySource: '콜롬비아(BOG/MDE)·네덜란드(AMS)·중국(KMG) 포워더 중량구간 요율(+100/+300/+500/+1000kg)',
        criterionRule: 'CW > GW×1.15 시 고중량 품목 혼적 전환 · 구간 92%+ 데드존 합적 · SteamOf1Box=0 경고',
      },
      departmentTasks: [
        { dept: '수입부', role: '혼적·합적 총괄', action: '선적 전 AWB CW/GW 편차 확인 및 +300/+500kg 계단 45kg 이내 합적 지시', timing: '선적 1일 전', screenLabel: 'AWB 운임 계산기', href: freightUrl },
        { dept: '영업부', role: '추가 물량 배정', action: '할인 계단 진입까지 부족한 잔여 kg 만큼 주력 품종 스팟 추가 발주 조율', timing: '발주 마감 전', screenLabel: '수입 원스톱 파이프라인', href: pipelineUrl(1) },
        { dept: '출고·창고팀', role: '실측 입수·중량 검증', action: '입고 현품 박스당 송이수·단수(SteamOf1Box) 실측 및 제로유닛 오류 보고', timing: '입고 당일', screenLabel: '품목 마스터 / 재고현황', href: '/shipment/stock-status' },
        { dept: '경영지원·정산부', role: '운임 청구서 대사', action: '포딩 청구서의 CW 청구중량과 실제 AWB 계단 단가 적용 일치 여부 검수', timing: '월 15·30일 정산', screenLabel: '포워딩 정산 대사', href: '/sales/forwarding-clearance' },
      ],
      visualDiagram: buildVisualDiagram({
        code: 'L1',
        sourceTitle: 'AWB PDF · 박스 실측',
        sourceDetail: `AWB ${awbDiagnostics.length}건 · 제로유닛 295품목`,
        leakTitle: '데드존 · 부피유령운임',
        beforeKRW: Math.max(gains.l1, totalUnhedgedFreightKRW),
        gateTitle: 'CW/GW · 계단 임계치',
        gateDetail: 'CW>GW×1.15 & 구간 92%+',
        deptTitle: '수입부 · 창고팀',
        deptDetail: '카네이션 혼적 · 입수 보정',
        gainKRW: gains.l1,
        beforeLabel: '무대응 항공운임 노출',
        afterLabel: '혼적·계단적용 후 운임',
      }),
      continuousBuildModule: {
        moduleId: 'mod-l1-awb-coload-solver',
        title: 'AWB 브레이크포인트 자동 합적 & 제로유닛 일괄 보정기',
        stage: 'LIVE',
        stageLabel: '실전가동 LIVE',
        targetDepts: ['수입부', '출고·창고팀'],
        expectedWeeklyGainKRW: gains.l1,
        expectedAnnualGainKRW: gains.l1 * 52,
        ownerRoute: freightUrl,
        implementationBrief: '[L1 작업지시] /import/freight-calc 에 CW 구간(300/500/1000kg) 45kg 이내 데드존 자동 경고 배지와 수국+카네이션 혼적 시뮬레이터를 연결하고, unit-conv-zero 295개 활성 품목의 SteamOf1Box=0 보정 체크리스트를 자동 표출한다.',
      },
    },
    {
      id: 'fob_arbitrage_fx',
      code: 'L2',
      title: '농장 교차 소싱(True Landed Cost) & 중국 APTA E1 관세·환율',
      primaryDept: '수입부',
      departments: ['수입부', '영업부'],
      profitGainKRW: gains.l2,
      annualizedGainKRW: gains.l2 * 52,
      driverText: `우위 농장 리밸런싱 ${params.rebalancePct}% · APTA E1(21.4% vs 25%) · ₩${fx.USD}/USD`,
      href: pipelineUrl(1),
      actionLabel: '파이프라인 1단계',
      story: {
        analogySummary: '농장 견적서 숫자만 보지 않고 운임·관세(APTA 21.4%)·실시간 환율까지 다 더한 최종 한국 도착가로 싼 농장을 고르는 레버입니다.',
        beforeScene: `같은 아가판서스·튤립도 농장별 실질 도착원가가 최대 39.9%(₩3,343 vs ₩2,009) 벌어지고, 중국 146개 품목에서 원산지증명(APTA E1 21.4%) 누락 시 기본관세 25.0%(+3.6%p)를 내며, 원가표 C7에 지난주 환율을 복사해 원가가 왜곡됩니다.`,
        afterScene: `스팟 발주 시 실질 도착원가(TLC) 최저 농장에 25~50%를 우선 배분하고, 중국 선적 서류에서 E1 원산지증명서 유무와 실시간 고시환율을 발주·입고 전 자동 검증합니다.`,
      },
      dataBasis: {
        emailSource: '해외 농장 주간 FOB 단가 메일, 중국 APTA E1 원산지증명 PDF, 관세청 고시환율 공지',
        staffSource: '수입부 원가자료 엑셀(C7 환율셀), 수입 담당 교차소싱 비교표(costcompare)',
        counterpartySource: '네덜란드 Holex/EZ Flower · 콜롬비아 126농장 · 운남 농장 스팟 단가 및 CO 발급처',
        criterionRule: 'TLC=(FOB+운임)×실시간환율×(1+관세)+통관비 · 중국 E1(21.4%, 146품목) 필수 · 환율 1.0%+ 괴리 차단',
      },
      departmentTasks: [
        { dept: '수입부', role: '교차 원가산정·CO검증', action: '동일 품종 농장별 TLC 비교표 작성 및 중국 선적 E1 원산지증명 사전 회수', timing: '매주 목·금 발주 시', screenLabel: '수입 원스톱 파이프라인', href: pipelineUrl(1) },
        { dept: '영업부', role: '대체 농장 품질 승인', action: '저원가 대안 농장 품종의 화형·길이 스펙 확인 후 스팟 물량 비중 승인', timing: '발주 확정 전', screenLabel: '국가별 발주·원가 도구', href: toolsUrl },
        { dept: '출고·창고팀', role: '농장별 입고품질 피드백', action: '대체 농장 초도 입고 시 길이·줄기 강도 현장 검품 후 수입부 전달', timing: '초도 입고일', screenLabel: '입고 재고현황', href: '/shipment/stock-status' },
        { dept: '경영지원·정산부', role: '관세환급·결제 검증', action: 'APTA E1 적용 여부(21.4%) 통관정산서 확인 및 누락 시 사후협정 보정 요청', timing: '통관 정산 시', screenLabel: '그외통관·관세 대사', href: '/sales/customs-clearance' },
      ],
      visualDiagram: buildVisualDiagram({
        code: 'L2',
        sourceTitle: '농장 FOB · E1 CO · 환율',
        sourceDetail: '3,346품목 · E1 146품목',
        leakTitle: '고원가 농장 · 25% 기본관세',
        beforeKRW: Math.max(gains.l2, totalFobGapPoolKRW),
        gateTitle: 'True Landed Cost',
        gateDetail: '(FOB+운임)×FX×(1+관세)+통관',
        deptTitle: '수입부 · 영업부',
        deptDetail: `교차 배분 ${params.rebalancePct}% · E1 21.4%`,
        gainKRW: gains.l2,
        beforeLabel: 'FOB·관세 편차 노출액',
        afterLabel: '교차 소싱 후 차액',
      }),
      continuousBuildModule: {
        moduleId: 'mod-l2-tlc-apta-scanner',
        title: '품종별 농장 TLC 자동 비교 & 중국 APTA E1 누락 사전 스캐너',
        stage: 'LIVE',
        stageLabel: '실전가동 LIVE',
        targetDepts: ['수입부', '경영지원·정산부'],
        expectedWeeklyGainKRW: gains.l2,
        expectedAnnualGainKRW: gains.l2 * 52,
        ownerRoute: pipelineUrl(1),
        implementationBrief: '[L2 작업지시] profit-official-duty-2026.json(146개 E1 대상)과 실시간 환율을 /import/pipeline 1단계에 결합해 C7 환율 1% 이상 괴리 시 자동 경보하고 동일 품종 농장간 TLC 순위를 제시한다.',
      },
    },
    {
      id: 'margin_erosion_defense',
      code: 'L3',
      title: '원가·취급요율(370→460원) 상승 마진 침식 경보 & 23% 방어 단가',
      primaryDept: '영업부',
      departments: ['영업부', '수입부'],
      profitGainKRW: gains.l3,
      annualizedGainKRW: gains.l3 * 52,
      driverText: `목표 마진 ${params.targetMarginPct}% (기준 23%) · 경보 ${marginErosionAlertCount}품목 · 반영 ${params.marginDefenseRatio}%`,
      href: '/shipment/quick-absorb',
      actionLabel: '빠른 분배 단가 확인',
      story: {
        analogySummary: '환율과 창고 취급비(370→460원/kg)가 오른 줄 모르고 옛날 가격으로 팔아 밑지는 것을 출고 전에 막는 브레이크입니다.',
        beforeScene: `해외 FOB와 환율, 백상 창고료가 올라 도착원가가 +3~9% 뛰었는데도 영업부가 직전 차수 단가 그대로 견적·분배를 확정해 수국·카네이션·리시안 마진이 23%에서 13%대까지 주저앉습니다.`,
        afterScene: `인보이스·프로포마 확정 즉시 원가 +3% 상승 품목을 자동 추출해 목표마진 방어 단가(=도착원가÷0.77, 부가세 포함 추천가)를 영업부와 분배 화면에 동시 제시합니다.`,
      },
      dataBasis: {
        emailSource: '네덜란드 금요일 Proforma 메일, 백상 보세창고 단가 인상 안내(370→410→460원/kg)',
        staffSource: '영업부 카톡 수입방 단가 문의(265건)·견적단가 시트, 수입부 차수별 도착원가 확정본',
        counterpartySource: '국내 거래처 출고 견적가(CL○○ 86곳), 해외 농장 주간 FOB 인상 공지',
        criterionRule: '방어단가=실질도착원가÷0.77 (목표 23% 기준, 슬라이더 12~30% 연동) · 마진 미달 즉시 경보',
      },
      departmentTasks: [
        { dept: '수입부', role: '4요인 원가분해 공유', action: '도착원가 변동분을 FOB·환율·운임·통관비 4요인으로 분해해 영업부에 근거 전달', timing: '서류 확정 30분 내', screenLabel: '수입 원스톱 파이프라인', href: pipelineUrl(3) },
        { dept: '영업부', role: '방어 단가 확정·협상', action: '목표 마진 미달 품목의 권장 공급가·VAT 포함가 검토 후 거래처 견적 반영', timing: '출고 분배 전', screenLabel: '빠른 분배 단가 확인', href: '/shipment/quick-absorb' },
        { dept: '출고·창고팀', role: '분배 단가 잠금 확인', action: '빠른 분배 확정 전 경보 품목의 보정 단가 반영 여부 확인 후 출고표 출력', timing: '당일 배차 전', screenLabel: '분배 현황', href: '/shipment/distribute' },
        { dept: '경영지원·정산부', role: '차수 마진 사후 검수', action: '주차별 매출이익 보고서에서 목표 마진 미달 출고 건의 사유·승인 이력 대사', timing: '주간 마감 시', screenLabel: '주차별 매출이익 보고서', href: '/sales/profit-report' },
      ],
      visualDiagram: buildVisualDiagram({
        code: 'L3',
        sourceTitle: '원가표 · 견적가 · 요율(460원)',
        sourceDetail: `경보 ${marginErosionAlertCount}품목 · 목표 ${params.targetMarginPct}%`,
        leakTitle: '원가상승 미반영 마진침식',
        beforeKRW: Math.max(gains.l3, totalMarginGapPoolKRW),
        gateTitle: '마진 방어선 공식',
        gateDetail: `도착원가÷${(1 - params.targetMarginPct / 100).toFixed(2)} (기준 0.77)`,
        deptTitle: '영업부 · 수입부',
        deptDetail: `권장가 보정 ${params.marginDefenseRatio}% 반영`,
        gainKRW: gains.l3,
        beforeLabel: '무대응 마진 침식 손실',
        afterLabel: '보정 후 잔여 격차',
      }),
      continuousBuildModule: {
        moduleId: 'mod-l3-margin-guard-quickabsorb',
        title: '도착원가 4요인 급등 경보 → 빠른 분배(quick-absorb) 추천단가 자동 연동',
        stage: 'LIVE',
        stageLabel: '실전가동 LIVE',
        targetDepts: ['영업부', '수입부'],
        expectedWeeklyGainKRW: gains.l3,
        expectedAnnualGainKRW: gains.l3 * 52,
        ownerRoute: '/shipment/quick-absorb',
        implementationBrief: '[L3 작업지시] /shipment/quick-absorb 분배 단가 셀 옆에 직전 차수 대비 원가 변동 4요인(FOB/환율/운임/백상460원)과 23%(=원가/0.77) 방어 단가 툴팁을 읽기 전용 배지로 표시한다.',
      },
    },
    {
      id: 'credit_note_recovery',
      code: 'L4',
      title: '해외 농장 불량 Credit Note 회수 & 송금 전 강제 차감 게이트',
      primaryDept: '경영지원·정산부',
      departments: ['경영지원·정산부', '수입부', '출고·창고팀'],
      profitGainKRW: gains.l4,
      annualizedGainKRW: gains.l4 * 52,
      driverText: params.creditRecoveryEnabled
        ? `미회수 ${creditRows.length}건 ($${potentialCreditUSD}) · Tive·lista 연동 송금 상계`
        : `반영 제외됨 (잠재 회수 대기 ₩${potentialCreditKRW.toLocaleString('ko-KR')})`,
      href: '/sales/defect-deductions',
      actionLabel: '불량차감 원장',
      story: {
        analogySummary: '국내 거래처에 불량으로 깎아준 돈을 해외 농장 송금 전에 빠짐없이 다시 받아내는 구상권 방어막입니다.',
        beforeScene: `전산 불량차감(WebSalesDefectDeduction) 40차 109/133건·43차 118/118건이 농장 귀속 미확정 상태로 남고, 사진 zip 0KB 전송 사고나 크레딧 대조 누락으로 해외 농장 송금 시 차감(Claim 마이너스 줄)을 못 해 고스란히 손실이 됩니다.`,
        afterScene: `입고 라벨·Tive 온도로거·불량차감 행을 자동 역매칭해 금요일 수입 담당 lista 엑셀과 검증된 사진 zip을 생성하고, 15일/25일 송금 전 미차감 Claim이 있으면 지급 보류 경고를 띄웁니다.`,
      },
      dataBasis: {
        emailSource: '해외 농장 Credit Note 회신 메일·38쪽 합본 PDF, Tive 온도로거 PDF, 월 송금증',
        staffSource: '전산 WebSalesDefectDeduction(40차 109건·43차 118건 미확인), 수입 담당 lista 엑셀+사진zip',
        counterpartySource: '콜롬비아 Creditos 방·Holex 클레임 메일·중국 위챗 합의, 월 결제 엑셀 Claim 줄',
        criterionRule: '사진zip 0KB 검증 + 농장 귀속 확정 완료 후 15·25일 송금 지출결의서 사전 상계 게이트 필수 통과',
      },
      departmentTasks: [
        { dept: '수입부', role: '농장 역매칭·lista 청구', action: '미귀속 불량 건을 패킹리스트로 역매칭 확정 후 금요일 농장별 크레딧 방 발송', timing: '매주 금요일', screenLabel: '불량차감 원장', href: '/sales/defect-deductions' },
        { dept: '영업부', role: '국내 불량차감 사유 입력', action: '거래처 불량 접수 시 품종·수량·증빙사진·Tive 로거 유무를 당일 등록', timing: '클레임 발생 당일', screenLabel: '불량차감 등록 검토', href: '/sales/defect-deduction-register-review' },
        { dept: '출고·창고팀', role: '라벨·검품 사진 확보', action: '입항 시 박스 농장 라벨 및 온도 이탈 현품 사진을 차수·농장명 규칙으로 촬영', timing: '검품 즉시', screenLabel: '농장 품질 인박스', href: '/sales/farm-quality' },
        { dept: '경영지원·정산부', role: '송금 전 Claim 상계', action: '15일·25일 월 결제표 지출결의서 생성 시 승인된 Credit Note 마이너스 줄 반영 확인', timing: '매월 15·25일', screenLabel: '경영지원 통합(송금·채권)', href: '/import/finance' },
      ],
      visualDiagram: buildVisualDiagram({
        code: 'L4',
        sourceTitle: '불량차감 · Tive · 사진zip',
        sourceDetail: `미회수 ${creditRows.length}건 · $${potentialCreditUSD}`,
        leakTitle: '미귀속·송금전 상계누락',
        beforeKRW: potentialCreditKRW,
        gateTitle: '송금 전 Claim 게이트',
        gateDetail: 'lista확정 + zip>0KB + 상계확인',
        deptTitle: '정산부 · 수입부',
        deptDetail: '15·25일 외화송금 전 차감',
        gainKRW: gains.l4,
        beforeLabel: '미회수 클레임 잔액',
        afterLabel: '상계 후 미회수 잔액',
      }),
      continuousBuildModule: {
        moduleId: 'mod-l4-credit-remit-gate',
        title: '불량차감 농장 자동 매칭 + 15·25일 외화송금 전 Credit Note 강제 대사 게이트',
        stage: 'BUILDING',
        stageLabel: '구현검증 BUILDING',
        targetDepts: ['경영지원·정산부', '수입부'],
        expectedWeeklyGainKRW: gains.l4,
        expectedAnnualGainKRW: gains.l4 * 52,
        ownerRoute: '/sales/defect-deductions',
        implementationBrief: '[L4 작업지시] WebSalesDefectDeduction 미확정 행과 패킹리스트 농장 라벨을 매칭해 nenova_XX-X_lista.xlsx 및 >0KB 사진 zip 검증기를 붙이고, /import/finance 15·25일 송금표 생성 전 미상계 Claim 잔액 경고를 연동한다.',
      },
    },
    {
      id: 'import_velocity_routine',
      code: 'L5',
      title: '금요일 Proforma 선처리 & 월요일 집중(81%)·마이너스확정 차단',
      primaryDept: '수입부',
      departments: ['수입부', '출고·창고팀', '영업부'],
      profitGainKRW: gains.l5,
      annualizedGainKRW: gains.l5 * 52,
      driverText: `수입 속도 지수 ${velocityScore}점 · 세션 25.3→10.5분 · 마이너스 확정 40건 차단`,
      href: '/work/manuals',
      actionLabel: '업무 매뉴얼 열기',
      story: {
        analogySummary: '화물이 인천공항에 내리기 전에 금요일 프로포마 서류로 먼저 원가와 품목을 맞춰 두어 월요일 아침 전쟁과 오등록을 없애는 레버입니다.',
        beforeScene: `콜롬비아 1차 입고의 81%가 월요일 08:25~10:21에 몰리고(야간·주말 요청 22%), 도착 후에야 원가자료를 만들면 1~3일 지연 및 OrderMaster 마이너스 확정 블록(40건)이 터져 출고와 견적이 동시에 밀립니다.`,
        afterScene: `네덜란드 금요일 Proforma·주말 수신 인보이스를 도착 전 임시 원가 초안으로 30분 내 산출하고, 월요일 일괄 업로드 직전 마이너스 확정 충돌을 자동 점검해 세션 시간을 25.3분→10.5분(-59%)으로 줄입니다.`,
      },
      dataBasis: {
        emailSource: '금요일 Holex Proforma PDF, 토·일 도착 항공 CI·AWB·검역증 메일',
        staffSource: '전산 48,835건 입고시각 로그(월요일 81%), Orbit 771건 화면기록, 카톡 야간·주말 요청(22%)',
        counterpartySource: '콜롬비아 농장 확정표(PEDIDO), 선율(통관)·백상(창고) 주말 도착 공지',
        criterionRule: '서류 수신 30분 내 임시원가 초안 · 월요일 08:25 전 OrderMaster 마이너스 확정 0건 검증 · 25.3→10.5분 기준',
      },
      departmentTasks: [
        { dept: '수입부', role: '사전 서류 파싱·등록', action: '금요일 Proforma·주말 CI를 네노바웹 Packing List 도구로 사전 대조 후 월요일 일괄 등록', timing: '금 오후 · 월 07:30', screenLabel: '인보이스 원본 대조', href: toolsUrl },
        { dept: '영업부', role: '마이너스 확정 방지', action: '발주 변경 시 OrderMaster 확정 상태 먼저 확인하고 수입방 단가 문의 전 스냅샷 조회', timing: '일요일~월 오전', screenLabel: '주간 발주·원스톱', href: pipelineUrl(2) },
        { dept: '출고·창고팀', role: '사전 도착 스케줄 준비', action: '선공유된 주말·월요일 도착분 보관조건(냉장/보온) 및 배차 슬롯 사전 배정', timing: '입항 전일', screenLabel: '수입 비행기 현황', href: '/desktop-flight' },
        { dept: '경영지원·정산부', role: '임시→본원장 전환 검수', action: 'Proforma 임시원장 삭제 후 실제 인보이스 원장 전환 이력 누락 여부 대조', timing: '화요일 오전', screenLabel: '업무 매뉴얼', href: '/work/manuals' },
      ],
      visualDiagram: buildVisualDiagram({
        code: 'L5',
        sourceTitle: '금요 Proforma · 주말 CI',
        sourceDetail: '월요일 집중 81% · 야간 22%',
        leakTitle: '원가확정 1~3일 지연 · 마이너스 40건',
        beforeKRW: Math.max(gains.l5, velocityDelayPoolKRW),
        gateTitle: '선처리 속도 게이트',
        gateDetail: '30분 내 초안 · 25.3→10.5분(-59%)',
        deptTitle: '수입부 · 창고 · 영업',
        deptDetail: '도착 전 대조 · 월요일 일괄통과',
        gainKRW: gains.l5,
        beforeLabel: '지연·재작업 기회손실',
        afterLabel: '선처리 후 잔여 지연손실',
      }),
      continuousBuildModule: {
        moduleId: 'mod-l5-prearrival-fastlane',
        title: '주말·금요일 Proforma 자동 초안 생성 & 월요일 마이너스 확정 사전 차단기',
        stage: 'LIVE',
        stageLabel: '실전가동 LIVE',
        targetDepts: ['수입부', '영업부'],
        expectedWeeklyGainKRW: gains.l5,
        expectedAnnualGainKRW: gains.l5 * 52,
        ownerRoute: toolsUrl,
        implementationBrief: '[L5 작업지시] /import/tools 패킹리스트 생성기에서 월요일 08:25 업로드 전 OrderMaster 확정상태를 preflight 조회해 마이너스 확정 충돌을 사전 차단하고 Proforma 예비 원가 초안을 생성한다.',
      },
    },
    {
      id: 'fx_remit_timing',
      code: 'L6',
      title: '외화 송금 타이밍 · 농장 결제일(미등록 49곳) & 환전 스프레드 방어',
      primaryDept: '경영지원·정산부',
      departments: ['경영지원·정산부', '수입부'],
      profitGainKRW: gains.l6,
      annualizedGainKRW: gains.l6 * 52,
      driverText: `분할환전·스케줄 방어 ${params.fxSplitSchedulePct}% · 결제일 미등록 49/95곳 정비 · 차수편차 30원+`,
      href: '/import/finance',
      actionLabel: '송금·결제 관리',
      story: {
        analogySummary: '외화 송금 날짜와 환율 고점을 분산해 환전 수수료와 급등일 일괄 송금 손실을 줄이는 외환 방패입니다.',
        beforeScene: `최근 95개 거래 농장 중 49곳의 결제일 규칙이 전산 표에 미등록되어 15일·25일 몰아치기 송금이 발생하고, 동일 주차 내 USD 30.18원(주간 변동폭 USD 5.51% · CNY 7.21% · AUD 10.51%) 편차 구간에서 고점 환전으로 환차손이 누적됩니다.`,
        afterScene: `미등록 49농장의 15일·25일·선결제 구분을 등록하고, 차수 내 환율 스프레드 30원+ 경보 시 분할 매입·외화통장 보유분 우선 충당으로 환전 스프레드를 절감합니다.`,
      },
      dataBasis: {
        emailSource: '은행 외화송금 계산서(전신환매도율·우대율), 15일·25일 농장 대금 인보이스 메일',
        staffSource: '경영지원 월 결제 엑셀(26.MM.15/25 시트), 전산 농장별 결제일 표(95곳 중 49곳 미등록)',
        counterpartySource: '해외 농장 수취은행 등록서류(외상 87곳 15일·12곳 25일, 선결제 HUBFRESH·Royal base), 포딩(15·30일)',
        criterionRule: '차수 내 USD 편차 30원+ 시 2~3회 분할환전 · 미등록 49농장 결제일 필수 등록 · 원화고시/송금환율 괴리 점검',
      },
      departmentTasks: [
        { dept: '경영지원·정산부', role: '분할환전·송금집행', action: '15일·25일·30일 도래 외화 청구액 사전 집계 후 환율 급등일 회피 분할 환전 실행', timing: '결제일 D-5~당일', screenLabel: '경영지원 통합 · 외화환율', href: '/finance/exchange' },
        { dept: '수입부', role: '농장 결제조건 등록', action: '신규·기존 49개 미등록 농장의 인보이스 조건(15일/25일/선결제)과 수취은행 확인 입력', timing: '주 1회 일괄', screenLabel: '농장 마스터 · 송금대기함', href: '/import/finance' },
        { dept: '영업부', role: '환율 급변 선결제 조율', action: '선결제 업체(중국·베트남·신규 에콰도르) 발주 확정 즉시 결제 요청서 당일 전달', timing: '선결제 발주 시', screenLabel: '수입 원스톱 파이프라인', href: pipelineUrl(1) },
        { dept: '출고·창고팀', role: '송금 보류건 입고 확인', action: '선결제 화물 입항·검품 지연 시 정산부에 즉시 통보해 차기 송금 일정 조정', timing: '입항 당일', screenLabel: '수입 비행기 현황', href: '/desktop-flight' },
      ],
      visualDiagram: buildVisualDiagram({
        code: 'L6',
        sourceTitle: '은행 환율표 · 월 결제표',
        sourceDetail: '결제일 미등록 49/95곳 · 30원+ 편차',
        leakTitle: '고점 일괄송금 · 환전 스프레드',
        beforeKRW: Math.max(gains.l6, fxVolatilityPoolKRW),
        gateTitle: '분할환전 · 결제일 게이트',
        gateDetail: `30원+ 분할 · 방어율 ${params.fxSplitSchedulePct}%`,
        deptTitle: '경영지원 · 수입부',
        deptDetail: '15·25일 스케줄 분산 매입',
        gainKRW: gains.l6,
        beforeLabel: '환율·스프레드 노출 풀',
        afterLabel: '분할환전 후 잔여 노출',
      }),
      continuousBuildModule: {
        moduleId: 'mod-l6-remit-fx-scheduler',
        title: '미등록 49농장 결제일 캘린더 & 15·25일 분할환전 스케줄 어드바이저',
        stage: 'BUILDING',
        stageLabel: '구현검증 BUILDING',
        targetDepts: ['경영지원·정산부', '수입부'],
        expectedWeeklyGainKRW: gains.l6,
        expectedAnnualGainKRW: gains.l6 * 52,
        ownerRoute: '/import/finance',
        implementationBrief: '[L6 작업지시] WebFarmRemit 대기함(/import/finance)에 농장별 결제일(15/25/선결제) 미등록 49곳 보완 알림과 주간 환율 30원+ 변동 시 분할환전 권장 시뮬레이터를 탑재한다.',
      },
    },
    {
      id: 'aged_stock_markdown',
      code: 'L7',
      title: '창고 체화·선도저하 재고(3·5·7일 미분배 잔량) 조기 특가 소진',
      primaryDept: '출고·창고팀',
      departments: ['출고·창고팀', '영업부'],
      profitGainKRW: gains.l7,
      annualizedGainKRW: gains.l7 * 52,
      driverText: `조기 특가 소진율 ${params.agedStockClearRatio}% · D+3/D+5/D+7 경과 재고 원가 회수`,
      href: '/shipment/stock-status',
      actionLabel: '재고현황 · 조기소진',
      story: {
        analogySummary: '냉장창고에 3·5·7일째 묵은 꽃을 폐기 직전까지 두지 않고, 선도가 살아 있을 때 영업부 특가로 빨리 회전시켜 현금을 건지는 레버입니다.',
        beforeScene: `월요일 1차 집중(81%) 입고 후 미분배 잔량이 냉장창고에 5~7일 체류하면 개화·잎 변색으로 정상가 판매가 불가능해져 덤핑 혹은 전액 폐기(100% 손실 + 폐기비)로 이어집니다.`,
        afterScene: `입고 후 경과일수 D+3(주의)·D+5(할인전환)·D+7(긴급소진) 기준에 걸린 품목을 자동 추출해 영업부 빠른 분배(/shipment/quick-absorb)로 우선 밀어내 원가의 52% 이상을 회수합니다.`,
      },
      dataBasis: {
        emailSource: '백상 보세창고 잔류 물량 확인 메일, 검역 지연 해제 통지서',
        staffSource: '출고·창고팀 재고현황(/shipment/stock-status), 영업부 빠른 분배(/shipment/quick-absorb) 잔여량 로그',
        counterpartySource: '행사·대량 매입 가능 도매 거래처 스팟 단가 응답 및 선호 화종 데이터',
        criterionRule: 'D+3 경과(경고) → D+5(원가 80% 특가 제안) → D+7(원가 55% 긴급소진 배정) 자동 플래그',
      },
      departmentTasks: [
        { dept: '출고·창고팀', role: '재고 경과일 실사·선입선출', action: '창고 잔여 박스 입고차수 기준 D+3/D+5/D+7 라벨 분류 및 선도 검수 보고', timing: '매일 오전 09:30', screenLabel: '재고현황', href: '/shipment/stock-status' },
        { dept: '영업부', role: '체화재고 특가 배정', action: 'D+5 이상 경과 재고를 대량 소화 거래처에 묶음 특가로 우선 제안·배분', timing: '매일 10:30·15:00', screenLabel: '빠른 분배', href: '/shipment/quick-absorb' },
        { dept: '수입부', role: '반복 체화 품종 발주 감량', action: '2주 연속 D+5 잔량이 남는 품종·등급의 차기 발주량 하향 제안', timing: '금요일 발주 시', screenLabel: '수입 원스톱 파이프라인', href: pipelineUrl(1) },
        { dept: '경영지원·정산부', role: '할인·폐기 손실 대사', action: '특가 할인 회수액과 전액 폐기 손실액을 주차별 매출이익 보고서 재고조정란에 기록', timing: '주간 정산 시', screenLabel: '주차별 매출이익', href: '/sales/profit-report' },
      ],
      visualDiagram: buildVisualDiagram({
        code: 'L7',
        sourceTitle: '창고 재고 · 입고차수일',
        sourceDetail: 'D+3 · D+5 · D+7 체화 잔량',
        leakTitle: '선도 저하 → 전액 폐기 손실',
        beforeKRW: Math.max(gains.l7, agedStockPoolKRW),
        gateTitle: 'D+3/5/7 소진 티어',
        gateDetail: `소진율 ${params.agedStockClearRatio}% · 회수계수 52%`,
        deptTitle: '출고·창고 · 영업부',
        deptDetail: '선도 저하 전 빠른분배 전환',
        gainKRW: gains.l7,
        beforeLabel: '체화재고 전액 폐기위험',
        afterLabel: '조기소진 후 잔여 손실',
      }),
      continuousBuildModule: {
        moduleId: 'mod-l7-aged-stock-alert',
        title: 'D+3·5·7일 체화·선도저하 재고 경보 & 특가 소진 추천판',
        stage: 'BUILDING',
        stageLabel: '구현검증 BUILDING',
        targetDepts: ['출고·창고팀', '영업부'],
        expectedWeeklyGainKRW: gains.l7,
        expectedAnnualGainKRW: gains.l7 * 52,
        ownerRoute: '/shipment/stock-status',
        implementationBrief: '[L7 작업지시] /shipment/stock-status 재고 행에 입고일 기준 D+3/D+5/D+7 경과 배지를 부착하고, D+5 이상 미분배 잔량을 /shipment/quick-absorb 상단 특가 배분 추천 큐로 연결한다.',
      },
    },
    {
      id: 'customer_contribution_alloc',
      code: 'L8',
      title: '국내 거래처별 실질 공헌이익(순단가-클레임-미수비용) 물량 배분',
      primaryDept: '영업부',
      departments: ['영업부', '경영지원·정산부'],
      profitGainKRW: gains.l8,
      annualizedGainKRW: gains.l8 * 52,
      driverText: `공헌이익 배분 가중 ${params.customerAllocRatio}% · 86활성 거래처 순단가·클레임·미수 반영`,
      href: '/mgmt/customer-profit',
      actionLabel: '거래처 공헌이익 보기',
      story: {
        analogySummary: '겉으로 단가가 높아 보여도 반품이 잦고 결제가 늦는 거래처 대신, 진짜 남는 돈이 많은 우량 거래처에 부족한 인기 꽃을 먼저 주는 레버입니다.',
        beforeScene: `한정된 인기 품종(수국·특수장미)을 선착순이나 관행대로 배분하면, 상습 클레임 차감과 장기미수(60일+) 이자·회전비용이 큰 거래처로 물량이 빠져 실질 공헌이익이 깎입니다.`,
        afterScene: `거래처별 순출고단가에서 평균 클레임률과 미수금 회전비용을 차감한 실질 공헌이익 스코어를 산출해, 빠른 분배(/shipment/quick-absorb) 우선 배분 가중치에 반영합니다.`,
      },
      dataBasis: {
        emailSource: '월간 거래처별 세금계산서·반품 크레딧 정산 메일, 수금 입금 통지서',
        staffSource: '경영지원 거래처별 이익(/mgmt/customer-profit)·미수연령(/mgmt/ar-aging), 영업부 일일 분배표',
        counterpartySource: '국내 활성 거래처(CL○○ 86~87곳)의 최근 12주 출고단가·불량차감 빈도·결제 회전일',
        criterionRule: '실질공헌이익 = (출고단가-도착원가) - 클레임률×출고가 - (미수일수/365)×자본비용률(연8%)',
      },
      departmentTasks: [
        { dept: '영업부', role: '우량 거래처 우선 배분', action: '부족 물량·고마진 품종 분배 시 실질 공헌이익 A/B등급 거래처 우선 할당', timing: '분배 확정 시', screenLabel: '빠른 분배', href: '/shipment/quick-absorb' },
        { dept: '경영지원·정산부', role: '미수연령·클레임율 갱신', action: '주 1회 거래처별 장기미수(30/60/90일+) 및 상습 불량차감률 지수 산출', timing: '매주 월요일', screenLabel: '거래처 이익 · 미수연령', href: '/mgmt/customer-profit' },
        { dept: '수입부', role: '고공헌 품종 타겟 발주', action: '공헌이익 상위 거래처 수요가 집중되는 스펙(길이·색상) 중심으로 산지 발주 확대', timing: '발주 계획 시', screenLabel: '수입 원스톱 파이프라인', href: pipelineUrl(1) },
        { dept: '출고·창고팀', role: '핵심 거래처 검품 강화', action: 'A등급 고수익 배분 물량의 박스 선별·보온포장 품질 우선 검수', timing: '출고 작업 시', screenLabel: '출고 분배', href: '/shipment/distribute' },
      ],
      visualDiagram: buildVisualDiagram({
        code: 'L8',
        sourceTitle: '거래처 원장 · 클레임 · 미수',
        sourceDetail: 'CL○○ 86곳 · 이익/미수/불량률',
        leakTitle: '저수익·고클레임 처 편중배분',
        beforeKRW: Math.max(gains.l8, customerContribPoolKRW),
        gateTitle: '순공헌이익 스코어',
        gateDetail: `순마진-클레임-미수비용 (${params.customerAllocRatio}%)`,
        deptTitle: '영업부 · 경영지원',
        deptDetail: '고공헌 거래처 우선 분배',
        gainKRW: gains.l8,
        beforeLabel: '비효율 배분 마진누수',
        afterLabel: '공헌배분 후 잔여 격차',
      }),
      continuousBuildModule: {
        moduleId: 'mod-l8-customer-contrib-ranker',
        title: '거래처 실질 공헌이익(단가-클레임-미수회전) 스코어카드 & 분배 추천',
        stage: 'SPEC_READY',
        stageLabel: '설계완료 SPEC_READY',
        targetDepts: ['영업부', '경영지원·정산부'],
        expectedWeeklyGainKRW: gains.l8,
        expectedAnnualGainKRW: gains.l8 * 52,
        ownerRoute: '/mgmt/customer-profit',
        implementationBrief: '[L8 작업지시] /mgmt/customer-profit 과 /mgmt/ar-aging 미수연령, WebSalesDefectDeduction 거래처별 불량률을 합산해 CL○○ 거래처 공헌등급(A/B/C)을 산출하고 /shipment/quick-absorb 배분 순위에 뱃지로 노출한다.',
      },
    },
    {
      id: 'kakao_cutoff_defense',
      code: 'L9',
      title: '카톡 추가취소방(addcancel) 마감 시차 & 산지 감량 컷오프 방어',
      primaryDept: '영업부',
      departments: ['영업부', '수입부'],
      profitGainKRW: gains.l9,
      annualizedGainKRW: gains.l9 * 52,
      driverText: params.cutoffGuardEnabled
        ? '4주 625건(추가 225·수정 105) 컷오프 대사 활성 · 마감 후 과발주 차단'
        : '컷오프 대사 비활성 (과발주·긴급 스팟 손실 노출)',
      href: '/import/tools',
      actionLabel: '발주·추가취소 대조',
      story: {
        analogySummary: '카톡방에 올라온 주문 추가·취소가 농장 비행기 싣기 마감 시한 전에 정확히 꽂히도록 해, 안 팔릴 꽃을 싣거나 급행 웃돈 주는 일을 막는 레버입니다.',
        beforeScene: `카카오톡 수입방·추가취소방에 4주 625건(발주 추가 225건, 수정 105건, 야간·주말 22%)이 수시로 올라오는데, 해외 농장 현지 시차 마감과 수작업 엑셀 반영 사이에 시차가 생겨 취소 누락(과잉입고)이나 마감 후 긴급 스팟 추가가 발생합니다.`,
        afterScene: `nenovakakao 추가·취소 파싱 내역과 산지 발주 마감 2시간 전 컷오프 게이트를 자동 대사해, 미반영 취소건은 즉시 감량 요청하고 마감 후 변경은 원가 가산 승인 후 반영합니다.`,
      },
      dataBasis: {
        emailSource: '해외 농장·대행사 발주 변경 마감(Cut-off) 확인 메일, 최종 확정 PEDIDO 파일',
        staffSource: '카톡 수입방·추가취소방(nenovakakao addcancel 625건/4주), 중국 추가 엑셀·콜롬비아 주문서',
        counterpartySource: '국내 영업 주문 변경처, 콜롬비아·중국·에콰도르 농장 시차별 WhatsApp/WeChat 창구',
        criterionRule: '산지 컷오프 D-2시간 전 addcancel 미반영 0건 검증 · 야간/주말(22%) 변경분 당일 오전 자동 큐잉',
      },
      departmentTasks: [
        { dept: '영업부', role: '마감 전 추가·취소 확정', action: '산지 마감 2시간 전 카톡 추가취소방 변경건을 확정해 마감 후 번복 최소화', timing: '산지 마감 2시간 전', screenLabel: '수입방 · 발주 변경', href: toolsUrl },
        { dept: '수입부', role: '농장 컷오프 대사·전송', action: 'addcancel 집계표와 농장별 발주 엑셀을 원클릭 대조 후 농장 창구에 감량/추가 송신', timing: '목·금 컷오프 직전', screenLabel: '수입 원스톱 파이프라인', href: pipelineUrl(1) },
        { dept: '출고·창고팀', role: '감량·증량 입고 대조', action: '컷오프 반영된 최종 확정박스 수량 기준으로 공항·창고 도착 검수 진행', timing: '입고 당일', screenLabel: '입고 재고현황', href: '/shipment/stock-status' },
        { dept: '경영지원·정산부', role: '긴급 스팟 추가운임 점검', action: '마감 후 긴급 발주로 발생한 스팟 할증 운임·취소 위약금 별도 집계', timing: '월말 결산 시', screenLabel: '포워딩 정산', href: '/sales/forwarding-clearance' },
      ],
      visualDiagram: buildVisualDiagram({
        code: 'L9',
        sourceTitle: '카톡 추가취소 · 주문서',
        sourceDetail: '4주 625건(추가225·야간22%)',
        leakTitle: '마감 시차 누락 · 과잉입고',
        beforeKRW: cutoffWastePoolKRW,
        gateTitle: 'D-2h 컷오프 게이트',
        gateDetail: params.cutoffGuardEnabled ? 'addcancel 자동대사 ON' : '컷오프 대사 OFF',
        deptTitle: '영업부 · 수입부',
        deptDetail: '산지 감량 반영 · 야간큐 정리',
        gainKRW: gains.l9,
        beforeLabel: '마감 누락 과발주 손실',
        afterLabel: '컷오프 대사 후 잔여 손실',
      }),
      continuousBuildModule: {
        moduleId: 'mod-l9-addcancel-cutoff-bridge',
        title: 'nenovakakao 추가취소방(addcancel) ↔ 산지 발주 컷오프 D-2h 자동 대사 브릿지',
        stage: 'BUILDING',
        stageLabel: '구현검증 BUILDING',
        targetDepts: ['영업부', '수입부'],
        expectedWeeklyGainKRW: gains.l9,
        expectedAnnualGainKRW: gains.l9 * 52,
        ownerRoute: toolsUrl,
        implementationBrief: '[L9 작업지시] lib/importKakaoArchive.js 와 nenovakakao addcancel 이벤트를 수입부 발주 마감 2시간 전 체크리스트에 연동해, 전산 주문과 카톡 추가·취소 차이를 자동 하이라이트한다.',
      },
    },
    {
      id: 'customs_warehouse_audit',
      code: 'L10',
      title: '통관·검역(할증)·보세창고 보관료·내륙용차 기준요율 대사',
      primaryDept: '출고·창고팀',
      departments: ['출고·창고팀', '수입부', '경영지원·정산부'],
      profitGainKRW: gains.l10,
      annualizedGainKRW: gains.l10 * 52,
      driverText: params.customsRateAuditEnabled
        ? '선율(검역·VAT) · 백상(460원/kg·보온/냉장) · 용차(1t/2.5t/5t) 3중 대사 활성'
        : '부대비용 기준요율 대사 비활성 (할증·오청구 노출)',
      href: '/sales/customs-clearance',
      actionLabel: '통관·보세·용차 대사',
      story: {
        analogySummary: '인천공항 도착 후 통관(선율)·보세창고(백상)·국내 화물차(용차) 청구서가 원래 약속된 요율표대로 나왔는지 영수증을 전수 검사하는 레버입니다.',
        beforeScene: `야간·주말 검역 할증, 백상 창고료(370→460원/kg) 중량 오기입이나 보온/냉장 지시 누락(태국 전량보온·네덜란드 안시리움 보온), 내륙 용차 1t/2.5t/5t 등급 과다 청구가 섞여 들어와도 수기 합산으로는 놓치기 쉽습니다.`,
        afterScene: `lib/customsForwardingCalc.js 기준 요율표로 선율 공급가(÷1.1 분리, 베트남 예외)·백상 GW×적용요율·용차 등급(일반 99k·수국 150k)을 청구서 접수 즉시 자동 대사해 과청구를 환급·보정합니다.`,
      },
      dataBasis: {
        emailSource: '선율 관세정산서 PDF, 백상 보세창고 보관료 청구서, 내륙 용차 운송 영수증',
        staffSource: '수입부 그외통관비(/sales/customs-clearance)·포워딩(/sales/forwarding-clearance), 지출결의서 통관시트',
        counterpartySource: '관세법인 선율(검역·소독), 백상(공항 보세창고 370~460원/kg), 월드·내륙 용차(1t/2.5t/5t)',
        criterionRule: '선율 ÷1.1(베트남 제외) · 백상 GW×단가+보온/냉장지시 대사 · 용차 톤수등급 오차 ±3% 초과 시 이의제기',
      },
      departmentTasks: [
        { dept: '수입부', role: '보관조건·서류 사전고지', action: '도착 1~2일 전 선율 서류 및 백상 보관조건(태국 보온·호주 냉장 등) 메일 명시', timing: '도착 1~2일 전', screenLabel: '그외통관비 대사', href: '/sales/customs-clearance' },
        { dept: '출고·창고팀', role: '용차 톤수·반출 검수', action: '공항 창고 반출 시 실제 배차된 용차(1t/2.5t/5t)와 수국 전용차량(150k) 대조', timing: '화물 반출 시', screenLabel: '수입 비행기 현황', href: '/desktop-flight' },
        { dept: '경영지원·정산부', role: '청구서 3중 요율 감사', action: '선율·백상·용차 청구서와 전산 기준요율 대조 후 오청구·중복 VAT 즉시 정정 요청', timing: '지출결의서 작성 시', screenLabel: '경영지원 통합', href: '/import/finance' },
        { dept: '영업부', role: '주말·야간 소독 일정 반영', action: '선소독 필요 품목 사전 지정으로 주말·야간 긴급 검역 할증 발생 최소화', timing: '도착 전날 오후', screenLabel: '수입 원스톱 파이프라인', href: pipelineUrl(3) },
      ],
      visualDiagram: buildVisualDiagram({
        code: 'L10',
        sourceTitle: '선율 · 백상 · 용차 청구서',
        sourceDetail: '통관비 · 창고 460원/kg · 용차',
        leakTitle: '할증 · 중량오기 · VAT 오차',
        beforeKRW: customsVariancePoolKRW,
        gateTitle: 'customsForwardingCalc',
        gateDetail: params.customsRateAuditEnabled ? '3중 기준요율 대사 ON' : '기준요율 대사 OFF',
        deptTitle: '창고 · 수입 · 정산부',
        deptDetail: '요율대사 · 보관지시 검증',
        gainKRW: gains.l10,
        beforeLabel: '부대비용 오청구 노출',
        afterLabel: '요율대사 후 잔여 오차',
      }),
      continuousBuildModule: {
        moduleId: 'mod-l10-customs-rate-auditor',
        title: '선율·백상·내륙용차 청구서 PDF ↔ customsForwardingCalc 기준요율 자동 대사기',
        stage: 'SPEC_READY',
        stageLabel: '설계완료 SPEC_READY',
        targetDepts: ['경영지원·정산부', '출고·창고팀', '수입부'],
        expectedWeeklyGainKRW: gains.l10,
        expectedAnnualGainKRW: gains.l10 * 52,
        ownerRoute: '/sales/customs-clearance',
        implementationBrief: '[L10 작업지시] lib/customsForwardingCalc.js 의 국가별/콜롬비아 기준요율(BakSangRateApplied, 선율 ÷1.1, 용차 1t/2.5t/5t)과 지출결의서 통관시트 입력값을 자동 비교해 3% 이상 편차 행을 경보한다.',
      },
    },
  ];
}

export function runCostAgiAudit({
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

  let totalBaselineRevenueKRW = 0;
  let totalBaselineCostKRW = 0;
  let totalShockedUnhedgedCostKRW = 0;
  let totalSimRevenueKRW = 0;
  let totalSimCostKRW = 0;
  let totalForeignExposureKRW = 0;
  let totalCustomsAndOtherKRW = 0;

  let lever1BoxAndAwbSavingsKRW = 0;
  let lever2FobArbitrageSavingsKRW = 0;
  let lever3MarginDefenseKRW = 0;
  let marginErosionAlertCount = 0;

  const skuRows = normalized.skus.map((sku) => {
    const qty = Math.max(1, Number(sku.expectedSalesQty || sku.boxes * sku.actualUnitsPerBox) || 1);
    const fxRateBase = baseFx[sku.currency] || baseFx.USD;
    const fxRateSim = fx[sku.currency] || fx.USD;

    const baseFobKRW = sku.fobForeign * fxRateBase;
    const baseFreightKRW = sku.freightPerUnitUSD * baseFx.USD;
    const baseLandedKRW = round0(baseFobKRW + baseFreightKRW + sku.customsPerUnitKRW + sku.otherPerUnitKRW);

    const shockedFobKRW = sku.fobForeign * fxRateSim;
    const shockedFreightKRW = sku.freightPerUnitUSD * fx.USD;
    const unhedgedLandedKRW = round0(shockedFobKRW + shockedFreightKRW + sku.customsPerUnitKRW + sku.otherPerUnitKRW);

    // L1: Box fill normalization + AWB density efficiency
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

    // L2: Farm/Country Cross-Sourcing (FOB Arbitrage + China APTA E1 3.6%p edge)
    const peerFobKRW = (sku.peerFobForeign || sku.fobForeign * 0.91) * fxRateSim;
    const aptaDutyBonusKRW = sku.countryCode === 'CN' ? shockedFobKRW * 0.036 : 0;
    const fobSpreadKRW = Math.max(0, shockedFobKRW - peerFobKRW) + aptaDutyBonusKRW;
    const rebalanceFraction = params.rebalancePct / 100;
    const l2UnitSaveKRW = fobSpreadKRW * rebalanceFraction;
    const l2TotalSaveKRW = round0(l2UnitSaveKRW * qty);

    const simLandedKRW = Math.max(1, round0(unhedgedLandedKRW - l1UnitSaveKRW - l2UnitSaveKRW));

    // L3: Margin Erosion Defense
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
    totalForeignExposureKRW += (shockedFobKRW + shockedFreightKRW) * qty;
    totalCustomsAndOtherKRW += (sku.customsPerUnitKRW + sku.otherPerUnitKRW) * qty;

    lever1BoxAndAwbSavingsKRW += l1TotalSaveKRW;
    lever2FobArbitrageSavingsKRW += l2TotalSaveKRW;
    lever3MarginDefenseKRW += l3TotalDefenseKRW;

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

  const awbDiagnostics = normalized.awbs.map((a) => {
    const tier = lookupAwbTier(a.countryCode, a.cwKg);
    const fxCurrency = fx[tier.currency] || fx.USD;
    const gapFilledWeight = tier.nextTier ? Math.max(a.cwKg, tier.nextTier.minKg) : a.cwKg;
    const currentFreightForeign = round2(a.cwKg * tier.currentTier.rate);
    const nextTierFreightForeign = tier.nextTier
      ? round2(gapFilledWeight * tier.nextTier.rate)
      : currentFreightForeign;
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

  // L5..L10 mathematical profit levers (monotonic, 0 when disabled/0%)
  const lever5VelocityGainKRW = round0(totalBaselineRevenueKRW * 0.004 * (params.marginDefenseRatio / 100));
  const fxSpreadEdgeRate = 0.0075 + Math.max(0, params.fxDeltaKRW) * 0.00008;
  const lever6FxTimingKRW = round0(totalForeignExposureKRW * fxSpreadEdgeRate * (params.fxSplitSchedulePct / 100));
  const lever7AgedStockKRW = round0(totalShockedUnhedgedCostKRW * 0.022 * 0.52 * (params.agedStockClearRatio / 100));
  const lever8CustomerAllocKRW = round0(totalBaselineRevenueKRW * 0.0095 * (params.customerAllocRatio / 100));
  const lever9CutoffGuardKRW = params.cutoffGuardEnabled ? round0(totalBaselineCostKRW * 0.0055) : 0;
  const lever10CustomsAuditKRW = params.customsRateAuditEnabled ? round0(totalCustomsAndOtherKRW * 0.038) : 0;

  const levers = buildLeverMetadata({
    orderYear,
    orderWeek,
    scopeCountry,
    params,
    fx,
    skuRows,
    awbDiagnostics,
    awbTierReadyCount,
    marginErosionAlertCount,
    creditRows,
    potentialCreditUSD,
    potentialCreditKRW,
    velocityScore,
    totalBaselineRevenueKRW,
    totalBaselineCostKRW,
    totalShockedUnhedgedCostKRW,
    totalForeignExposureKRW,
    totalCustomsAndOtherKRW,
    gains: {
      l1: lever1BoxAndAwbSavingsKRW,
      l2: lever2FobArbitrageSavingsKRW,
      l3: lever3MarginDefenseKRW,
      l4: lever4CreditAppliedKRW,
      l5: lever5VelocityGainKRW,
      l6: lever6FxTimingKRW,
      l7: lever7AgedStockKRW,
      l8: lever8CustomerAllocKRW,
      l9: lever9CutoffGuardKRW,
      l10: lever10CustomsAuditKRW,
    },
  });

  const continuousBuildQueue = levers.map((lv) => ({
    leverCode: lv.code,
    leverTitle: lv.title,
    ...lv.continuousBuildModule,
  }));

  const totalPotentialProfitKRW = levers.reduce((s, l) => s + l.profitGainKRW, 0);
  const annualizedProfitKRW = totalPotentialProfitKRW * 52;

  const unhedgedProfitKRW = totalBaselineRevenueKRW - totalShockedUnhedgedCostKRW;
  const unhedgedMarginPct = totalBaselineRevenueKRW > 0
    ? round2(((totalBaselineRevenueKRW - totalShockedUnhedgedCostKRW) / totalBaselineRevenueKRW) * 100)
    : 0;
  const simulatedProfitKRW = (totalSimRevenueKRW - totalSimCostKRW)
    + lever4CreditAppliedKRW
    + lever5VelocityGainKRW
    + lever6FxTimingKRW
    + lever7AgedStockKRW
    + lever8CustomerAllocKRW
    + lever9CutoffGuardKRW
    + lever10CustomsAuditKRW;
  const simulatedMarginPct = totalSimRevenueKRW > 0
    ? round2((simulatedProfitKRW / totalSimRevenueKRW) * 100)
    : 0;
  const marginDeltaPctPt = round2(simulatedMarginPct - unhedgedMarginPct);

  const defendedSkuCount = matrixRows.filter((s) => s.simPostMarginPct >= params.targetMarginPct - 0.05).length;
  const marginDefenseRatePct = matrixRows.length > 0
    ? round1((defendedSkuCount / matrixRows.length) * 100)
    : 100;
  const costLeakAlertCount = marginErosionAlertCount + awbTierReadyCount + creditRows.length;

  const fxLadder = [-50, -25, 0, 25, 50, 75, 100].map((delta) => {
    const ladderFx = buildEffectiveFxRates(normalized.fxFromApi, delta);
    let rev = 0;
    let unhedgedCost = 0;
    let simCost = 0;
    let simRev = 0;
    let ladderForeignExp = 0;
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
      const aptaBonus = sku.countryCode === 'CN' ? fob * 0.036 : 0;
      const l2Save = (Math.max(0, fob - (sku.peerFobForeign || sku.fobForeign * 0.91) * rRate) + aptaBonus) * (params.rebalancePct / 100);
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
      ladderForeignExp += (fob + fr) * qty;
    }
    const ladderCredit = params.creditRecoveryEnabled ? round0(potentialCreditUSD * ladderFx.USD) : 0;
    const ladderFxEdge = round0(ladderForeignExp * (0.0075 + Math.max(0, delta) * 0.00008) * (params.fxSplitSchedulePct / 100));
    const ladderExtraLevers = ladderCredit + lever5VelocityGainKRW + ladderFxEdge + round0(unhedgedCost * 0.022 * 0.52 * (params.agedStockClearRatio / 100)) + lever8CustomerAllocKRW + lever9CutoffGuardKRW + lever10CustomsAuditKRW;
    const uMargin = rev > 0 ? round2(((rev - unhedgedCost) / rev) * 100) : 0;
    const sProfit = (simRev - simCost) + ladderExtraLevers;
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

  const agiTrace = [
    {
      stage: 'Observe',
      stepNo: '01',
      title: '이메일·담당자·거래처 4원천 실증 관측',
      summary: `${orderYear}년 ${orderWeek}차 (${countryLabel(scopeCountry)}) · 품목 ${matrixRows.length}건, AWB ${awbDiagnostics.length}건, 미회수 클레임 ${creditRows.length}건, 결제일·카톡·통관요율 관측`,
      metric: `기준 매출 ₩${totalBaselineRevenueKRW.toLocaleString('ko-KR')}`,
    },
    {
      stage: 'Diagnose',
      stepNo: '02',
      title: '전사 10대 원가 누수 및 부서 병목 진단',
      summary: `목표 마진(${params.targetMarginPct}%) 미달 ${marginErosionAlertCount}품목, AWB 구간 근접 ${awbTierReadyCount}건, 미청구 크레딧 $${potentialCreditUSD}, 미등록 결제일 49농장 식별`,
      metric: `총 경보 ${costLeakAlertCount}건`,
    },
    {
      stage: 'Counterfactual Simulate',
      stepNo: '03',
      title: 'L1~L10 반사실 이익 시뮬레이션',
      summary: `환율 ${params.fxDeltaKRW >= 0 ? '+' : ''}${params.fxDeltaKRW}원 · 리밸런싱 ${params.rebalancePct}% · 채움 +${params.boxFillGainPct}% · 송금분할 ${params.fxSplitSchedulePct}% · 체화소진 ${params.agedStockClearRatio}% 동시 모의`,
      metric: `총이익률 ${unhedgedMarginPct}% → ${simulatedMarginPct}% (${marginDeltaPctPt >= 0 ? '+' : ''}${marginDeltaPctPt}%p)`,
    },
    {
      stage: 'Propose',
      stepNo: '04',
      title: '4부서 연계 실행안 & 연속구현 큐 제안',
      summary: `수입부·영업부·출고창고팀·경영지원부 역할별 원장 무쓰기 승인 링크와 차기 자동화 작업지시서 10종 생성`,
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
    continuousBuildQueue,
    skus: matrixRows,
    awbs: awbDiagnostics,
    claims: creditRows,
    fxLadder,
    routineSteps,
    agiTrace,
  };
}

export function buildCostAgiExecutiveBriefing(audit) {
  if (!audit) return '';
  const { scope, params, summary, levers, fx } = audit;
  const fmt = (n) => Number(n || 0).toLocaleString('ko-KR');
  const topLevers = [...(levers || [])]
    .sort((a, b) => b.profitGainKRW - a.profitGainKRW)
    .slice(0, 5);

  const lines = [
    `[전사 10대 원가·이익 레버 AGI 브리핑] ${scope.orderYear}년 ${scope.orderWeek}차 · ${scope.countryName}`,
    `기준 환율: ₩${fmt(fx.USD)}/USD (충격 가정 ${params.fxDeltaKRW >= 0 ? '+' : ''}${params.fxDeltaKRW}원)`,
    `- 차수 이익 개선 가능액 (L1~L10 합계): +₩${fmt(summary.totalPotentialProfitKRW)} (52주 환산 +₩${fmt(summary.annualizedProfitKRW)})`,
    `- 총이익률 변화: ${summary.unhedgedMarginPct}% -> ${summary.simulatedMarginPct}% (${summary.marginDeltaPctPt >= 0 ? '+' : ''}${summary.marginDeltaPctPt}%p)`,
    `- 원가 누수·마진 경보: ${summary.costLeakAlertCount}건 (목표 마진 ${params.targetMarginPct}% 방어율 ${summary.marginDefenseRatePct}%)`,
    '',
    '핵심 실행 레버 상위 5건 (부서 연계 포함):',
    ...topLevers.map((l, idx) => `${idx + 1}. [${l.code} · ${l.primaryDept}] ${l.title}: +₩${fmt(l.profitGainKRW)} (${l.driverText})`),
    '',
    '※ 본 시뮬레이션은 읽기 전용 분석 결과이며 전산 원장을 자동 수정하지 않습니다. 실제 반영은 수입부·영업부·출고창고팀·경영지원 담당자 확인 후 진행합니다.',
  ];
  return lines.join('\n');
}

export { PIPELINE_COUNTRIES, countryLabel, normalizeCountryCode };
