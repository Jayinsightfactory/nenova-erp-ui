// lib/kcsTaxableRate.js — 관세청(KCS) 과세환율 공식 API 저수준 조회 + 파싱 + 메모리 TTL 캐시.
//
// ⚠️ 이 모듈은 순수 HTTP + 메모리 캐시만 다룬다. lib/db.js를 import하지 않으며, DB read/write/DDL을
// 전혀 하지 않는다(GET 경로 SELECT 전용 규칙과 무관하게, 이 외부 API 연동 자체가 DB를 건드리지 않아야
// 한다). 상위 래퍼는 lib/taxableExchangeRate.js의 fetchKcsTaxableRate()이며, 이 함수가
// saveTaxableRate()에 그대로 넘길 수 있는 shape으로 결과를 다듬어 반환한다.
//
// 엔드포인트(unipass.customs.go.kr retrieveCOM0101049Q.do)의 공식 응답 스키마 문서가 없다.
// 그래서 `weekFxrtIm`(주간 과세환율) 키를 응답 어디서든 재귀적으로 찾고, 찾지 못하면 절대 값을
// 추측하거나 0/기본값으로 채우지 않고 available:false로 실패 처리한다.

const DEFAULT_BASE_URL = 'https://unipass.customs.go.kr/clip/com/bsopcomn/baseinfo/retrieveCOM0101049Q.do';
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000; // 6시간

// 메모리 TTL 캐시 — lib/importApplyProgress.js 패턴(global 싱글톤 Map + TTL prune)을 따른다.
if (!global._kcsTaxableRateCache) global._kcsTaxableRateCache = new Map();
const cache = global._kcsTaxableRateCache;

// 2026년 28차부터는 별도 시크릿 없이도(공개 조회 가능성) 기본으로 켠다 — 미설정이면 활성.
// 담당자가 명시적으로 'false'를 설정한 경우에만 끈다. 그 외 값('true' 포함)은 활성으로 취급한다.
function isEnabled() {
  return process.env.KCS_TAXABLE_RATE_ENABLED !== 'false';
}

function getBaseUrl() {
  return process.env.KCS_TAXABLE_RATE_BASE_URL || DEFAULT_BASE_URL;
}

