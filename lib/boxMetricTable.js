// 박스당(단당) 무게·CBM 단일 원천 표 — 2026-09-30 사장님 결정:
//   "박스당 무게·CBM = 기존 원가자료 엑셀 표(매출원가 양식 아님)"
// 이 표를 운송기준원가(lib/freightCalc.js computeFreightCost)와 주차별 매출이익 보고서 H·S 배분
// (lib/customsForwarding.js RATE_DEFAULTS BoxWeight_/BoxCBM_, lib/customsForwardingCalc.js)이 함께 쓴다.
//
// ── 콜롬비아(박스당) — 원가자료 엑셀 '운성비 품목별 분배 비율 계산' 표(AA7:AJ13)
//   로컬 원가자료 엑셀 288개 시트(13-2 ~ 38-1) 전수 확인: 장미·카네이션·알스트로·루스커스 값은 한 번도 바뀐 적 없음.
//   수국만 17-2A 시트 5.6 / 7, 36-1·37-1·38-1 시트 5.5 / 6.7 → 차수별 예외표로 반영.
//   (매출원가 양식의 장미 무게 7 · 카네이션 CBM 11 은 폐기)
//
// ── 중국(단당) — CHINA 중국 원가자료 엑셀 '단당 무게 / 단당 cbm' 표(AA8:AI14)
//   차수마다 사람이 바꿔 적는다(장미 0.63~0.8, 카네이션 0.73~1.1 …) → 엑셀이 있는 차수는 그 차수 값,
//   없는 차수(36차~)는 마지막 엑셀(35-2) 값을 쓴다. 표에 없는 품목은 '기타' = (GW − Σ표 품목 단당무게×단수) ÷ 기타 단수
//   (CBM 도 CW 로 같은 방식). 품목 판정은 엑셀 G열 SEARCH 순서 그대로(CARNATION → ROSE → LISIANTHUS → EUCALYPTUS
//   → Sinensis → Gypsophila → 나머지 기타).

export const COLOMBIA_BOX_METRICS = Object.freeze({
  '장미': { boxWeight: 8, boxCBM: 10 },
  '카네이션': { boxWeight: 11, boxCBM: 9 },
  '알스트로': { boxWeight: 9.7, boxCBM: 7 },
  '루스커스': { boxWeight: 8, boxCBM: 9.6 },
  '수국': { boxWeight: 5.5, boxCBM: 6.7 },
});

/** 차수별 예외(원가자료 엑셀 시트에 다른 값이 적힌 차수) — key 'WW-SS' */
export const COLOMBIA_BOX_METRIC_WEEK_OVERRIDES = Object.freeze({
  '17-02': { '수국': { boxWeight: 5.6, boxCBM: 7 } }, // 21-1 콜롬비아 원가자료 17-2A 시트 HYDRANGEA
});

const COLOMBIA_ALIASES = [
  [/^(장미|rose|roses)$/i, '장미'],
  [/^(카네이션|carnation|carnations)$/i, '카네이션'],
  [/^(알스트로|알스트로메리아|alstro|alstroemeria|alstromeria)$/i, '알스트로'],
  [/^(루스커스|ruscus)$/i, '루스커스'],
  [/^(수국|hydrangea)$/i, '수국'],
];

