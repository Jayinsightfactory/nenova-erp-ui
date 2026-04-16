// lib/freightCalc.js — 운송기준원가 순수 계산 모듈
// DB/React 의존 없음. 서버 API와 클라이언트 실시간 재계산 공용.
// 16-1A 엑셀 실측값과 ±0.01 일치 검증됨.

/**
 * 키 정규화 — FlowerName 매칭용 (trim + uppercase).
 * Product.FlowerName 과 Flower.FlowerName 이 "CARNATION" / "카네이션" 섞일 수 있어서
 * 양쪽 다 한번 정규화 후 비교. null-safe.
 */
export function normalizeFlower(name) {
  if (!name) return '';
  return String(name).trim().toUpperCase();
}

/**
 * 품목 마스터에 SteamOf1Bunch 미설정시 사용할 업계 표준 단당 송이수.
 * 한국 꽃 수입 관례:
 *  - ROSE / 장미: 10 stems/bunch (박스당 20단 = 200송이가 표준)
 *  - CARNATION / 카네이션: 20 stems/bunch
 *  - 기타 소형: 10 stems/bunch 가 일반적
 */
const DEFAULT_STEMS_PER_BUNCH_BY_FLOWER = {
  'ROSE': 10, '장미': 10,
  'CARNATION': 20, '카네이션': 20,
  'MINICARNATION': 20, 'MINI CARNATION': 20, 'SPRAY CARNATION': 10,
  'LISIANTHUS': 10, 'EUSTOMA': 10, '리시안': 10, '유스토마': 10,
  'LIMONIUM': 10, '리모늄': 10,
  'GYPSOPHILA': 10, '안개꽃': 10,
  'EUCALYPTUS': 10, '유칼립투스': 10,
  'ASPARAGUS': 10, '아스파라거스': 10,
  'CHRYSANTHEMUM': 10, '국화': 10,
  'LILY': 5, 'LILIUM': 5, '백합': 5,
  'ALSTROEMERIA': 10, '알스트로에미리아': 10,
  'TULIP': 10, '튤립': 10,
  'FREESIA': 10, '프리지아': 10,
  'STATICE': 10, '스타티스': 10,
  'SOLIDAGO': 10, '솔리다고': 10,
  'MATRICARIA': 10,
};
const DEFAULT_FALLBACK_STEMS_PER_BUNCH = 10;  // 완전 미매칭시 업계 최빈값

/**
 * FlowerName / ProdName 을 기반으로 기본 단당 송이수 추정.
 * 정확 매칭 → 부분 매칭(키워드 포함) → 공통 기본값(10) 순서.
 */
export function getDefaultStemsPerBunch(name) {
  if (!name) return DEFAULT_FALLBACK_STEMS_PER_BUNCH;
  const key = normalizeFlower(name);
  if (DEFAULT_STEMS_PER_BUNCH_BY_FLOWER[key] != null) return DEFAULT_STEMS_PER_BUNCH_BY_FLOWER[key];
  // 부분 매칭 — 길이 긴 키워드부터 검사해서 MINICARNATION 이 CARNATION 에 오탐되지 않게
  const keys = Object.keys(DEFAULT_STEMS_PER_BUNCH_BY_FLOWER).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (key.includes(k)) return DEFAULT_STEMS_PER_BUNCH_BY_FLOWER[k];
  }
  return DEFAULT_FALLBACK_STEMS_PER_BUNCH;
}

/**
 * 해당 FarmName 이 항공사/운송사 인보이스인지 판별.
 * FREIGHTWISE, FREIGHT, FORWARDER 등 키워드 포함시 꽃 집계에서 제외되고
 * TPrice 는 항공료 실제 금액으로 사용됨.
 */
export function isFreightForwarder(farmName) {
  if (!farmName) return false;
  const n = String(farmName).trim().toUpperCase();
  return /FREIGHT|FORWARD|AIRFREIGHT|카고|운송사/.test(n);
}

const APPROX = (a, b, tol = 0.5) => Math.abs((a || 0) - (b || 0)) < tol;

