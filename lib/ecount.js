// lib/ecount.js — 이카운트 OAPI V2 클라이언트
// SESSION_ID는 30분 유효 → 서버 메모리 캐싱 (25분 TTL)

const ZONE       = process.env.ECOUNT_ZONE     || 'cc';
const ZONE_UPPER = ZONE.toUpperCase();
const COM_CODE   = process.env.ECOUNT_COM_CODE || '';
const USER_ID    = process.env.ECOUNT_USER_ID  || '';
const API_KEY    = process.env.ECOUNT_API_KEY  || '';

// Base URLs (OAPI V2 정식 엔드포인트)
const LOGIN_URL = `https://sboapi${ZONE}.ecount.com/OAPI/V2/OAPILogin`;
const API_BASE  = `https://sboapi${ZONE}.ecount.com/OAPI/V2`;

// 세션 캐시 (프로세스 메모리)
let cachedSession = { sessionId: null, expiresAt: 0 };

/**
 * 설정 완성 여부 체크
 */
export function isConfigured() {
  return !!(COM_CODE && USER_ID && API_KEY);
}

/**
 * 이카운트 로그인 → SESSION_ID 반환
 */
async function login() {
  const body = {
    COM_CODE:     COM_CODE,
    USER_ID:      USER_ID,
    API_CERT_KEY: API_KEY,
    ZONE:         ZONE_UPPER,
    LAN_TYPE:     'ko-KR',
  };

  const res = await fetch(LOGIN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`이카운트 로그인 실패: HTTP ${res.status}`);
  }

  const data = await res.json();

  // OAPI V2: 성공 시 Data.Code='00', SESSION_ID는 Data.Datas.SESSION_ID
  if (data.Status !== 200 || data.Data?.Code !== '00' || !data.Data?.Datas?.SESSION_ID) {
    const msg = data.Data?.Message || data.Data?.Datas?.Message || JSON.stringify(data);
    throw new Error(`이카운트 로그인 오류: ${msg}`);
  }

  return data.Data.Datas.SESSION_ID;
}

/**
 * SESSION_ID 반환 (캐시 활용, 만료 시 재로그인)
 * @returns {Promise<string>} SESSION_ID
 */
export async function getSession() {
  if (!isConfigured()) {
    throw new Error('이카운트 설정이 필요합니다. Railway 환경변수를 확인하세요. (ECOUNT_COM_CODE, ECOUNT_USER_ID)');
  }

  const now = Date.now();
  // 25분 캐시 (이카운트 SESSION은 30분 유효)
  if (cachedSession.sessionId && cachedSession.expiresAt > now) {
    return cachedSession.sessionId;
  }

  const sessionId = await login();
  cachedSession = {
    sessionId,
    expiresAt: now + 25 * 60 * 1000, // 25분
  };
  return sessionId;
}

/**
 * 세션 캐시 강제 무효화 후 재로그인
 */
export async function refreshSession() {
  cachedSession = { sessionId: null, expiresAt: 0 };
  return getSession();
}

/**
 * 세션 캐시 상태 반환 (만료시각 포함)
 */
export function getSessionInfo() {
  return {
    isReady:   !!(cachedSession.sessionId && cachedSession.expiresAt > Date.now()),
    expiresAt: cachedSession.expiresAt || null,
    comCode:   COM_CODE || null,
    userId:    USER_ID  || null,
    zone:      ZONE_UPPER,
  };
}

/**
 * 이카운트 API POST
 * 세션 만료(401/500) 시 자동 재로그인 1회 재시도
 * @param {string} endpoint  - e.g. "Sale/SaveSales"
 * @param {Object} data      - 요청 바디 (SESSION_ID 자동 삽입됨)
 * @returns {Promise<Object>} 이카운트 응답 데이터
 */
export async function ecountPost(endpoint, data = {}) {
  if (!isConfigured()) {
    throw new Error('이카운트 설정이 필요합니다. Railway 환경변수를 확인하세요.');
  }

  const doRequest = async (retrying = false) => {
    const sessionId = retrying ? await refreshSession() : await getSession();

    // SESSION_ID는 URL 쿼리 파라미터로 전달 (이카운트 OAPI V2 정식 방식)
    const url = `${API_BASE}/${endpoint}?SESSION_ID=${sessionId}`;

    const body = {
      ...data,
    };

    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });

    // HTTP 412 (Precondition Failed) → 세션 만료로 간주, 1회 재시도
    if (!res.ok) {
      if (!retrying && res.status === 412) {
        cachedSession = { sessionId: null, expiresAt: 0 };
        return doRequest(true);
      }
      throw new Error(`이카운트 API 오류: HTTP ${res.status} (${endpoint})`);
    }

    const result = await res.json();

    // 세션 만료 감지 → 1회 재시도
    if (!retrying && (
      result.Status === 401 ||
      (result.Status === 500 && (
        (result.Error?.Message || '').includes('SESSION') ||
        (result.Message || '').includes('SESSION') ||
        (result.Error?.Message || '').includes('로그인') ||
        (result.Message || '').includes('로그인')
      ))
    )) {
      cachedSession = { sessionId: null, expiresAt: 0 };
      return doRequest(true);
    }

    return result;
  };

  return doRequest(false);
}

export default { getSession, refreshSession, getSessionInfo, ecountPost, isConfigured };
