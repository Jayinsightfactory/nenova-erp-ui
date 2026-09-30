// 콜카장수국 혼적 AWB 5품목 풀 · 콜롬비아 USD 원가자료 환율 · 품목없는 0원 행 · NL 통관 기본값 · 보고서 가중평균 (2026-09-30)
import assert from 'node:assert/strict';
import { computeColombiaRatios, computeColombiaAllocation, COLOMBIA_POOLED_HYDRANGEA } from '../lib/customsForwardingCalc.js';
import { pickSourceWorkbookFx, FX_SOURCE } from '../lib/sourceWorkbookFx.js';
import { isFreightRow, isOrphanZeroRow, defaultFreightCustoms } from '../lib/freightCalc.js';
import { aggregateArrivalCosts } from '../lib/pivotArrivalCalc.js';

const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

// ── 원가자료 36-1 AA7:AJ12 배분표 그대로(ROSE 8/10 · CARN 11/9 · ALST 9.7/7 · RUSC 8/9.6 · HYD 5.5/6.7)
const xlRates = {
  BoxWeight_콜롬비아장미: 8, BoxCBM_콜롬비아장미: 10, BoxWeight_콜롬비아카네이션: 11, BoxCBM_콜롬비아카네이션: 9,
  BoxWeight_콜롬비아알스트로: 9.7, BoxCBM_콜롬비아알스트로: 7, BoxWeight_콜롬비아루스커스: 8, BoxCBM_콜롬비아루스커스: 9.6,
};
const box361 = { '콜롬비아 장미': 336, '콜롬비아 카네이션': 709, '콜롬비아 알스트로': 92, '콜롬비아 루스커스': 87.6, [COLOMBIA_POOLED_HYDRANGEA]: 602 };
const r = computeColombiaRatios(box361, xlRates);
assert.ok(near(r.weightRatio['콜롬비아 장미'], 0.17464525183221583, 1e-12), 'AD8');
assert.ok(near(r.weightRatio[COLOMBIA_POOLED_HYDRANGEA], 0.21512292738707833, 1e-12), 'AD12 수국 무게비율(기본값 5.5)');
assert.ok(near(r.cbmRatio[COLOMBIA_POOLED_HYDRANGEA], 0.26432301223642407, 1e-12), 'AI12 수국 CBM비율(기본값 6.7)');
assert.ok(near(Object.values(r.weightRatio).reduce((a, b) => a + b, 0), 1), 'AD13=1');
// 풀 총액 × 무게비율 = 원가자료 T11(수국 통관 1,544,574)
const alloc = computeColombiaAllocation({ GW: 15126, CW: 15517, AirRateUSD: 41695.27 }, box361, { ...xlRates, BakSangRate: 0 });
assert.ok(alloc[COLOMBIA_POOLED_HYDRANGEA], '수국 배분 존재');
assert.ok(near(7179960 * r.weightRatio[COLOMBIA_POOLED_HYDRANGEA], 1544574.0137221268, 1e-4), 'T11');
assert.ok(near(alloc[COLOMBIA_POOLED_HYDRANGEA].S, 41695.27 * r.cbmRatio[COLOMBIA_POOLED_HYDRANGEA], 1e-6), 'GW≠CW → 항공료는 CBM 비율(K11)');
// 수국 박스가 없으면 기존 4품목 그대로(5번째 키 없음)
const four = computeColombiaAllocation({ GW: 100, CW: 100 }, { '콜롬비아 장미': 10 }, xlRates);
assert.equal(four[COLOMBIA_POOLED_HYDRANGEA], undefined);

// ── USD 원가자료 환율: 콜롬비아 + 같은 세부차수만
const fxRows = [
  { OrderYear: '2026', OrderWeek: '36-1', CountryName: '콜롬비아', ExchangeRate: 1500, n: 344 },
  { OrderYear: '2026', OrderWeek: '37-1', CountryName: '콜롬비아', ExchangeRate: 1450, n: 335 },
  { OrderYear: '2026', OrderWeek: '37-1', CountryName: '에콰도르', ExchangeRate: 1400, n: 6 },
  { OrderYear: '2026', OrderWeek: '33-2', CountryName: '콜롬비아', ExchangeRate: 1520, n: 86, Hyd: 0 },
];
assert.equal(pickSourceWorkbookFx([...fxRows, { OrderYear: '2026', OrderWeek: '33-2', CountryName: '콜롬비아', ExchangeRate: 1550, n: 24, Hyd: 1 }],
  { orderYear: '2026', orderWeek: '33-02', currency: 'USD', country: '콜롬비아', hydrangeaOnly: true }).rate, 1550, '수국 단독 AWB 는 수국 행 원가자료 환율 우선');