/**
 * 핵심 계산 함수.
 *
 * @param {object} input
 * @param {object} input.master  { warehouseKey, gw, cw, rateUSD, docFeeUSD, exchangeRate, invoiceUSD, itemCount, actualFreightUSD? }
 *   - actualFreightUSD (optional): FREIGHTWISE 같은 운송사 인보이스에서 확정된 실제 항공료. 있으면 Rate*CW+DocFee 대신 이 값을 사용.
 * @param {string} input.basis   'GW' | 'CBM' | 'AUTO' (AUTO: GW≈CW면 GW, 아니면 CBM)
 * @param {object} input.customs { bakSangRate, handlingFee, quarantinePerItem, domesticFreight, deductFee, extraFee }
 * @param {Array}  input.details [{ warehouseDetailKey, prodKey, prodName, flowerName, farmName, boxQty, steamQty, fobUSD, stemsPerBunch, salePriceKRW, tariffRate }]
 * @param {Map|object} input.productMeta Map<prodKey, { boxWeight, boxCBM, tariffRate }>
 * @param {Map|object} input.flowerMeta  Map<normalizedFlowerName, { boxWeight, boxCBM, stemsPerBox, defaultTariff }>
 *
 * @returns {object} { header, categories, rows, totals, warnings }
 */
export function computeFreightCost({ master, basis = 'AUTO', customs = {}, details = [], productMeta, flowerMeta }) {
  const warnings = [];

  // ── 정규화 헬퍼
  const pMeta = productMeta instanceof Map ? productMeta : new Map(Object.entries(productMeta || {}).map(([k,v]) => [Number(k), v]));
  const fMeta = flowerMeta instanceof Map ? flowerMeta : new Map(Object.entries(flowerMeta || {}).map(([k,v]) => [normalizeFlower(k), v]));

  // ── Step 1: 마스터 기본값
  const gw = Number(master.gw) || 0;
  const cw = Number(master.cw) || 0;
  const rate = Number(master.rateUSD) || 0;
  const docFee = Number(master.docFeeUSD) || 0;
  const exRate = Number(master.exchangeRate) || 0;

  // 무게기준 판정
  let useBasis = basis;
  if (basis === 'AUTO') useBasis = APPROX(gw, cw, 0.5) ? 'GW' : 'CBM';

  if (gw <= 0 || cw <= 0) warnings.push({ level: 'error', msg: 'GW/CW 가 0 입니다. 입고 원장에서 확인하세요.' });
  if (rate <= 0) warnings.push({ level: 'error', msg: 'Rate (USD/kg) 이 0 입니다.' });
  if (exRate <= 0) warnings.push({ level: 'error', msg: '환율이 0 입니다.' });

  // ── Step 2: 항공료(USD)
  // actualFreightUSD (FREIGHTWISE 실제 인보이스) 있으면 그 값 사용, 없으면 Rate*CW + DocFee 계산
  const freightTransportUSD = rate * cw;                          // G11 = E9 * E8
  const freightComputedUSD = freightTransportUSD + docFee;         // C11 = E11 + G11 (계산값)
  const actualFreight = Number(master.actualFreightUSD) || 0;
  const freightTotalUSD = actualFreight > 0 ? actualFreight : freightComputedUSD;
  const freightSource = actualFreight > 0 ? 'ACTUAL' : 'COMPUTED';

  // ── Step 3: 통관비(KRW) — 품목수는 distinct flower count
  const itemCount = Number(master.itemCount) || 0;
  const c = {
    bakSangRate: Number(customs.bakSangRate || 0),
    handlingFee: Number(customs.handlingFee || 0),
    quarantinePerItem: Number(customs.quarantinePerItem || 0),
    domesticFreight: Number(customs.domesticFreight || 0),
    deductFee: Number(customs.deductFee || 0),
    extraFee: Number(customs.extraFee || 0),
  };
  const customsBakSang = gw * c.bakSangRate;                // P6
  const customsQuarantine = itemCount * c.quarantinePerItem; // P8
  const customsTotalKRW = customsBakSang + c.handlingFee + customsQuarantine + c.domesticFreight + c.deductFee + c.extraFee;

  // ── Step 4: 행별 resolved 박스무게/CBM/관세 + 카테고리 집계
  const bucket = new Map(); // key = normalized flower name
  const rowsResolved = details.map(d => {
    const fnKey = normalizeFlower(d.flowerName);
    const pm = pMeta.get(d.prodKey) || {};
    const fm = fMeta.get(fnKey) || {};
    const boxWeight = firstNonNull(pm.boxWeight, fm.boxWeight);
    const boxCBM = firstNonNull(pm.boxCBM, fm.boxCBM);
    const stemsPerBox = firstNonNull(fm.stemsPerBox, null);
    const tariffRate = firstNonNull(d.tariffRate, pm.tariffRate, fm.defaultTariff, 0);
    // 단당 송이수 effective 값 — Product.SteamOf1Bunch 가 0/null 이면 꽃 카테고리별 업계 표준값 사용
    const spbProdRaw = Number(d.stemsPerBunch) || 0;
    let effStemsPerBunch = spbProdRaw;
    let stemsPerBunchSource = 'db';
    if (effStemsPerBunch <= 0) {
      effStemsPerBunch = getDefaultStemsPerBunch(d.flowerName || d.prodName);
      stemsPerBunchSource = 'default';
    }

    // 송이수 fallback — 매 재계산마다 수행해서 flowerMeta 가 바뀌면(catEditing) 즉시 반영됨.
    // 우선순위: d.steamQty > bunchQty × effStemsPerBunch(기본값 포함) > rawBoxQty × stemsPerBox
    let steamQty = Number(d.steamQty) || 0;
    let steamQtySource = 'db';                     // 'db' | 'bunch' | 'bunch_default' | 'box' | 'unresolved'
    if (steamQty <= 0) {
      const bq = Number(d.bunchQty) || 0;
      if (bq > 0 && effStemsPerBunch > 0) {
        steamQty = bq * effStemsPerBunch;
        steamQtySource = stemsPerBunchSource === 'db' ? 'bunch' : 'bunch_default';
      } else {
        const rbq = Number(d.rawBoxQty) || 0;
        const spb = Number(stemsPerBox) || 0;
        if (rbq > 0 && spb > 0) {
          steamQty = rbq * spb;
          steamQtySource = 'box';
        } else if (rbq > 0) {
          // 박스만 있고 박스당송이 미설정 — 추정치 너무 큼 (카테고리마다 200~1000 편차)
          // 일단 단당송이 × 박스당단수(기본 20) 로 근사: rbq × 20 × effStemsPerBunch
          steamQty = rbq * 20 * effStemsPerBunch;
          steamQtySource = 'box_default';
        } else {
          steamQtySource = 'unresolved';
        }
      }
    }
    return { ...d, steamQty, stemsPerBunch: effStemsPerBunch, _fnKey: fnKey, _boxWeight: boxWeight, _boxCBM: boxCBM, _stemsPerBox: stemsPerBox, _tariffRate: tariffRate, _steamQtySource: steamQtySource, _stemsPerBunchSource: stemsPerBunchSource };
  });

  // 기본값이 사용된 품목이 있으면 안내 (경고 레벨, 차단 아님)
  const defaultBunchRows = rowsResolved.filter(r => r._stemsPerBunchSource === 'default');
  if (defaultBunchRows.length > 0) {
    const names = defaultBunchRows.slice(0, 3).map(r => r.prodName || `ProdKey ${r.prodKey}`).join(', ');
    const extra = defaultBunchRows.length > 3 ? ` 외 ${defaultBunchRows.length - 3}건` : '';
    warnings.push({ level: 'warn', msg: `단당송이 미설정 → 카테고리 업계 표준값으로 자동 계산 중: ${names}${extra}. 정확한 값은 품목 마스터 > SteamOf1Bunch 에 설정하세요.` });
  }
  // 박스만 있고 박스당송이/단당송이 모두 미매칭 — 완전 해결 불가 케이스
  const unresolvedRows = rowsResolved.filter(r => r._steamQtySource === 'unresolved');
  if (unresolvedRows.length > 0) {
    const names = unresolvedRows.slice(0, 3).map(r => r.prodName || `ProdKey ${r.prodKey}`).join(', ');
    const extra = unresolvedRows.length > 3 ? ` 외 ${unresolvedRows.length - 3}건` : '';
    warnings.push({ level: 'error', msg: `수량/단수/박스수 모두 0: ${names}${extra}` });
  }

  for (const r of rowsResolved) {
    const k = r._fnKey || '__UNCATEGORIZED__';
    if (!bucket.has(k)) {
      bucket.set(k, { flowerName: r.flowerName || '미분류', _key: k, boxCount: 0, stemsCount: 0, boxWeight: r._boxWeight, boxCBM: r._boxCBM, stemsPerBox: r._stemsPerBox });
    }
    const b = bucket.get(k);
    b.boxCount += Number(r.boxQty) || 0;
    // 카테고리 대표 박스무게/CBM: 첫 행 기준 (모든 행이 같다고 가정 — 엑셀과 동일). 다르면 warning.
    if (r._boxWeight != null && b.boxWeight != null && r._boxWeight !== b.boxWeight) {
      warnings.push({ level: 'warn', msg: `[${b.flowerName}] 품목별 박스무게 차이(${b.boxWeight} vs ${r._boxWeight}) — 첫 값 사용` });
    }
  }

  // ── Step 5: 카테고리별 송이수 계산 (stemsPerBox × boxCount, 0이면 행별 steamQty 합산으로 fallback)
  let denomWeight = 0;
  let denomCBM = 0;
  for (const b of bucket.values()) {
    const baseCount = (Number(b.stemsPerBox) || 0) * b.boxCount;
    if (baseCount > 0) {
      b.stemsCount = baseCount;
    } else {
      // Flower.StemsPerBox 미설정 → 이 카테고리 행별 steamQty(기본값 포함) 합산
      b.stemsCount = rowsResolved
        .filter(r => (r._fnKey || '__UNCATEGORIZED__') === b._key)
        .reduce((a, r) => a + (Number(r.steamQty) || 0), 0);
    }
    denomWeight += (Number(b.boxWeight) || 0) * b.boxCount;
    denomCBM += (Number(b.boxCBM) || 0) * b.boxCount;
  }
  if (denomWeight <= 0 && useBasis === 'GW') warnings.push({ level: 'error', msg: '무게 기반 분모가 0 입니다. 카테고리 박스무게 설정 확인.' });
  if (denomCBM <= 0 && useBasis === 'CBM') warnings.push({ level: 'error', msg: 'CBM 기반 분모가 0 입니다.' });

  // ── Step 6: 카테고리별 비율/운임/통관
  for (const b of bucket.values()) {
    const wRatio = denomWeight > 0 ? (Number(b.boxWeight) || 0) * b.boxCount / denomWeight : 0;
    const cRatio = denomCBM > 0 ? (Number(b.boxCBM) || 0) * b.boxCount / denomCBM : 0;
    b.weightRatio = wRatio;
    b.cbmRatio = cRatio;
    b.usedRatio = useBasis === 'GW' ? wRatio : cRatio;
    b.freightUSD = freightTotalUSD * b.usedRatio;           // K
    b.customsKRW = customsTotalKRW * b.usedRatio;           // T
    b.freightPerStemUSD = b.stemsCount > 0 ? b.freightUSD / b.stemsCount : 0;   // M
    b.customsPerStemKRW = b.stemsCount > 0 ? b.customsKRW / b.stemsCount : 0;   // U
    if (b.boxCount > 0 && b.stemsCount === 0) {
      warnings.push({ level: 'warn', msg: `[${b.flowerName}] 박스당 송이수 미설정 — 송이당 운임/통관 계산 불가` });
    }
  }

  // ── Step 7: 행별 도착원가/이익 계산
  const rows = rowsResolved.map(r => {
    const b = bucket.get(r._fnKey || '__UNCATEGORIZED__') || {};
    const G = Number(b.freightPerStemUSD) || 0;                       // 운송비/송이 USD
    const F = Number(r.fobUSD) || 0;
    const H = F + G;                                                   // CNF/송이 USD
    const J = H * exRate;                                              // CNF/송이 KRW
    const tariffRate = Number(r._tariffRate) || 0;
    const K = J * tariffRate;                                          // 관세 KRW/송이
    const L = Number(b.customsPerStemKRW) || 0;                        // 그외통관 KRW/송이
    const M = J + K + L;                                               // 도착원가 KRW/송이
    const N = Number(r.stemsPerBunch) || 0;                            // 단당 송이
    const Q = Number(r.salePriceKRW) || 0;                             // 판매가(VAT포함)
    const E = Number(r.steamQty) || 0;                                 // 수량(송이)

    const O = N > 0 ? M * N : null;                                    // 도착원가/단
    const P = Q > 0 ? Q / 1.1 : null;                                  // 판매가(VAT별도)
    const R = O != null ? O / 0.77 : null;                             // 15% 이익가
    const S = (P != null && O != null) ? P - O : null;                 // 단이익
    const T = (S != null && P && P !== 0) ? S / P : null;              // 이익률
    const U = (P != null && N > 0) ? P * E / N : null;                 // 종 판매가
    const V = (S != null && N > 0) ? E * S / N : null;                 // 종이익

    return {
      warehouseDetailKey: r.warehouseDetailKey ?? null,
      prodKey: r.prodKey,
      prodName: r.prodName,
      flowerName: r.flowerName,
      farmName: r.farmName,
      boxQty: Number(r.boxQty) || 0,
      rawBoxQty: Number(r.rawBoxQty) || 0,               // 행별 박스수 (DB 원본, 표시용)
      bunchQty: Number(r.bunchQty) || 0,                 // 행별 단수 (DB 원본, 표시용)
      steamQty: E,
      steamQtySource: r._steamQtySource,                 // 'db'|'bunch'|'bunch_default'|'box'|'box_default'|'unresolved' — UI 표시용
      stemsPerBunchSource: r._stemsPerBunchSource,       // 'db'|'default' — UI 표시용
      fobUSD: F,
      totalPriceUSD: Number(r.totalPriceUSD) || 0,       // DB TPrice (표시용)
      boxWeightUsed: r._boxWeight,
      boxCBMUsed: r._boxCBM,
      stemsPerBoxUsed: r._stemsPerBox,
      stemsPerBunch: N,
      salePriceKRW: Q,
      tariffRate,
      // 계산 결과
      freightPerStemUSD: G,
      cnfUSD: H,
      cnfKRW: J,
      tariffKRW: K,
      customsPerStem: L,
      arrivalPerStem: M,
      arrivalPerBunch: O,
      salePriceExVAT: P,
      saleAt15Profit: R,
      profitPerBunch: S,
      profitRate: T,
      totalSaleKRW: U,
      totalProfitKRW: V,
    };
  });

  // ── Step 8: 합계
  const totalSaleKRW = rows.reduce((a, r) => a + (r.totalSaleKRW || 0), 0);
  const totalProfitKRW = rows.reduce((a, r) => a + (r.totalProfitKRW || 0), 0);
  const overallProfitRate = totalSaleKRW > 0 ? totalProfitKRW / totalSaleKRW : 0;

  return {
    header: {
      warehouseKey: master.warehouseKey,
      gw, cw, rateUSD: rate, docFeeUSD: docFee, exchangeRate: exRate,
      invoiceUSD: Number(master.invoiceUSD) || 0,
      itemCount,
      freightTotalUSD,          // 실제 사용된 항공료 (ACTUAL 우선)
      freightComputedUSD,       // Rate * CW + DocFee 계산값
      actualFreightUSD: actualFreight || null,  // FREIGHTWISE 실제 인보이스
      freightSource,            // 'ACTUAL' | 'COMPUTED'
      customsTotalKRW,
      basis: useBasis,
      customs: c,
    },
    categories: [...bucket.values()].map(b => ({
      flowerName: b.flowerName,
      boxCount: b.boxCount,
      boxWeight: b.boxWeight,
      boxCBM: b.boxCBM,
      stemsPerBox: b.stemsPerBox,
      stemsCount: b.stemsCount,
      weightRatio: b.weightRatio,
      cbmRatio: b.cbmRatio,
      usedRatio: b.usedRatio,
      freightUSD: b.freightUSD,
      customsKRW: b.customsKRW,
      freightPerStemUSD: b.freightPerStemUSD,
      customsPerStemKRW: b.customsPerStemKRW,
    })),
    rows,
    totals: { totalSaleKRW, totalProfitKRW, overallProfitRate },
    warnings,
  };
}

function firstNonNull(...vals) {
  for (const v of vals) if (v != null && v !== '' && !Number.isNaN(Number(v))) return Number(v);
  return null;
}
