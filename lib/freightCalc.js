// lib/freightCalc.js — 운송기준원가 순수 계산 모듈
// DB/React 의존 없음. 서버 API와 클라이언트 실시간 재계산 공용.
// 16-1A 엑셀 실측값과 ±0.01 일치 검증됨.
import { COUNTRY_CURRENCY_MAP, countryToCurrency } from './countryClassification.js';

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
 * 국가 → 인보이스 통화 매핑 (한글 국가명 기준 + 영문 별칭 정규화).
 * CurrencyMaster 에 등록된 통화만 실제 환율 조회 가능.
 * 한 BILL 안에 여러 국가가 섞여 있으면 품목 수가 가장 많은 국가의 통화로 기본 제안.
 *
 * 2026-08-11 결함수정: 호주가 'USD'로 잘못 매핑되어 있었다(정답은 'AUD' — fixture 27차 AUD R=1068.23 등
 * 실측 확인). 국가 키 목록/영문 별칭 매칭은 lib/customsForwarding.js baseCountry() 와 동일 규칙을
 * 쓰도록 lib/countryClassification.js 로 단일화했다.
 */
export { COUNTRY_CURRENCY_MAP, countryToCurrency };

/**
 * 여러 행에서 가장 빈도 높은 통화 계산 (대표 통화).
 * rows: [{ counName, ... }]
 */
