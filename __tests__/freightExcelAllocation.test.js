// 운송기준원가 분배 규칙 = 직원 원가자료 엑셀 — 2026-09-30 수국 운임 0 / NL 원가 차이 회귀 테스트
// 실행: node __tests__/freightExcelAllocation.test.js
//  1) 콜롬비아 혼적 AWB 의 수국(Flower BoxWeight/CBM 미설정) — 운임 0원 금지, 수국 박스당 CBM 6.64(엑셀 36-1·37-1 역산)
//  2) 콜롬비아 통관 = 통관합계 × 무게비율(AD) — 운임만 IF(GW=CW, 무게, CBM)
//  3) 콜롬비아 BoxQuantity=0 행 — 송이수÷박스당송이 로 박스 환산(엑셀 L = 박스수×박스당송이)
//  4) 미설정 카테고리 잔여 배분(엑셀 '기타' 잔여 규칙)
//  5) 네덜란드 AWB — 금액비율(G = FOB×수량÷D6) 운임·통관 분배 + NL 엑셀 품명 관세표
const assert = require('assert');

// 28-2 NL 원가자료.xlsx (C7 환율 1750, C11 항공료 1637.844, Q10 통관합계 938432.29) — [품명, 수량(송이), FOB, 도착원가(송이) M]
const NL_28_2 = [
  ['Anthurium Graciosa 13cm', 36, 2.96, 7403.4051],
  ['Astilbe / Europa L/Pink', 50, 0.46, 1150.5292],
  ['Astilbe / Washington White', 200, 0.5, 1250.5752],
  ['Eryngium Orion Blue 60cm', 130, 0.71, 2186.8849],
  ['Hyacinthus / Fondant L/Pink', 25, 0.39, 975.4486],
  ['Hyacinthus/ Sky Jacket', 25, 0.3, 750.3451],
  ['Tulip / Double Kantika Lavender', 50, 0.45, 1125.5177],
  ['Tulip / Liberster White', 100, 0.76, 1900.8743],
  ['Tulip / Single Antarctica', 300, 0.74, 1850.8513],
  ['Tulip / Single Dynasty L/Pink', 100, 0.73, 1825.8398],
  ['Tulip / Single Orange Juice', 50, 0.47, 1175.5407],
  ['Tulip / Single Royal Virgen White1', 200, 0.59, 1475.6787],
  ['Hyacinthus / Top White', 50, 0.9, 2251.0353],
  ['Agapanthus / Eyfori light blue', 200, 1.42, 3551.6335],
  ['Agapanthus / Eyfori White 70cm', 200, 1.42, 3551.6335],
  ['Anthurium Graciosa 15cm', 250, 2.89, 7228.3246],
  ['Anthurium Princess Alexia Bordeaux 11cm', 16, 2.3, 5752.6459],
  ['Astilbe / Washington White', 100, 0.5, 1250.5752],
  ['Eryngium Magnetar Questar', 300, 0.65, 2002.0777],
  ['Eryngium Orion Blue 60cm', 20, 0.71, 2186.8849],
  ['Skimmia / Conf Kew Ger Green', 300, 1.95, 4877.2432],
  ['Tulip / Double Kantika Lavender', 50, 0.45, 1125.5177],
  ['Tulip / Single Antarctica', 200, 0.74, 1850.8513],
  ['Tulip / Single Dynasty L/Pink', 150, 0.73, 1825.8398],
  ['Tulip / Single Orange Juice', 50, 0.47, 1175.5407],
  ['Tulip / Single Royal Virgen White1', 550, 0.59, 1475.6787],
  ['Allium / Giganteum', 200, 1.65, 4126.8981],
  ['Allium / White Giant', 250, 1.9, 4752.1857],
  ['Campanula / Campana Pearl Pink', 100, 0.79, 1975.9088],
  ['Campanula / Medium Lavender', 100, 0.79, 1975.9088],
  ['Campanula / Medium Champion White', 100, 0.79, 1975.9088],
  ['Eryngium Sirius Questar White 70cm', 200, 0.81, 2494.8968],
  ['Hyacinthus / Top White', 75, 0.9, 2251.0353],
  ['Lily Oriental Double Roselily Aisha 2+', 60, 1.25, 3126.4380],
];

