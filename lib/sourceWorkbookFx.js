// lib/sourceWorkbookFx.js — 운송기준원가 환율: 담당자 원가자료 엑셀(업로드본)의 차수별 환율.
//
// ## 왜 (2026-09-30 사장님 지시 "원가차이 안나는 환율로 수정")
// 네덜란드(EUR) 도착원가를 CurrencyMaster EUR 1450(2026-04-17 값, nenova.exe 공용 — 수정 금지)으로
// 계산해 NL 원가자료 엑셀(차수별 1780/1750/1700/1600) 대비 0.78~0.82배로 낮게 나왔다.
// 엑셀 C7 환율 후보를 전수 대조한 결과:
//   - FreightCost.ExchangeRate 스냅샷: NL 그룹에는 한 건도 없음(콜롬비아 16·18차 2건뿐)
//   - 관세청 과세환율/매매기준율: 시장 실측값(소수점)이라 엑셀의 반올림 정책값(1780·1750·1700·1600)과 불일치
//   - WebFarmRemit: KRW 환율 컬럼 없음(AmountUSD·AmountOrig 만)
//   - WebArrivalCostLine.ExchangeRate(원가자료 업로드, 웹 전용 테이블): NL 24-2~39-2 전 차수 엑셀 C7과 정확히 일치 ← 채택
//
// ## 환율 결정 순서 (운송기준원가 화면 · 차수피벗 도착원가 공통)
//   1. FreightCost 스냅샷 ExchangeRate > 0 (담당자가 운송기준원가 화면에서 저장한 값)
//   2. [SOURCE_FX_CURRENCIES 통화만] 같은 OrderYear·같은 세부차수(NN-S) 원가자료 환율(국가 일치, 행수 최빈값)
//   3.   〃 같은 대차수의 다른 세부차수 원가자료 환율
//   4.   〃 직전 대차수 최대 CARRY_MAX_MAJOR_STEPS 주 이내 가장 최근 원가자료 환율(뒤로만, 미래 차수 불사용)
//   5. CurrencyMaster 현재 환율(제안값 — 기존 동작)
// USD/CNY/THB/AUD 등은 이번 변경 대상이 아니다(2단계 이하를 건너뛰고 기존대로 5). 대상 통화 확장은
// SOURCE_FX_CURRENCIES 에 추가 + 해당 국가 엑셀 전수 대조 후에만 한다.
//
// Read-only. WebArrivalCostLine 테이블이 없으면 빈 결과로 기존 동작 유지.
import { query, sql } from './db.js';
import { COUNTRY_CURRENCY_MAP } from './countryClassification.js';

export const SOURCE_FX_CURRENCIES = new Set(['EUR']);
// 2026-09-30 콜롬비아(USD) 확장 — 원가자료 C7 전수 대조: 콜롬비아 4품목 시트 22-2~37-1 28개 전부
// WebArrivalCostLine 콜롬비아 세부차수 환율과 일치(33-1 1500·33-2 1520·34~36-1 1500·37-1 1450 포함).
// 업로드 없는 세부차수(36-2·37-2·38-1 등)는 대차수/직전차수로 넘기면 엑셀과 어긋나므로(36-2 엑셀 1450 vs 36-1 1500)
// USD 는 같은 세부차수 정확 일치만 쓰고, 없으면 기존대로 CurrencyMaster.
export const USD_WORKBOOK_FX_COUNTRIES = new Set(['콜롬비아']);
export const CARRY_MAX_MAJOR_STEPS = 4;
export const FX_SOURCE = Object.freeze({
  SNAPSHOT: 'freight_snapshot',
  WORKBOOK_WEEK: 'source_workbook_week',
  WORKBOOK_MAJOR: 'source_workbook_major',
  WORKBOOK_CARRY: 'source_workbook_carry',
  CURRENCY_MASTER: 'currency_master',
  NONE: 'none',
});

/** '28-2' / '03-02' / '2802' / '28-02' → { major: 28, minor: 2 } (minor 없으면 0) */
export function parseSubWeek(orderWeek) {
  const s = String(orderWeek ?? '').trim();
  let m = s.match(/^(\d{1,2})\s*-\s*(\d{1,2})$/);
  if (m) return { major: Number(m[1]), minor: Number(m[2]) };
  m = s.match(/^(\d{2})(\d{2})$/);
  if (m) return { major: Number(m[1]), minor: Number(m[2]) };
  m = s.match(/^(\d{1,2})$/);
  if (m) return { major: Number(m[1]), minor: 0 };
  return null;
}