export function normalizeWeekKey(week) {
  const m = String(week || '').match(/(\d{1,2})\s*-\s*(\d{1,2})/);
  return m ? `${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null;
}

export function colombiaTableFlower(flowerName) {
  const s = String(flowerName || '').trim();
  for (const [re, k] of COLOMBIA_ALIASES) if (re.test(s)) return k;
  return null;
}

export function isColombiaCountry(countryName) {
  return /콜롬비아|colombia/i.test(String(countryName || ''));
}
export function isChinaCountry(countryName, farmName) {
  return /중국|china/i.test(String(countryName || '')) || /cloudland|yunnan/i.test(String(farmName || ''));
}

/** 콜롬비아 박스당 { boxWeight, boxCBM } (표 밖 품목이면 null) */
export function colombiaBoxMetrics(flowerName, week) {
  const k = colombiaTableFlower(flowerName);
  if (!k) return null;
  const wk = normalizeWeekKey(week);
  const o = wk && COLOMBIA_BOX_METRIC_WEEK_OVERRIDES[wk]?.[k];
  return { ...(o || COLOMBIA_BOX_METRICS[k]) };
}

/** 매출이익 보고서 RATE_DEFAULTS 용 BoxWeight_콜롬비아장미 … 키 (major 차수 지정 시 그 차수 예외 반영) */
export function colombiaRateDefaultKeys(majorWeek) {
  const out = {};
  const label = { '장미': '콜롬비아장미', '카네이션': '콜롬비아카네이션', '알스트로': '콜롬비아알스트로', '루스커스': '콜롬비아루스커스', '수국': '콜롬비아수국' };
  for (const k of Object.keys(COLOMBIA_BOX_METRICS)) {
    let v = COLOMBIA_BOX_METRICS[k];
    if (majorWeek != null) {
      const mj = String(majorWeek).padStart(2, '0');
      for (const [wk, ov] of Object.entries(COLOMBIA_BOX_METRIC_WEEK_OVERRIDES)) if (wk.startsWith(`${mj}-`) && ov[k]) v = ov[k];
    }
    out[`BoxWeight_${label[k]}`] = v.boxWeight;
    out[`BoxCBM_${label[k]}`] = v.boxCBM;
  }
  return out;
}

// ── 중국 단당 무게/CBM (CHINA 중국 원가자료 엑셀, 차수별) — [단당무게, 단당CBM]
// '40cm' 행은 엑셀에서 ROSE 가 먼저 SEARCH 되어 품목 단가에 쓰이지 않으므로 제외.
const CN = (rose, carn, lis, bj, sin, gyp) => Object.freeze({ '장미': rose, '카네이션': carn, '리시안': lis, '블랙잭': bj, '시네신스': sin, '안개꽃': gyp });
export const CHINA_BUNCH_METRICS_BY_WEEK = Object.freeze({
  '27-02': [{ t: CN([0.75, 1], [0.73, 0.875], [0.6, 1.33], [1, 2.2], [0.5, 0.665], [1, 1.66]) }],
  '28-01': [{ t: CN([0.7, 1], [1.1, 0.875], [0.6, 1.33], [1, 2.2], [0.5, 0.665], [1, 1.66]) }],
  '28-02': [{ t: CN([0.7, 1], [1.1, 0.875], [0.6, 1.33], [1, 2.2], [0.5, 0.665], [1, 1.66]) }],
  '29-01': [{ t: CN([0.7, 1], [1.1, 0.875], [0.6, 1.33], [1, 2.2], [0.5, 0.665], [1, 1.66]) }],
  '29-02': [{ t: CN([0.7, 1], [1.1, 0.875], [0.6, 1.33], [1, 2.2], [0.5, 0.665], [1, 1.66]) }],
  '30-01': [{ t: CN([0.8, 1], [1.1, 0.875], [0.6, 1.33], [1.1, 2.2], [0.55, 0.665], [1, 1.66]) }],
  '30-02': [{ t: CN([0.63, 1], [1.1, 0.875], [0.6, 1.33], [1.1, 2.2], [0.5, 0.665], [1, 1.66]) }],
  '31-02': [{ t: CN([0.8, 1], [1.1, 0.875], [0.6, 1.33], [1.1, 2.2], [0.5, 0.665], [1, 1.66]) }],
  '32-01': [{ t: CN([0.8, 1], [1.1, 0.875], [0.6, 1.33], [1.1, 2.2], [0.5, 0.665], [1, 1.66]) }],
  '32-02': [{ t: CN([0.8, 1], [1.1, 0.875], [0.6, 1.33], [1.1, 2.2], [0.5, 0.665], [1, 1.66]) }],
  '33-01': [{ t: CN([0.7, 1], [1.1, 0.875], [0.6, 1.33], [1.1, 2.2], [0.5, 0.665], [1, 1.66]) }],
  '33-02': [{ t: CN([0.7, 1], [1.1, 0.875], [0.6, 1.33], [1.1, 2.2], [0.5, 0.665], [1, 1.66]) }],
  '34-01': [{ t: CN([0.63, 1], [1, 0.875], [0.6, 1.33], [1.05, 2.2], [0.5, 0.665], [1, 1.66]) }],
  // 34-2 는 AWB 2건(A: GW 474, B: GW 1035) — 시트별 표가 다름
  '34-02': [
    { gw: 474, t: CN([0.63, 1], [1, 0.875], [0.6, 1.33], [1.05, 2.2], [0.5, 0.665], [1, 1.66]) },
    { gw: 1035, t: CN([0.8, 0.95], [1, 0.875], [0.6, 1.33], [1, 1], [0.5, 0.665], [1, 1]) },
  ],
  '35-01': [{ t: CN([0.68, 0.95], [0.93, 0.75], [0.6, 1.33], [1, 1], [0.5, 0.665], [1, 1]) }],
  '35-02': [{ t: CN([0.8, 0.95], [1.1, 0.75], [0.6, 1.33], [1, 1], [0.5, 0.665], [1, 1]) }],
});
const CHINA_LATEST_WEEK = '35-02';
/** 엑셀 '40cm' 행(단당 0.45 / 0.6 — 27-2~35-2 전 시트 동일). 잔여 역산에만 쓰인다. */
export const CHINA_40CM_METRICS = Object.freeze({ boxWeight: 0.45, boxCBM: 0.6 });

// 엑셀 G열 IF(SEARCH…) 순서 — 첫 일치가 품목 분류
const CHINA_SEARCH_ORDER = [
  [/carnation/i, '카네이션'],
  [/rose/i, '장미'],
  [/lisianthus/i, '리시안'],
  [/eucalyptus/i, '블랙잭'],
  [/sinensis/i, '시네신스'],
  [/gypsophila/i, '안개꽃'],
];

/** 중국 품목명 → 원가자료 엑셀 분류(장미/카네이션/리시안/블랙잭/시네신스/안개꽃/기타) */
export function chinaSubcategory(prodName) {
  const s = String(prodName || '');
  for (const [re, k] of CHINA_SEARCH_ORDER) if (re.test(s)) return k;
  return '기타';
}

/** 중국 단당 { boxWeight, boxCBM, week } — '기타'/표 밖이면 null(잔여 역산 대상) */
export function chinaBunchMetrics(subcategory, week, gw) {
  if (!subcategory || subcategory === '기타') return null;
  const wk = normalizeWeekKey(week);
  let key = wk && CHINA_BUNCH_METRICS_BY_WEEK[wk] ? wk : null;
  if (!key && wk && wk > CHINA_LATEST_WEEK) key = CHINA_LATEST_WEEK;
  if (!key) {
    // 표보다 이른 차수 → 가장 이른 표
    const ks = Object.keys(CHINA_BUNCH_METRICS_BY_WEEK).sort();
    key = wk && wk < ks[0] ? ks[0] : CHINA_LATEST_WEEK;
  }
  const cands = CHINA_BUNCH_METRICS_BY_WEEK[key];
  let pick = cands[cands.length - 1];
  if (cands.length > 1 && Number(gw) > 0) {
    pick = cands.reduce((best, c) => (Math.abs((c.gw || 0) - gw) < Math.abs((best.gw || 0) - gw) ? c : best), cands[0]);
  }
  const v = pick.t[subcategory];
  return v ? { boxWeight: v[0], boxCBM: v[1], week: key } : null;
}