// 콜롬비아 원가자료 박스당 무게/CBM (Flower 마스터와 동일)
const CO_FLOWER_META = {
  '장미': { boxWeight: 8, boxCBM: 10, stemsPerBox: 100 },
  '카네이션': { boxWeight: 11, boxCBM: 9, stemsPerBox: 300 },
  '알스트로': { boxWeight: 9.7, boxCBM: 7, stemsPerBox: 160 },
  '루스커스': { boxWeight: 8, boxCBM: 9.6, stemsPerBox: 625 },
  '수국': { boxWeight: null, boxCBM: null, stemsPerBox: null },
};

function coRow(i, flowerName, box, stems, fob, extra = {}) {
  return {
    warehouseDetailKey: i, prodKey: i, prodName: `${flowerName} ${i}`, flowerName, counName: '콜롬비아', outUnit: '박스',
    boxQty: box, rawBoxQty: box, bunchQty: stems, steamQty: stems, fobUSD: fob, totalPriceUSD: fob * stems, stemsPerBunch: 1, ...extra,
  };
}

async function main() {
  const { computeFreightCost, nlExcelTariffRate, defaultBoxMetrics } = await import('../lib/freightCalc.js');
  const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} != ${b} (tol ${tol})`);

  // ── 1) 36-1 콜롬비아 혼적 AWB 형태 (GW 15126 ≠ CW 15517 → CBM 기준)
  const mixedDetails = [
    coRow(1, '장미', 179, 17900, 0.4),
    coRow(2, '장미', 0, 15700, 0.4),                // BoxQuantity 0 입고(Construnorte 형) → 157박스 환산
    coRow(3, '카네이션', 730, 219000, 0.2),
    coRow(4, '알스트로', 92, 14720, 0.18),
    coRow(5, '루스커스', 87, 54375, 0.11),
    coRow(6, '수국', 602, 18180, 0.45),
  ];
  // pivot 처럼 카테고리 첫 행에만 boxQty 합계
  const seen = new Set();
  const byCat = {};
  for (const d of mixedDetails) byCat[d.flowerName] = (byCat[d.flowerName] || 0) + d.rawBoxQty;
  for (const d of mixedDetails) { d.boxQty = seen.has(d.flowerName) ? 0 : byCat[d.flowerName]; seen.add(d.flowerName); }
  const mixed = computeFreightCost({
    master: { warehouseKey: 1, gw: 15126, cw: 15517, rateUSD: 0, docFeeUSD: 0, exchangeRate: 1500, actualFreightUSD: 41725.3, itemCount: 5 },
    basis: 'AUTO',
    customs: { bakSangRate: 460, handlingFee: 33000, quarantinePerItem: 10000, domesticFreight: 99000, deductFee: 40000, extraFee: 0 },
    details: mixedDetails, productMeta: {}, flowerMeta: CO_FLOWER_META,
  });
  assert.strictEqual(mixed.header.basis, 'CBM');
  const cat = (n) => mixed.categories.find((c) => c.flowerName === n);
  // 장미 박스 = 179 + 15700/100
  near(cat('장미').boxCount, 336, 1e-9, '장미 박스 환산');
  // 수국 박스당 CBM 6.64 기본값 → 운임 0 금지
  assert.ok(cat('수국').freightUSD > 0, '수국 운임 0 금지');
  near(cat('수국').boxCBM, 6.64, 1e-9);
  // 엑셀 36-1(37-1 원가자료) 송이당 운임: 수국 0.6046 · 카네이션 0.0820 · 장미 0.2732 · 알스트로 0.1195 · 루스커스 0.0420 (±2%)
  near(cat('수국').freightPerStemUSD, 0.6046, 0.6046 * 0.02, '수국 운임/송이');
  near(cat('카네이션').freightPerStemUSD, 0.0820, 0.0820 * 0.02, '카네이션 운임/송이');
  near(cat('장미').freightPerStemUSD, 0.2732, 0.2732 * 0.02, '장미 운임/송이');
  near(cat('알스트로').freightPerStemUSD, 0.1195, 0.1195 * 0.02, '알스트로 운임/송이');
  near(cat('루스커스').freightPerStemUSD, 0.0420, 0.0420 * 0.02, '루스커스 운임/송이');
  // ── 2) 통관은 무게비율(AD): 엑셀 36-1 송이당 통관 수국 85 · 카네이션 17 · 장미 37 · 알스트로 28 · 루스커스 6 (±1원)
  near(cat('수국').customsPerStemKRW, 85, 1.5, '수국 통관/송이');
  near(cat('카네이션').customsPerStemKRW, 17, 1, '카네이션 통관/송이');
  near(cat('장미').customsPerStemKRW, 37, 1, '장미 통관/송이');
  near(cat('알스트로').customsPerStemKRW, 28, 1, '알스트로 통관/송이');
  near(cat('루스커스').customsPerStemKRW, 6, 1, '루스커스 통관/송이');
  near(mixed.categories.reduce((a, c) => a + c.freightUSD, 0), 41725.3, 1e-6, '운임 합계 보존');
  near(mixed.categories.reduce((a, c) => a + c.customsKRW, 0), mixed.header.customsTotalKRW, 1e-6, '통관 합계 보존');

  // 수국 단독 AWB(엑셀 '수국 원가자료' = 항공료÷총송이) 는 그대로 — 28-1: 9933.6 USD / 16000 송이
  const solo = computeFreightCost({
    master: { warehouseKey: 2, gw: 2857, cw: 3348, exchangeRate: 1550, actualFreightUSD: 9933.6, itemCount: 1 },
    customs: {}, details: [coRow(10, '수국', 300, 9000, 0.55), coRow(11, '수국', 230, 7000, 0.6)].map((d, i) => ({ ...d, boxQty: i === 0 ? 530 : 0 })),
    productMeta: {}, flowerMeta: CO_FLOWER_META,
  });
  near(solo.rows[0].freightPerStemUSD, 9933.6 / 16000, 1e-9, '수국 단독 = 항공료÷총송이');

  // 수국 기본 박스값은 콜롬비아 한정 (네덜란드 수국 제외)
  assert.ok(defaultBoxMetrics('수국', '콜롬비아'));
  assert.strictEqual(defaultBoxMetrics('수국', '네덜란드'), null);

  // ── 4) 미설정 카테고리 잔여 배분 — 다른 카테고리엔 값이 있을 때 0 대신 GW/CW 잔여
  const resid = computeFreightCost({
    master: { warehouseKey: 3, gw: 1000, cw: 1000, exchangeRate: 1500, actualFreightUSD: 1000, itemCount: 2 },
    customs: {},
    details: [coRow(20, '카네이션', 50, 15000, 0.2), coRow(21, '미등록꽃', 25, 2500, 0.5)],
    productMeta: {}, flowerMeta: CO_FLOWER_META,
  });
  const unk = resid.categories.find((c) => c.flowerName === '미등록꽃');
  near(unk.boxWeight, (1000 - 50 * 11) / 25, 1e-9, '잔여 박스무게');
  near(unk.freightUSD, 1000 * 450 / 1000, 1e-6, '잔여 운임');
  assert.ok(resid.warnings.some((w) => /미등록꽃/.test(w.msg)), '잔여 배분 경고');

  // ── 5) 네덜란드 — 28-2 NL 원가자료: 엑셀 수기값(환율·항공료·통관합계)을 넣으면 34행 도착원가(송이) 전부 일치
  assert.strictEqual(nlExcelTariffRate('Eryngium Orion Blue 60cm'), 0.25);
  assert.strictEqual(nlExcelTariffRate('Grevillea Baileyana'), 0.08);
  assert.strictEqual(nlExcelTariffRate('Anthurium Graciosa 13cm'), 0);
  const nlDetails = NL_28_2.map(([name, qty, fob], i) => ({
    warehouseDetailKey: 100 + i, prodKey: 100 + i, prodName: name, flowerName: name.split(/[\s/]/)[0], counName: '네덜란드', outUnit: '송이',
    boxQty: 0, rawBoxQty: 1, bunchQty: qty, steamQty: qty, fobUSD: fob, totalPriceUSD: fob * qty, stemsPerBunch: 1,
  }));
  const nl = computeFreightCost({
    master: { warehouseKey: 4, gw: 503, cw: 559.1, rateUSD: 2.84, docFeeUSD: 50, exchangeRate: 1750, freightOverrideUSD: 1637.844, itemCount: 10 },
    customs: { extraFee: 938432.293413554 },
    details: nlDetails, productMeta: {}, flowerMeta: {},
  });
  assert.strictEqual(nl.header.allocationBasis, 'VALUE');
  near(nl.header.invoiceGoodsUSD, 5065.11, 1e-6, 'D6 인보이스 상품총액');
  NL_28_2.forEach(([name, , , M], i) => near(nl.rows[i].arrivalPerStem, M, 0.01, `NL ${name}`));
  // Anthurium 7,403 (수정 전 계산 4,827) — 운임이 FOB 에 비례
  near(nl.rows[0].freightPerStemUSD, 1637.844 * 2.96 / 5065.11, 1e-9);
  near(nl.rows.reduce((a, r) => a + r.freightPerStemUSD * r.steamQty, 0), 1637.844, 1e-6, 'NL 운임 합계 보존');
  near(nl.rows.reduce((a, r) => a + r.customsPerStem * r.steamQty, 0), 938432.293413554, 1e-4, 'NL 통관 합계 보존');
  // 표시단위 값도 같은 규칙 (송이 표시 = 송이당)
  near(nl.rows[0].displayArrivalKRW, 7403.4051, 0.01);

  // ERP 관세가 있으면 그 값이 우선 (Product.TariffRate 0 명시 → 엑셀 키워드 미적용)
  const nlTariff0 = computeFreightCost({
    master: { warehouseKey: 5, gw: 10, cw: 10, exchangeRate: 1750, freightOverrideUSD: 10, itemCount: 1 },
    customs: {}, details: [{ ...nlDetails[3], tariffRate: 0 }], productMeta: {}, flowerMeta: {},
  });
  assert.strictEqual(nlTariff0.rows[0].tariffRate, 0);

  // 네덜란드 외 국가 혼재 AWB 는 금액비율 미적용
  const mixedCountry = computeFreightCost({
    master: { warehouseKey: 6, gw: 100, cw: 100, exchangeRate: 1500, actualFreightUSD: 100, itemCount: 2 },
    customs: {}, details: [nlDetails[0], { ...coRow(30, '카네이션', 5, 1500, 0.2) }], productMeta: {}, flowerMeta: CO_FLOWER_META,
  });
  assert.notStrictEqual(mixedCountry.header.allocationBasis, 'VALUE');
  // 강제 지정
  const forced = computeFreightCost({
    master: { warehouseKey: 7, gw: 100, cw: 100, exchangeRate: 1500, actualFreightUSD: 100, itemCount: 1, allocationBasis: 'VALUE' },
    customs: {}, details: [coRow(40, '카네이션', 5, 1500, 0.2), coRow(41, '카네이션', 5, 1500, 0.6)], productMeta: {}, flowerMeta: CO_FLOWER_META,
  });
  near(forced.rows[1].freightPerStemUSD / forced.rows[0].freightPerStemUSD, 3, 1e-9, 'VALUE 강제 — FOB 비례');

  console.log('freightExcelAllocation: all passed');
}

main().catch((e) => { console.error(e); process.exit(1); });