function modeRate(rows) {
  const byRate = new Map();
  for (const r of rows) byRate.set(r.rate, (byRate.get(r.rate) || 0) + r.n);
  return [...byRate.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? null;
}

/**
 * 순수 함수 — 원가자료 환율 행에서 차수 환율을 고른다.
 * @param {Array<{OrderYear, OrderWeek, CountryName, ExchangeRate, n}>} rows
 * @returns {{ rate: number, source: string, sourceWeek: string } | null}
 */
export function pickSourceWorkbookFx(rows, { orderYear, orderWeek, currency, country = null, hydrangeaOnly = false }) {
  const exactOnly = currency === 'USD';
  if (exactOnly) {
    // USD 는 콜롬비아 원가자료만 대상(에콰도르·미국 등 다른 USD 국가는 기존대로 CurrencyMaster).
    if (!USD_WORKBOOK_FX_COUNTRIES.has(String(country || '').trim())) return null;
  } else if (!SOURCE_FX_CURRENCIES.has(currency)) return null;
  const target = parseSubWeek(orderWeek);
  if (!target || !target.major) return null;
  const yr = String(orderYear || '').trim();
  const cand = [];
  for (const r of rows || []) {
    if (String(r.OrderYear || '').trim() !== yr) continue;
    if (COUNTRY_CURRENCY_MAP[String(r.CountryName || '').trim()] !== currency) continue;
    if (exactOnly && String(r.CountryName || '').trim() !== String(country).trim()) continue;

    const rate = Number(r.ExchangeRate);
    const w = parseSubWeek(r.OrderWeek);
    if (!(rate > 0) || !w || !w.major) continue;
    cand.push({ ...w, rate, n: Number(r.n) || 1, hyd: Number(r.Hyd) > 0 });
  }
  const label = (w) => `${String(w.major).padStart(2, '0')}-${w.minor}`;
  let exact = cand.filter(c => c.major === target.major && c.minor === target.minor);
  // 수국 단독 AWB: 같은 세부차수에 수국 행이 있는 원가자료가 있으면 그 환율 우선(없으면 같은 세부차수 콜롬비아 원가자료).
  // 수국 시트 C7 대조: 28-1·28-2·29-1·30-1·30-2·32-2·34-2 일치, 27-2(1560↔1550)·33-2(1520↔1550)만 4품목 시트와 다름.
  if (exactOnly && hydrangeaOnly && exact.some(c => c.hyd)) exact = exact.filter(c => c.hyd);
  if (exact.length) return { rate: modeRate(exact), source: FX_SOURCE.WORKBOOK_WEEK, sourceWeek: label(target) };
  if (exactOnly) return null;
  const major = cand.filter(c => c.major === target.major);
  if (major.length) {
    const rate = modeRate(major);
    const w = major.filter(c => c.rate === rate).sort((a, b) => b.minor - a.minor)[0];
    return { rate, source: FX_SOURCE.WORKBOOK_MAJOR, sourceWeek: label(w) };
  }
  for (let step = 1; step <= CARRY_MAX_MAJOR_STEPS; step++) {
    const wk = target.major - step;
    if (wk < 1) break;
    const hit = cand.filter(c => c.major === wk);
    if (!hit.length) continue;
    const latestMinor = Math.max(...hit.map(c => c.minor));
    const latest = hit.filter(c => c.minor === latestMinor);
    return { rate: modeRate(latest), source: FX_SOURCE.WORKBOOK_CARRY, sourceWeek: label({ major: wk, minor: latestMinor }) };
  }
  return null;
}

/** 순수 함수 — 최종 환율 결정(위 순서 1→5). */
export function resolveFreightExchangeRate({ snapshotRate, workbookRows, orderYear, orderWeek, currency, currencyMasterRate, country = null, hydrangeaOnly = false }) {
  if (Number(snapshotRate) > 0) return { rate: Number(snapshotRate), source: FX_SOURCE.SNAPSHOT, sourceWeek: null };
  const wb = pickSourceWorkbookFx(workbookRows, { orderYear, orderWeek, currency, country, hydrangeaOnly });
  if (wb) return wb;
  if (Number(currencyMasterRate) > 0) return { rate: Number(currencyMasterRate), source: FX_SOURCE.CURRENCY_MASTER, sourceWeek: null };
  return { rate: 0, source: FX_SOURCE.NONE, sourceWeek: null };
}

/** DB — 해당 연도 원가자료 환율 요약(국가·세부차수·환율별 행수). SELECT 전용, 테이블 없으면 []. */
export async function loadSourceWorkbookFxRows(orderYears) {
  const years = [...new Set((Array.isArray(orderYears) ? orderYears : [orderYears]).map(y => String(y || '').trim()).filter(y => /^\d{4}$/.test(y)))];
  if (!years.length) return [];
  try {
    const params = {};
    const ph = years.map((y, i) => { params[`y${i}`] = { type: sql.NVarChar, value: y }; return `@y${i}`; });
    const res = await query(
      `IF OBJECT_ID(N'dbo.WebArrivalCostLine', N'U') IS NOT NULL
         SELECT OrderYear, OrderWeek, CountryName, ExchangeRate, COUNT(*) AS n,
                MAX(CASE WHEN ISNULL(FlowerNameRaw,N'') LIKE N'%수국%' OR ISNULL(FlowerNameRaw,N'') LIKE N'%ydrangea%'
                          OR ISNULL(ProductNameRaw,N'') LIKE N'%ydrangea%' THEN 1 ELSE 0 END) AS Hyd
         FROM WebArrivalCostLine
         WHERE IsCurrent = 1 AND ExchangeRate > 0 AND OrderYear IN (${ph.join(',')})
         GROUP BY OrderYear, OrderWeek, CountryName, ExchangeRate`,
      params
    );
    return res.recordset || [];
  } catch (e) {
    console.warn('[sourceWorkbookFx] load failed:', e.message);
    return [];
  }
}