function getTimeoutMs() {
  const n = Number(process.env.KCS_TAXABLE_RATE_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}

function getTtlMs() {
  const n = Number(process.env.KCS_TAXABLE_RATE_TTL_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TTL_MS;
}

function pruneCache() {
  const now = Date.now();
  for (const [k, v] of cache) {
    if (now - (v.cachedAt || 0) > (v.ttlMs || DEFAULT_TTL_MS)) cache.delete(k);
  }
}

/** 'YYYY-MM-DD' 또는 'YYYYMMDD' → 'YYYYMMDD'. 해석 불가면 null. */
function toYyyymmdd(dateStr) {
  if (!dateStr) return null;
  const s = String(dateStr).trim();
  if (/^\d{8}$/.test(s)) return s;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}${m[2]}${m[3]}`;
  return null;
}

/** 'YYYYMMDD' 또는 'YYYY-MM-DD' → 'YYYY-MM-DD'. 해석 불가면 null. */
function toIsoDate(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  let m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

/**
 * 응답 객체/배열 어디서든 `weekFxrtIm` 키를 재귀적으로 찾는다.
 * 응답 형태(배열/객체/중첩 필드명)를 알 수 없으므로 방어적으로 순회하고,
 * 유효한 양수 숫자가 아니면 채택하지 않는다.
 * @returns {{raw: object, rate: number}|null}
 */
function findRateNode(node, depth = 0) {
  if (node == null || depth > 6) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findRateNode(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof node === 'object') {
    if (Object.prototype.hasOwnProperty.call(node, 'weekFxrtIm')) {
      const num = Number(String(node.weekFxrtIm).replace(/,/g, ''));
      if (Number.isFinite(num) && num > 0) return { raw: node, rate: num };
    }
    for (const key of Object.keys(node)) {
      const found = findRateNode(node[key], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function pickDateField(raw, keys) {
  for (const k of keys) {
    if (raw[k] != null && raw[k] !== '') {
      const iso = toIsoDate(raw[k]);
      if (iso) return iso;
    }
  }
  return null;
}

function cacheKeyFor(currency, declarationDate) {
  return `${String(currency).toUpperCase()}::${declarationDate}`;
}

/**
 * 관세청 과세환율 공식 조회(저수준). 순수 HTTP + 메모리 캐시만 다룬다.
 *
 * - `KCS_TAXABLE_RATE_ENABLED`가 정확히 'false'가 아니면(미설정 포함) 기본적으로 활성 — 2026년
 *   28차 이후는 시크릿 없이도 자동 조회를 시도한다. 명시적으로 'false'를 설정한 경우에만 끈다.
 * - 이 주간환율 조회 엔드포인트는 공개 조회 방식으로 호출한다. 저장소의 과거 호환용
 *   `KCS_EXCHANGE_RATE_API_KEY` 값은 이 요청에 보내지 않는다.
 * - 실패 사유는 절대 추측하지 않고 그대로 reason에 남긴다.
 *
 * @param {{currency:string, declarationDate:string}} params
 * @returns {Promise<object>} available:true → {available,rate,sourceDate,sourceRangeStart,sourceRangeEnd,sourceNote}
 *                             available:false → {available,reason,message}
 */
export async function getKcsTaxableRate({ currency, declarationDate } = {}) {
  if (!isEnabled()) {
    return {
      available: false,
      reason: 'disabled',
      message: '관세청 과세환율 자동 조회가 KCS_TAXABLE_RATE_ENABLED=false로 비활성화되어 있습니다.',
    };
  }
  if (!currency || !declarationDate) {
    return { available: false, reason: 'missing_parameters', message: '통화와 신고일자가 모두 있어야 과세환율을 조회할 수 있습니다.' };
  }
  const yyyymmdd = toYyyymmdd(declarationDate);
  if (!yyyymmdd) {
    return { available: false, reason: 'invalid_date', message: `신고일자 형식을 해석할 수 없습니다: ${declarationDate}` };
  }

  const key = cacheKeyFor(currency, declarationDate);
  pruneCache();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.cachedAt <= (cached.ttlMs || getTtlMs())) {
    return cached.value;
  }

  const baseUrl = getBaseUrl();
  const timeoutMs = getTimeoutMs();

  const params = new URLSearchParams({
    aplyBgnDt: yyyymmdd,
    currCd: String(currency).toUpperCase(),
    summary: '',
    pageIndex: '1',
    pageUnit: '100',
  });
  const url = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${params.toString()}`;

  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const isTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return {
      available: false,
      reason: isTimeout ? 'timeout' : 'network_error',
      message: isTimeout
        ? `관세청 과세환율 API 응답이 ${timeoutMs}ms 내에 오지 않았습니다.`
        : `관세청 과세환율 API 호출에 실패했습니다: ${err?.message || err}`,
    };
  }

  if (response.status === 401 || response.status === 403) {
    return {
      available: false,
      reason: 'auth_failed',
      message: `관세청 과세환율 공개 조회가 거부되었습니다(HTTP ${response.status}). 관세청 서비스 상태를 확인하세요.`,
    };
  }
  if (!response.ok) {
    return {
      available: false,
      reason: 'http_error',
      message: `관세청 과세환율 API가 비정상 응답을 반환했습니다(HTTP ${response.status}).`,
    };
  }

  let text;
  try {
    text = await response.text();
  } catch (err) {
    return { available: false, reason: 'read_error', message: `관세청 과세환율 API 응답을 읽을 수 없습니다: ${err?.message || err}` };
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return { available: false, reason: 'parse_error', message: '관세청 과세환율 API 응답이 JSON 형식이 아닙니다.' };
  }

  const found = findRateNode(json);
  if (!found) {
    return { available: false, reason: 'rate_not_found', message: '관세청 과세환율 API 응답에서 weekFxrtIm 값을 찾을 수 없습니다.' };
  }

  const sourceDate = pickDateField(found.raw, ['aplyBgnDt', 'baseDt', 'stdDt']) || toIsoDate(yyyymmdd);
  const sourceRangeStart = pickDateField(found.raw, ['aplyBgnDt', 'wkAplyBgnDt']) || sourceDate;
  const sourceRangeEnd = pickDateField(found.raw, ['aplyEndDt', 'wkAplyEndDt']) || null;

  const result = {
    available: true,
    rate: found.rate,
    sourceDate,
    sourceRangeStart,
    sourceRangeEnd,
    sourceNote: `관세청 과세환율 API 조회 (${String(currency).toUpperCase()}, 고시기준일 ${sourceDate || toIsoDate(yyyymmdd)})`,
  };

  cache.set(key, { value: result, cachedAt: Date.now(), ttlMs: getTtlMs() });
  return result;
}

/** 테스트/진단 전용 — 메모리 캐시를 강제로 비운다. */
export function clearKcsTaxableRateCache() {
  cache.clear();
}