assert.equal(pickSourceWorkbookFx(fxRows, { orderYear: '2026', orderWeek: '33-02', currency: 'USD', country: '콜롬비아', hydrangeaOnly: true }).rate, 1520, '수국 행 없으면 같은 세부차수 콜롬비아 원가자료');
assert.equal(pickSourceWorkbookFx(fxRows, { orderYear: '2026', orderWeek: '33-02', currency: 'USD', country: '콜롬비아' }).rate, 1520);
assert.deepEqual(pickSourceWorkbookFx(fxRows, { orderYear: '2026', orderWeek: '36-01', currency: 'USD', country: '콜롬비아' }),
  { rate: 1500, source: FX_SOURCE.WORKBOOK_WEEK, sourceWeek: '36-1' });
assert.equal(pickSourceWorkbookFx(fxRows, { orderYear: '2026', orderWeek: '36-02', currency: 'USD', country: '콜롬비아' }), null, '36-2 는 대차수 이월 금지(엑셀 1450)');
assert.equal(pickSourceWorkbookFx(fxRows, { orderYear: '2026', orderWeek: '38-01', currency: 'USD', country: '콜롬비아' }), null, '직전차수 이월 금지');
assert.equal(pickSourceWorkbookFx(fxRows, { orderYear: '2026', orderWeek: '37-01', currency: 'USD', country: '에콰도르' }), null, '에콰도르는 대상 아님');
assert.equal(pickSourceWorkbookFx(fxRows, { orderYear: '2026', orderWeek: '37-01', currency: 'USD' }), null, '국가 미지정 USD 는 기존대로');

// ── 품목 없는 0원 행(38-01 Apollo GW/CW 중복 잔재)은 꽃 행이 아니다
assert.equal(isOrphanZeroRow({ ProdKey: null, ProdName: null, TPrice: 0, SteamQuantity: 15296 }), true);
assert.equal(isFreightRow({ ProdKey: null, ProdName: null, TPrice: 0, FarmName: 'Apollo' }), true);
assert.equal(isOrphanZeroRow({ ProdKey: 889, ProdName: 'Hydrangea White', TPrice: 0 }), false);
assert.equal(isOrphanZeroRow({ ProdKey: null, ProdName: null, TPrice: 12 }), false, '금액 있는 행은 남긴다');

// ── NL 통관 기본값(원가자료 Q9 90,000 · S7 소독비 220,000 · 검역차감 수기)
assert.deepEqual([defaultFreightCustoms(['네덜란드']).domesticFreight, defaultFreightCustoms(['네덜란드']).deductFee, defaultFreightCustoms(['네덜란드']).extraFee], [90000, 0, 220000]);
assert.deepEqual([defaultFreightCustoms(['콜롬비아']).domesticFreight, defaultFreightCustoms(['콜롬비아']).deductFee], [99000, 40000], '콜롬비아 통관식 불변');
assert.equal(defaultFreightCustoms(['네덜란드', '콜롬비아']).domesticFreight, 99000);

// ── 보고서 가중평균 vs 카탈로그 MAX (수국 30-02 Hydrangea White 3농장)
const recs = [
  { prodKey: 889, inQty: 23, displayArrivalKRW: 61614, arrivalPerStem: 2053.8, displayUnit: '박스', source: 'live' },
  { prodKey: 889, inQty: 25, displayArrivalKRW: 68124, arrivalPerStem: 2270.8, displayUnit: '박스', source: 'live' },
  { prodKey: 889, inQty: 25, displayArrivalKRW: 63474, arrivalPerStem: 2115.8, displayUnit: '박스', source: 'live' },
];
assert.equal(aggregateArrivalCosts(recs)[889].arrivalPerStem, 2270.8, '기본(MAX) 불변');
const w = aggregateArrivalCosts(recs, { mode: 'weighted' })[889];
assert.ok(near(w.arrivalPerStem, (2053.8 * 23 + 2270.8 * 25 + 2115.8 * 25) / 73, 1e-9));
assert.equal(w.displayUnit, '박스');
const mixedMissing = aggregateArrivalCosts([
  { prodKey: 1, inQty: 10, displayArrivalKRW: 100, arrivalPerStem: 10, displayUnit: '단', goodsCostMissing: true },
  { prodKey: 1, inQty: 10, displayArrivalKRW: 300, arrivalPerStem: 30, displayUnit: '단' },
], { mode: 'weighted' })[1];
assert.equal(mixedMissing.arrivalCost, 300, '상품원가 누락 행은 정상 행이 있으면 제외');
assert.equal(mixedMissing.goodsCostMissing, undefined);

console.log('colombiaMixedAwbPool: all passed');