export function detectInvoiceCurrency(rows) {
  if (!rows || rows.length === 0) return 'USD';
  const counter = {};
  for (const r of rows) {
    const ccy = countryToCurrency(r.counName || r.CounName);
    counter[ccy] = (counter[ccy] || 0) + 1;
  }
  return Object.entries(counter).sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * ProdName 키워드로 올바른 FlowerName 카테고리 자동 감지.
 * "기타" 나 빈값이면 ProdName 에서 리모늄/장미/카네이션 등 키워드 검색.
 * 이미 유효한 카테고리가 설정되어 있으면 그대로 반환.
 *
 * 우선순위: 더 구체적인 키워드 먼저 (Spray Carnation > Carnation, Minicarnation > Carnation 등)
 */
const FLOWER_NAME_PATTERNS = [
  // [정규식, 정식카테고리]
  [/SPRAY\s*CARNATION|스프레이\s*카네이션/i, '카네이션'],
  [/MINI\s*CARNATION|MINICARNATION|미니\s*카네이션|미니카네이션/i, '미니카네이션'],
  [/CARNATION|카네이션/i, '카네이션'],
  [/ROSE|장미/i, '장미'],
  [/LIMONIUM|리모늄|리모니움/i, '리모니움'],
  [/EUCALYPTUS|유칼립투스/i, '유칼립투스'],
  [/LISIANTHUS|EUSTOMA|리시안|유스토마/i, '리시안서스'],
  [/GYPSOPHILA|안개꽃|안개/i, '안개꽃'],
  [/ASPARAGUS|아스파라거스/i, '아스파라거스'],
  [/ALSTROMERIA|ALSTROEMERIA|알스트로/i, '알스트로'],
  [/CHRYSANTHEMUM|소국/i, '소국'],
  [/LILIUM|LILY|릴리|백합/i, '릴리'],
  [/TULIP|튤립/i, '튤립'],
  [/FREESIA|프리지아/i, '프리지아'],
  [/RUSCUS|루스커스/i, '루스커스'],
  [/ORCHID|호접난/i, '호접난 Orchid'],
  [/HYDRANGEA|수국/i, '수국'],
  [/STATICE|스타티스/i, '스타티스'],
  [/WAX\s*FLOWER|왁스\s*플라워/i, '왁스'],
  [/PROTEA|프로테아/i, '프로테아'],
  [/SOLIDAGO|솔리다고/i, '소국'],
  [/ANEMONE|아네모네/i, '아네모네'],
];

export function autoDetectFlower(prodName, currentFlowerName) {
  const current = (currentFlowerName || '').trim();
  // "기타" / "미분류" / 빈 값일 때만 재분류 (정상 카테고리는 유지)
  if (current && current !== '기타' && current !== '미분류') return current;
  if (!prodName) return current;
  for (const [re, cat] of FLOWER_NAME_PATTERNS) {
    if (re.test(String(prodName))) return cat;
  }
  return current;
}

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

/**
 * 입고원장 내 품목(ProdName)이 운송료/항공료 행인지 판별.
 * 같은 농장(예: Yunnan Melody) 원장 안에 "운송료" 행으로 항공료가 들어온 경우 감지.
 * 꽃 집계에서 제외되고 TPrice 를 항공료 실제 금액으로 사용.
 */
export function isFreightItem(prodName) {
  if (!prodName) return false;
  const n = String(prodName).trim().toUpperCase();
  return /^운송료$|^운송비$|^항공료$|^항공비$|^FREIGHT$|^AIR\s*FREIGHT$|^SHIPPING/.test(n)
    || /운송료|운송비|항공료|항공비/.test(n)
    || /^GROSS\s*WEIG[H]?T[H]?$/.test(n)         // Gross weight / Gross weigth (오타 포함)
    || /^CHARGEABLE\s*WEIG[H]?T[H]?$/.test(n);   // Chargeable weight / Chargeable weigth
}

/**
 * 행 수준 freight 판별 — FarmName 또는 ProdName 중 하나라도 해당되면 true.
 */
export function isFreightRow(row) {
  return isFreightForwarder(row.FarmName || row.farmName) || isFreightItem(row.ProdName || row.prodName) || isOrphanZeroRow(row);
}

/** 품목 없는(ProdKey·품명 모두 없음) 금액 0 상세행 — 38-01 Apollo 혼적 AWB 의 GW/CW 중복 입력 잔재(ProdKey NULL,
 * Steam 15296/15582). 꽃 행으로 취급하면 '미분류' 2박스가 잔여 CBM(226/박스)을 받아 항공료 2.9%를 가져갔다. */
export function isOrphanZeroRow(row) {
  const pk = row.ProdKey ?? row.prodKey;
  const name = String(row.ProdName ?? row.prodName ?? '').trim();
  const amount = Number(row.TPrice ?? row.totalPriceUSD ?? 0) || 0;
  return (pk == null || pk === '') && !name && !(Math.abs(amount) > 0);
}

/** 운송기준원가 통관 상수 기본값(FreightCost 스냅샷 없을 때). 콜롬비아 원가자료 P7·P8·P9·R6 과 같은 값.
 * 네덜란드(NL 원가자료 24-2~37-2 18개 시트): 국내 운송비 Q9=90,000(18/18), 소독비 S7=220,000(17/18, 37-2만 0),
 * 검역차감 S6 은 검역 샘플 송이×단가 표(수기)라 기본값 0 — 콜롬비아 겸역차감 40,000 을 쓰지 않는다. */
export const FREIGHT_DEFAULT_CUSTOMS = Object.freeze({
  bakSangRate: 460, handlingFee: 33000, quarantinePerItem: 10000, domesticFreight: 99000, deductFee: 40000, extraFee: 0,
});
export const NL_FREIGHT_DEFAULT_CUSTOMS = Object.freeze({ ...FREIGHT_DEFAULT_CUSTOMS, domesticFreight: 90000, deductFee: 0, extraFee: 220000 });
export function defaultFreightCustoms(countryNames = []) {
  const names = (countryNames || []).map((c) => String(c || '').trim()).filter(Boolean);
  return names.length > 0 && names.every(isNetherlandsCountry) ? { ...NL_FREIGHT_DEFAULT_CUSTOMS } : { ...FREIGHT_DEFAULT_CUSTOMS };
}

/** GW/CW 특수 품목행 이름 판별 */
export function isGrossWeightItem(prodName) {
  return /^\s*gross\s*weig[h]?t[h]?\s*$/i.test(String(prodName || '').trim());
}

export function isChargeableWeightItem(prodName) {
  return /^\s*chargeable\s*weig[h]?t[h]?\s*$/i.test(String(prodName || '').trim());
}

/**
 * GW/CW 특수행에서 무게(kg) 추출.
 * Box/Bunch/Steam/OutQuantity 중 1보다 큰 최대값 (더미 1은 스킵).
 * Cloudland 등 일부 BILL은 OutQuantity 에만 무게가 들어 있음.
 */
export function freightWeightOfRow(row) {
  if (!row) return 0;
  const vals = [
    Number(row.BoxQuantity ?? row.boxQty) || 0,
    Number(row.BunchQuantity ?? row.bunchQty) || 0,
    Number(row.SteamQuantity ?? row.steamQty) || 0,
    Number(row.OutQuantity ?? row.outQty) || 0,
  ];
  const realVals = vals.filter(v => v > 1);
  return realVals.length > 0 ? Math.max(...realVals) : 0;
}

const APPROX = (a, b, tol = 0.5) => Math.abs((a || 0) - (b || 0)) < tol;

/**
 * 2026-09-30 수국 운임 0 사고 — 콜롬비아 혼적 AWB(카네이션·장미·알스트로·루스커스 + 수국 한 OrderNo)에서
 * 수국은 Flower/Product BoxWeight·BoxCBM 이 비어 있어 무게/CBM 비율 0 → 운임·통관 0원으로 계산됐다.
 * 엑셀 '수국 원가자료' 는 수국 단독 AWB 로 항공료÷총송이 이므로, 혼적 AWB 에서는 수국 박스당 GW/CW 를
 * 수국 단독 AWB 실측(20~39차 31건, ERP GW/CW÷박스수 중앙값 GW 5.5kg · CW 6.6)으로 보강한다.
 * (콜롬비아 원가자료 엑셀의 '박스당 CBM' 열은 CW 성격 값: ROSE 10 · CARNATION 9 · ALSTRO 7 · RUSCUS 9.6)
 * Flower/Product 마스터에 값이 입력되면 그 값이 우선한다.
 */
const DEFAULT_BOX_METRICS_BY_FLOWER = {
  '수국': { boxWeight: 5.5, boxCBM: 6.7, country: /콜롬비아|colombia/i },
  'HYDRANGEA': { boxWeight: 5.5, boxCBM: 6.7, country: /콜롬비아|colombia/i },
};

export function defaultBoxMetrics(flowerName, countryName) {
  const d = DEFAULT_BOX_METRICS_BY_FLOWER[normalizeFlower(flowerName)];
  if (!d) return null;
  const country = String(countryName || '').trim();
  if (country && !d.country.test(country)) return null;
  return { boxWeight: d.boxWeight, boxCBM: d.boxCBM };
}

/**
 * NL 원가자료 엑셀 관세표(J6:M11 — 24~37차 NL 시트 전부 동일) — 품명 SEARCH(대소문자 무시) 첫 일치 세율.
 * ERP(Product.TariffRate / Flower.DefaultTariff)에 관세가 없을 때만 네덜란드 품목에 적용한다.
 */
const NL_TARIFF_KEYWORDS = [
  ['Eryngium', 0.25], ['Clematis', 0.25], ['Grevillea', 0.08], ['Kangoroo paw Red', 0.25],
  ['Delphinium no NL', 0.25], ['Cordyline ', 0.08],
  ['Colombia', 0.25], ['Africa', 0.25], ['Israel ', 0.08], ['Sanguisorba', 0.25],
];
export function nlExcelTariffRate(prodName) {
  const n = String(prodName || '').toLowerCase();
  for (const [kw, rate] of NL_TARIFF_KEYWORDS) if (n.includes(kw.toLowerCase())) return rate;
  return 0;
}

export function isNetherlandsCountry(countryName) {
  return /네덜란드|netherlands|holland|^nl$/i.test(String(countryName || '').trim());
}

/**
 * 입고 라인 상품단가(USD) 단위 정규화 — 2026-09-30 운송기준원가 UPrice 단위 사고.
 * WarehouseDetail.UPrice 는 품목·농장마다 송이당/단당/박스당이 섞여 있다
 * (콜롬비아 장미 ROSE Candlelight: UPrice 0.5 = 송이당, TPrice 50 = 0.5×100송이 → 표시단위 '단'에 0.5를 쓰면 1/10).
 * TPrice(라인 총액)가 유일하게 단위가 확정된 값이므로 표시단위·송이당 단가를 TPrice÷수량으로 역산한다.
 *   perDisplay = TPrice ÷ 표시단위 수량(박스/단/송이) — 없으면 송이당 × 표시단위당 송이수
 *   perStem    = TPrice ÷ 송이수(DB) — 없으면 perDisplay ÷ 표시단위당 송이수
 * TPrice/수량이 없거나 사용자가 FOB 를 수기 지정(fobOverridden)하면 기존대로 UPrice 를 그대로 쓴다.
 * upriceUnit: UPrice×수량 ≈ TPrice 가 되는 수량 열로 판정한 UPrice 의 실제 단위(진단 표시용).
 */
export function resolveRowGoodsPriceUSD({
  fobUSD, totalPriceUSD, displayUnit, displayQty, stemQty, stemQtyFromDb = true,
  bunchQty, boxQty, stemsPerBunch, stemsPerBox, fobOverridden = false,
} = {}) {
  const F = Number(fobUSD) || 0;
  const T = Number(totalPriceUSD) || 0;
  const dq = Number(displayQty) || 0;
  const E = Number(stemQty) || 0;
  const N = Number(stemsPerBunch) || 0;
  const bx = Number(boxQty) || 0;
  const spbx = Number(stemsPerBox) || (bx > 0 && E > 0 && stemQtyFromDb ? E / bx : 0);
  const stemsPerDisplay = displayUnit === '박스' ? spbx : displayUnit === '단' ? N : 1;

  const near = (q) => q > 0 && T > 0 && F > 0 && Math.abs(F * q - T) <= Math.max(0.02 * T, 0.01);
  let upriceUnit = null;
  if (near(E)) upriceUnit = '송이';
  else if (near(Number(bunchQty) || 0)) upriceUnit = '단';
  else if (near(bx)) upriceUnit = '박스';

  if (fobOverridden || !(T > 0)) {
    return { perDisplay: F, perStem: F, basis: fobOverridden ? 'uprice-override' : 'uprice', upriceUnit };
  }
  let perDisplay = null;
  let perStem = null;
  let basis = null;
  if (dq > 0) {
    perDisplay = T / dq;
    basis = 'tprice-display';
    if (E > 0 && stemQtyFromDb) perStem = T / E;
    else if (stemsPerDisplay > 0) perStem = perDisplay / stemsPerDisplay;
    else if (E > 0) perStem = T / E;
  } else if (E > 0) {
    perStem = T / E;
    basis = 'tprice-stem';
    if (stemsPerDisplay > 0) perDisplay = perStem * stemsPerDisplay;
  }
  if (perDisplay == null && perStem == null) return { perDisplay: F, perStem: F, basis: 'uprice', upriceUnit };
  if (perDisplay == null) { perDisplay = F; basis = 'tprice-stem+uprice'; }
  if (perStem == null) perStem = F;
  return { perDisplay, perStem, basis, upriceUnit };
}

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
  // 우선순위: freightOverrideUSD(사용자 수동) > actualFreightUSD(FREIGHTWISE 인보이스) > Rate*CW + DocFee 계산
  const freightTransportUSD = rate * cw;                          // G11 = E9 * E8
  const freightComputedUSD = freightTransportUSD + docFee;         // C11 = E11 + G11 (계산값)
  const actualFreight = Number(master.actualFreightUSD) || 0;
  const overrideFreight = (master.freightOverrideUSD != null && master.freightOverrideUSD !== '' && !Number.isNaN(Number(master.freightOverrideUSD))) ? Number(master.freightOverrideUSD) : null;
  const freightTotalUSD = overrideFreight != null ? overrideFreight : (actualFreight > 0 ? actualFreight : freightComputedUSD);
  const freightSource = overrideFreight != null ? 'MANUAL' : (actualFreight > 0 ? 'ACTUAL' : 'COMPUTED');

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
    const dm = defaultBoxMetrics(d.flowerName, d.counName) || {};
    const boxWeight = firstNonNull(pm.boxWeight, fm.boxWeight, dm.boxWeight);
    const boxCBM = firstNonNull(pm.boxCBM, fm.boxCBM, dm.boxCBM);
    // 마스터(Product/Flower) 값이 비어 웹 기본값(수국 CBM 6.7·GW 5.5 — 원가자료 엑셀 박스당 무게·CBM 표)이 적용됐는지 — 화면 배지용
    const boxMetricDefault = (dm.boxCBM != null && firstNonNull(pm.boxCBM, fm.boxCBM) == null) || (dm.boxWeight != null && firstNonNull(pm.boxWeight, fm.boxWeight) == null);
    const stemsPerBox = firstNonNull(fm.stemsPerBox, null);
    const erpTariff = firstNonNull(d.tariffRate, pm.tariffRate, fm.defaultTariff);
    // ERP 관세 없음 + 네덜란드 → NL 원가자료 엑셀 품명 키워드 관세표
    const tariffRate = erpTariff != null ? erpTariff : (isNetherlandsCountry(d.counName) ? nlExcelTariffRate(d.prodName) : 0);
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
    return { ...d, steamQty, stemsPerBunch: effStemsPerBunch, _fnKey: fnKey, _boxWeight: boxWeight, _boxCBM: boxCBM, _boxMetricDefault: boxMetricDefault, _stemsPerBox: stemsPerBox, _tariffRate: tariffRate, _steamQtySource: steamQtySource, _stemsPerBunchSource: stemsPerBunchSource, _outUnit: (d.outUnit || '').trim() };
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
      bucket.set(k, {
        flowerName: r.flowerName || '미분류', _key: k,
        boxCount: 0, bunchCount: 0, stemsCount: 0,
        boxWeight: r._boxWeight, boxCBM: r._boxCBM, stemsPerBox: r._stemsPerBox,
        boxMetricSource: r._boxMetricDefault ? 'web_default' : 'master',
        countryName: r.counName || null,
        _outUnitCounter: {},
      });
    }
    const b = bucket.get(k);
    b.boxCount += Number(r.boxQty) || 0;
    b.bunchCount += Number(r.bunchQty) || 0;
    if (!b.countryName && r.counName) b.countryName = r.counName;
    // OutUnit 빈도 누적 — 카테고리 displayUnit 결정용 (최빈값)
    const ou = r._outUnit;
    if (ou) b._outUnitCounter[ou] = (b._outUnitCounter[ou] || 0) + 1;
    // 카테고리 대표 박스무게/CBM: 첫 행 기준 (모든 행이 같다고 가정 — 엑셀과 동일). 다르면 warning.
    if (r._boxWeight != null && b.boxWeight != null && r._boxWeight !== b.boxWeight) {
      warnings.push({ level: 'warn', msg: `[${b.flowerName}] 품목별 박스무게 차이(${b.boxWeight} vs ${r._boxWeight}) — 첫 값 사용` });
    }
  }

  // ── Step 5: 카테고리별 송이수 계산 (stemsPerBox × boxCount, 0이면 행별 steamQty 합산으로 fallback)
  let denomWeight = 0;
  let denomCBM = 0;
  for (const b of bucket.values()) {
    // 콜롬비아(박스 기준) 카테고리: BoxQuantity=0 으로 입고된 행(장미 Construnorte/Maxiflores 등 단·송이만 입력)은
    // 박스수에서 빠져 분배 비율이 줄던 문제 — 엑셀 원가자료는 박스수(AC)×박스당송이 = 송이수 이므로
    // 박스 미입력 행은 송이수 ÷ 박스당송이 로 박스를 환산해 더한다(36-1 장미 179→336박스 = 엑셀 33,600송이/100).
    {
      const ctry = String(b.countryName || '').trim();
      const spbx = Number(b.stemsPerBox) || 0;
      if (spbx > 0 && (!ctry || /콜롬비아|colombia/i.test(ctry))) {
        const extraStems = rowsResolved
          .filter(r => (r._fnKey || '__UNCATEGORIZED__') === b._key && r.rawBoxQty != null && !(Number(r.rawBoxQty) > 0) && r._steamQtySource !== 'box' && r._steamQtySource !== 'box_default')
          .reduce((a, r) => a + (Number(r.steamQty) || 0), 0);
        if (extraStems > 0) { b._boxFromStems = extraStems / spbx; b.boxCount += b._boxFromStems; }
      }
    }
    const baseCount = (Number(b.stemsPerBox) || 0) * b.boxCount;
    if (baseCount > 0) {
      b.stemsCount = baseCount;
    } else {
      // Flower.StemsPerBox 미설정 → 이 카테고리 행별 steamQty(기본값 포함) 합산
      b.stemsCount = rowsResolved
        .filter(r => (r._fnKey || '__UNCATEGORIZED__') === b._key)
        .reduce((a, r) => a + (Number(r.steamQty) || 0), 0);
    }
    // 국가별 수량 단위: 콜롬비아(또는 국가 미지정 = backward compat) → 박스수, 나머지 → 단수
    // 박스당 무게/CBM 가 외국 품목엔 단당으로 입력된다는 사용자 운영 패턴 반영.
    const country = String(b.countryName || '').trim();
    const isKolombia = !country || /콜롬비아|colombia/i.test(country);
    const qtyForCalc = isKolombia ? b.boxCount : b.bunchCount;
    b._qtyForCalc = qtyForCalc;
    b._isKolombia = isKolombia;
    denomWeight += (Number(b.boxWeight) || 0) * qtyForCalc;
    denomCBM += (Number(b.boxCBM) || 0) * qtyForCalc;
  }
  // 잔여 역산 ─ "기타"/"others" 카테고리는 GW 의 잔여분으로 단당무게 자동 계산
  // 엑셀 식: AB(others) = (GW - SUM(다른 카테고리 단당무게×단수)) / others 단수
  // 무게 기준일 때만 적용. 기타 카테고리에 의도적 BoxWeight 입력했어도 잔여로 덮어씀(엑셀과 일치).
  if (useBasis === 'GW' && gw > 0) {
    const isOthers = (name) => {
      const k = String(name || '').trim();
      return k === '기타' || /^others?$/i.test(k);
    };
    const othersBucket = [...bucket.values()].find(b => isOthers(b.flowerName));
    if (othersBucket && othersBucket._qtyForCalc > 0) {
      const otherWeightSum = [...bucket.values()]
        .filter(b => b !== othersBucket)
        .reduce((s, b) => s + (Number(b.boxWeight) || 0) * (b._qtyForCalc || 0), 0);
      const residualWeight = Math.max(0, gw - otherWeightSum);
      const newBoxWeight = residualWeight / othersBucket._qtyForCalc;
      // 분모에서 기존 기타 부분 제거 → 새 값으로 재가산
      denomWeight -= (Number(othersBucket.boxWeight) || 0) * othersBucket._qtyForCalc;
      othersBucket.boxWeight = newBoxWeight;
      denomWeight += newBoxWeight * othersBucket._qtyForCalc;
      othersBucket._residualBoxWeight = true;  // 표시용 플래그
    }
  }

  // 박스무게/CBM 미설정 카테고리 — 다른 카테고리엔 값이 있어 비율 분배가 성립하는 AWB 에서
  // 미설정 카테고리가 운임·통관 0원으로 빠지던 결함(2026-09-30 수국 사고) 방지.
  // 엑셀 '기타' 잔여 규칙과 같게: (GW 또는 CW) − Σ(설정 카테고리 박스당값×수량) 을 미설정 카테고리 수량비로 나눈다.
  // 무게(통관 배분용)와 CBM(운임 배분용) 각각 채운다.
  for (const [useKey, total, label, isUsed] of [['boxWeight', gw, '무게', useBasis === 'GW'], ['boxCBM', cw, 'CBM', useBasis !== 'GW']]) {
    const denom = useKey === 'boxWeight' ? denomWeight : denomCBM;
    const missing = [...bucket.values()].filter(b => (b._qtyForCalc || 0) > 0 && !(Number(b[useKey]) > 0));
    if (!(missing.length > 0 && denom > 0 && total > 0)) continue;
    const missQty = missing.reduce((s, b) => s + b._qtyForCalc, 0);
    const residual = total - denom;
    const names = missing.map(b => b.flowerName).join(', ');
    if (residual > 0) {
      const per = residual / missQty;
      for (const b of missing) {
        b[useKey] = per;
        b._residualBoxMetric = true;
        if (useKey === 'boxWeight') denomWeight += per * b._qtyForCalc; else denomCBM += per * b._qtyForCalc;
      }
      if (isUsed) warnings.push({ level: 'warn', msg: `[${names}] 박스${label} 미설정 → ${useKey === 'boxWeight' ? 'GW' : 'CW'} 잔여(${residual.toFixed(1)})로 배분 (박스당 ${per.toFixed(2)}). 품목/꽃 마스터에 값을 입력하세요.` });
    } else if (isUsed) {
      warnings.push({ level: 'error', msg: `[${names}] 박스${label} 미설정 + 잔여 없음 → 운임·통관 0원. 마스터 값을 입력하세요.` });
    }
  }

  // 송이수 기반 분배 fallback 준비 (box 값이 모두 0 일 때 사용)
  const totalStemsAll = [...bucket.values()].reduce((a, b) => a + (Number(b.stemsCount) || 0), 0);
  const needStemsFallback = (useBasis === 'GW' ? denomWeight : denomCBM) <= 0;
  if (needStemsFallback && totalStemsAll > 0) {
    warnings.push({ level: 'warn', msg: `카테고리 박스무게/CBM 정보 부족 → 송이수 비율로 운임 분배 (총 ${totalStemsAll.toLocaleString()}송이 기준)` });
  } else if (denomWeight <= 0 && useBasis === 'GW') {
    warnings.push({ level: 'error', msg: '무게 기반 분모가 0 입니다. 카테고리 박스무게 설정 확인.' });
  } else if (denomCBM <= 0 && useBasis === 'CBM') {
    warnings.push({ level: 'error', msg: 'CBM 기반 분모가 0 입니다.' });
  }

  // ── Step 6: 카테고리별 비율/운임/통관
  for (const b of bucket.values()) {
    const qty = b._qtyForCalc || 0;  // 콜롬비아=박스수, 나머지=단수
    const wRatio = denomWeight > 0 ? (Number(b.boxWeight) || 0) * qty / denomWeight : 0;
    const cRatio = denomCBM > 0 ? (Number(b.boxCBM) || 0) * qty / denomCBM : 0;
    const stemsRatio = totalStemsAll > 0 ? (Number(b.stemsCount) || 0) / totalStemsAll : 0;
    b.weightRatio = wRatio;
    b.cbmRatio = cRatio;
    b.stemsRatio = stemsRatio;
    // box 기반 분모가 0 이면 송이수 비율로 대체 (Yunnan Melody 처럼 BoxQty 없는 BILL 대응)
    b.usedRatio = needStemsFallback ? stemsRatio : (useBasis === 'GW' ? wRatio : cRatio);
    b.freightUSD = freightTotalUSD * b.usedRatio;           // K
    // 통관(T) = 통관합계 × 무게비율(AD) — 콜롬비아 원가자료 엑셀은 운임만 IF(GW=CW, 무게, CBM) 이고 통관은 항상 무게비율.
    b.customsRatio = needStemsFallback ? stemsRatio : (denomWeight > 0 ? wRatio : b.usedRatio);
    b.customsKRW = customsTotalKRW * b.customsRatio;        // T
    b.freightPerStemUSD = b.stemsCount > 0 ? b.freightUSD / b.stemsCount : 0;   // M
    b.customsPerStemKRW = b.stemsCount > 0 ? b.customsKRW / b.stemsCount : 0;   // U
    if (b.boxCount > 0 && b.stemsCount === 0) {
      warnings.push({ level: 'warn', msg: `[${b.flowerName}] 박스당 송이수 미설정 — 송이당 운임/통관 계산 불가` });
    }

    // ── displayUnit 결정 — Product.OutUnit 최빈값 (없으면 isKolombia 기준)
    const counter = b._outUnitCounter || {};
    const sortedOU = Object.entries(counter).sort((a, c) => c[1] - a[1]);
    let displayUnit = sortedOU[0]?.[0];
    if (!displayUnit) displayUnit = b._isKolombia ? '박스' : '단';
    b.displayUnit = displayUnit;
    let displayQty = 0;
    if (displayUnit === '박스') displayQty = b.boxCount;
    else if (displayUnit === '단')  displayQty = b.bunchCount;
    else                            displayQty = b.stemsCount;  // '송이' 또는 기타
    b.displayQty = displayQty;
    b.freightPerDisplayUnit = displayQty > 0 ? b.freightUSD / displayQty : 0;
    b.customsPerDisplayUnit = displayQty > 0 ? b.customsKRW / displayQty : 0;
  }

  // ── Step 6b: 금액비율(VALUE) 분배 — NL 원가자료 엑셀 규칙
  //   G(금액포지션) = FOB×수량 ÷ 인보이스 상품총액(D6),  운송비/송이 = 항공료(C11)×G÷수량,  그외통관/송이 = 통관합계(Q10)×G÷수량
  //   → 송이당 운임·통관이 상품단가(FOB)에 비례. 네덜란드 전용 AWB 는 박스무게/CBM 대신 이 규칙(24~37차 NL 시트 전부 동일).
  //   master.allocationBasis 로 강제 지정 가능('VALUE' | 'WEIGHT').
  const buckets = [...bucket.values()];
  const allNetherlands = buckets.length > 0 && buckets.every(b => isNetherlandsCountry(b.countryName));
  const valueMode = master.allocationBasis === 'VALUE' || (master.allocationBasis == null && allNetherlands);
  const invoiceGoodsUSD = rowsResolved.reduce((a, r) => {
    const t = Number(r.totalPriceUSD) || 0;
    return a + (t > 0 ? t : (Number(r.fobUSD) || 0) * (Number(r.steamQty) || 0));
  }, 0);
  const useValue = valueMode && invoiceGoodsUSD > 0;
  if (useValue) {
    for (let i = warnings.length - 1; i >= 0; i--) if (/정보 부족 → 송이수 비율|분모가 0 입니다/.test(warnings[i].msg)) warnings.splice(i, 1);
  }
  if (valueMode && !useValue) warnings.push({ level: 'warn', msg: '금액비율 분배 대상이나 인보이스 상품총액이 0 — 무게/송이 비율로 계산' });

  // ── Step 7: 행별 도착원가/이익 계산
  const rows = rowsResolved.map(r => {
    const b = bucket.get(r._fnKey || '__UNCATEGORIZED__') || {};
    const F = Number(r.fobUSD) || 0;                                   // DB UPrice 원본 (단위 혼재 — 표시용)
    // ── 상품단가 단위 정규화 (TPrice ÷ 수량) — UPrice 를 송이당/표시단위당으로 동시에 쓰던 버그 수정
    const displayUnit = b.displayUnit || (Number(r.outUnit) || '송이');
    let displayQty = 0;
    if (displayUnit === '박스') displayQty = Number(r.rawBoxQty) || 0;
    else if (displayUnit === '단') displayQty = Number(r.bunchQty) || 0;
    else displayQty = Number(r.steamQty) || 0;  // 송이
    const goods = resolveRowGoodsPriceUSD({
      fobUSD: F, totalPriceUSD: r.totalPriceUSD, displayUnit, displayQty,
      stemQty: r.steamQty, stemQtyFromDb: r._steamQtySource === 'db',
      bunchQty: r.bunchQty, boxQty: r.rawBoxQty, stemsPerBunch: r.stemsPerBunch,
      stemsPerBox: r._stemsPerBox, fobOverridden: !!r.fobOverridden,
    });
    const Fs = goods.perStem;                                          // 상품단가/송이 USD
    const G = useValue ? freightTotalUSD * Fs / invoiceGoodsUSD : (Number(b.freightPerStemUSD) || 0);   // 운송비/송이 USD
    const H = Fs + G;                                                  // CNF/송이 USD
    const J = H * exRate;                                              // CNF/송이 KRW
    const tariffRate = Number(r._tariffRate) || 0;
    const K = J * tariffRate;                                          // 관세 KRW/송이
    const L = useValue ? customsTotalKRW * Fs / invoiceGoodsUSD : (Number(b.customsPerStemKRW) || 0);  // 그외통관 KRW/송이
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

    // ── displayUnit 단위로 표시값 환산 (엑셀 다운로드 + UI 표시용)
    // 상품단가는 TPrice÷표시단위수량(goods.perDisplay). G/L/M 만 카테고리에서 가져와 환산.
    const displayFreightUSD = useValue ? freightTotalUSD * goods.perDisplay / invoiceGoodsUSD : (Number(b.freightPerDisplayUnit) || 0);  // displayUnit 당 운임
    const displayCustomsKRW = useValue ? customsTotalKRW * goods.perDisplay / invoiceGoodsUSD : (Number(b.customsPerDisplayUnit) || 0); // displayUnit 당 통관
    const displayCnfUSD = goods.perDisplay + displayFreightUSD;          // displayUnit 당 CNF USD
    const displayCnfKRW = displayCnfUSD * exRate;                        // displayUnit 당 CNF KRW
    const displayTariffKRW = displayCnfKRW * tariffRate;                 // displayUnit 당 관세
    const displayArrivalKRW = displayCnfKRW + displayTariffKRW + displayCustomsKRW;  // displayUnit 당 도착원가

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
      outUnit: r._outUnit || null,
      fobUSD: F,
      totalPriceUSD: Number(r.totalPriceUSD) || 0,       // DB TPrice (표시용)
      boxWeightUsed: r._boxWeight,
      boxCBMUsed: r._boxCBM,
      stemsPerBoxUsed: r._stemsPerBox,
      stemsPerBunch: N,
      salePriceKRW: Q,
      tariffRate,
      // 계산 결과 (송이 기준 — 기존 호환)
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
      // ── displayUnit 단위 결과 (엑셀/UI 표시용 — DB OutUnit 자동 분기)
      displayUnit,                                       // '박스' | '단' | '송이'
      displayQty,                                        // displayUnit 단위 수량
      displayFobUSD: goods.perDisplay,                   // display 단위 상품단가 (TPrice÷표시수량)
      goodsPerStemUSD: Fs,                               // 송이당 상품단가 (TPrice÷송이)
      goodsPriceBasis: goods.basis,                      // 'tprice-display'|'tprice-stem'|'uprice'|'uprice-override'
      upriceUnit: goods.upriceUnit,                      // UPrice 실제 단위 판정('송이'|'단'|'박스'|null)
      displayFreightUSD,                                 // displayUnit 당 운임
      displayCustomsKRW,                                 // displayUnit 당 통관
      displayCnfUSD,                                     // displayUnit 당 CNF USD
      displayCnfKRW,                                     // displayUnit 당 CNF KRW
      displayTariffKRW,                                  // displayUnit 당 관세
      displayArrivalKRW,                                 // displayUnit 당 도착원가 (=O 의미와 같음)
    };
  });

  // 금액비율 분배면 카테고리 운임/통관 표시값도 행 합계로 재집계
  if (useValue) {
    for (const b of buckets) {
      const rs = rows.filter(r => normalizeFlower(r.flowerName) === b._key || (b._key === '__UNCATEGORIZED__' && !normalizeFlower(r.flowerName)));
      b.freightUSD = rs.reduce((a, r) => a + r.freightPerStemUSD * r.steamQty, 0);
      b.customsKRW = rs.reduce((a, r) => a + r.customsPerStem * r.steamQty, 0);
      b.usedRatio = freightTotalUSD > 0 ? b.freightUSD / freightTotalUSD : 0;
      b.freightPerStemUSD = b.stemsCount > 0 ? b.freightUSD / b.stemsCount : 0;
      b.customsPerStemKRW = b.stemsCount > 0 ? b.customsKRW / b.stemsCount : 0;
      b.freightPerDisplayUnit = b.displayQty > 0 ? b.freightUSD / b.displayQty : 0;
      b.customsPerDisplayUnit = b.displayQty > 0 ? b.customsKRW / b.displayQty : 0;
    }
  }

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
      allocationBasis: useValue ? 'VALUE' : (needStemsFallback ? 'STEMS' : useBasis),
      invoiceGoodsUSD,
      customs: c,
    },
    categories: [...bucket.values()].map(b => ({
      flowerName: b.flowerName,
      boxCount: b.boxCount,
      bunchCount: b.bunchCount,
      boxWeight: b.boxWeight,
      boxCBM: b.boxCBM,
      boxMetricSource: b._residualBoxMetric ? 'residual' : (b.boxMetricSource || 'master'),
      stemsPerBox: b.stemsPerBox,
      stemsCount: b.stemsCount,
      countryName: b.countryName,
      weightRatio: b.weightRatio,
      cbmRatio: b.cbmRatio,
      usedRatio: b.usedRatio,
      freightUSD: b.freightUSD,
      customsKRW: b.customsKRW,
      freightPerStemUSD: b.freightPerStemUSD,
      customsPerStemKRW: b.customsPerStemKRW,
      // ── display 단위 (Product.OutUnit 최빈값 기반)
      displayUnit: b.displayUnit,
      displayQty: b.displayQty,
      freightPerDisplayUnit: b.freightPerDisplayUnit,
      customsPerDisplayUnit: b.customsPerDisplayUnit,
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
