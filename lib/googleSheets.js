import crypto from 'crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
// 1호(아카이브). 2026-11-25 기준 할당 셀이 1천만 상한의 96.5%까지 차서 더는 쓰지 않는다.
// 새 데이터는 2호로 가고, 1호는 지난 기록을 읽기 전용으로 보관하는 용도다.
const ARCHIVE_KAKAO_SHEET_ID = '1pXLVZqiMwWt6Vh0IhWwASBvgLtZqLnbHXMWqOLNwAXU';
// 2호. 운영 PC(nenovakakao) .env 의 GSHEET_TARGET_SPREADSHEET_ID 와 같은 시트다.
const DEFAULT_KAKAO_SHEET_ID = '1x7kGxLMOgHcf4_120vDXRa77-2Pi3VKXs2NlBe-4dAE';

export const DEFAULT_TIMEOUT_MS = 12_000;
export const DEFAULT_CACHE_TTL_MS = 60_000;
export const DEFAULT_RETRY_DELAY_MS = 350;
export const MAX_RETRY_AFTER_MS = 2_000;
export const SHEETS_MAX_CELLS = 10_000_000;
export const SHEETS_WARN_PCT = 80;
export const SHEETS_CRITICAL_PCT = 90;

const MAX_CACHE_ENTRIES = 200;
const RETRYABLE_STATUSES = new Set([429, 503]);

let cachedToken = null;
let inFlightToken = null;
const readCache = new Map();
const inFlightReads = new Map();

function resolvePositiveInt(value, fallback) {
  const num = Number(value);
  if (Number.isFinite(num) && num > 0) return Math.floor(num);
  return fallback;
}

function resolveNonNegativeInt(value, fallback) {
  const num = Number(value);
  if (Number.isFinite(num) && num >= 0) return Math.floor(num);
  return fallback;
}

export function getGoogleSheetsTimeoutMs(override) {
  if (override !== undefined) return resolvePositiveInt(override, DEFAULT_TIMEOUT_MS);
  return resolvePositiveInt(process.env.GOOGLE_SHEETS_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
}

export function getGoogleSheetsCacheTtlMs(override) {
  if (override !== undefined) return resolveNonNegativeInt(override, DEFAULT_CACHE_TTL_MS);
  return resolveNonNegativeInt(process.env.GOOGLE_SHEETS_CACHE_TTL_MS, DEFAULT_CACHE_TTL_MS);
}

function getRetryDelayMs(override) {
  if (override !== undefined) return resolveNonNegativeInt(override, DEFAULT_RETRY_DELAY_MS);
  return resolveNonNegativeInt(process.env.GOOGLE_SHEETS_RETRY_DELAY_MS, DEFAULT_RETRY_DELAY_MS);
}

function sleep(ms) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(res, fallbackMs) {
  const raw = res?.headers?.get?.('retry-after');
  if (!raw) return fallbackMs;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(Math.floor(seconds * 1000), MAX_RETRY_AFTER_MS);
  }
  const dateMs = Date.parse(raw);
  if (Number.isFinite(dateMs)) {
    const delta = Math.max(0, dateMs - Date.now());
    return Math.min(delta, MAX_RETRY_AFTER_MS);
  }
  return fallbackMs;
}

function pruneCache(cache, now = Date.now()) {
  for (const [key, entry] of cache.entries()) {
    if (!entry || entry.expiresAt <= now) cache.delete(key);
  }
  while (cache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
}

function setCacheEntry(cache, key, value, ttlMs) {
  const now = Date.now();
  pruneCache(cache, now);
  cache.set(key, { value, expiresAt: now + ttlMs });
}

function getCacheEntry(cache, key) {
  const entry = cache.get(key);
  if (!entry) return { hit: false, value: null };
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return { hit: false, value: null };
  }
  return { hit: true, value: entry.value };
}

export function clearGoogleSheetsCache() {
  cachedToken = null;
  inFlightToken = null;
  readCache.clear();
  inFlightReads.clear();
}

export function getGoogleSheetsCacheStats() {
  pruneCache(readCache);
  return {
    readCacheSize: readCache.size,
    inFlightSize: inFlightReads.size,
    hasCachedToken: Boolean(cachedToken && cachedToken.exp > Math.floor(Date.now() / 1000) + 60),
  };
}

function base64Url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function extractSheetId(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const match = raw.match(/\/spreadsheets\/d\/([^/]+)/);
  return match ? match[1] : raw;
}

function parseServiceAccount() {
  const raw =
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
    process.env.KAKAO_GOOGLE_SERVICE_ACCOUNT_JSON ||
    process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON ||
    '';
  if (!raw.trim()) {
    throw new Error('Google 서비스 계정 환경변수(GOOGLE_SERVICE_ACCOUNT_JSON)가 설정되지 않았습니다.');
  }

  let jsonText = raw.trim();
  if (!jsonText.startsWith('{')) {
    jsonText = Buffer.from(jsonText, 'base64').toString('utf8');
  }

  const account = JSON.parse(jsonText);
  if (!account.client_email || !account.private_key) {
    throw new Error('Google 서비스 계정 JSON에 client_email/private_key가 없습니다.');
  }
  account.private_key = String(account.private_key).replace(/\\n/g, '\n');
  return account;
}

async function fetchWithTimeoutAndRetry(url, init = {}, options = {}) {
  const timeoutMs = getGoogleSheetsTimeoutMs(options.timeoutMs);
  const retryDelayMs = getRetryDelayMs(options.retryDelayMs);
  const fetchImpl = options.fetcher || globalThis.fetch;

  for (let attempt = 0; attempt <= 1; attempt += 1) {
    const signal = AbortSignal.timeout(timeoutMs);
    let res;
    try {
      res = await fetchImpl(url, { ...init, signal });
    } catch (err) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError' || signal.aborted) {
        const timeoutErr = new Error(`Google Sheets 요청 시간 초과 (${timeoutMs}ms)`);
        timeoutErr.name = 'TimeoutError';
        timeoutErr.code = 'GSHEETS_TIMEOUT';
        timeoutErr.cause = err;
        throw timeoutErr;
      }
      throw err;
    }

    if (!res.ok && RETRYABLE_STATUSES.has(res.status) && attempt === 0) {
      const delayMs = parseRetryAfterMs(res, retryDelayMs);
      try {
        await res.body?.cancel?.();
      } catch (_cancelErr) {
        // ignore body cancel error on retry
      }
      await sleep(delayMs);
      continue;
    }

    return res;
  }

  throw new Error('Google Sheets 요청 재시도 한도를 초과했습니다.');
}

async function getAccessToken(options = {}) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp > now + 60) return cachedToken.token;
  if (!options.fetcher && inFlightToken) return inFlightToken;

  const task = (async () => {
    const account = parseServiceAccount();
    const issuedAt = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const claim = {
      iss: account.client_email,
      scope: SHEETS_SCOPE,
      aud: TOKEN_URL,
      exp: issuedAt + 3600,
      iat: issuedAt,
    };

    const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claim))}`;
    const signature = crypto
      .createSign('RSA-SHA256')
      .update(unsigned)
      .sign(account.private_key, 'base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

    const assertion = `${unsigned}.${signature}`;
    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    });

    const res = await fetchWithTimeoutAndRetry(
      TOKEN_URL,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      },
      options
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error_description || data.error || `Google access token 발급 실패 (HTTP ${res.status})`);
      err.status = res.status;
      throw err;
    }

    cachedToken = {
      token: data.access_token,
      exp: issuedAt + Number(data.expires_in || 3600),
    };
    return cachedToken.token;
  })().finally(() => {
    if (inFlightToken === task) inFlightToken = null;
  });

  if (!options.fetcher) inFlightToken = task;
  return task;
}

export function getKakaoSheetId() {
  return extractSheetId(process.env.KAKAO_SHEET_ID || process.env.GOOGLE_SHEET_URL) || DEFAULT_KAKAO_SHEET_ID;
}

// 지금 쓰는 시트(2호)와 보관용 시트(1호)를 함께 돌려준다. 둘이 같으면 하나만 준다.
export function getKakaoSheetIds() {
  const primary = getKakaoSheetId();
  const archive = extractSheetId(process.env.KAKAO_ARCHIVE_SHEET_ID) || ARCHIVE_KAKAO_SHEET_ID;
  return archive && archive !== primary ? [primary, archive] : [primary];
}

export function getKakaoArchiveSheetId() {
  const ids = getKakaoSheetIds();
  return ids.length > 1 ? ids[1] : '';
}

// 2호로 막 넘어온 때는 2호 탭에 헤더만 있고 데이터가 없다(운영 PC 업로더가 아직 1호에 쓰는 구간).
// 그 구간에 화면이 비지 않도록 2호가 비어 있으면 1호를 읽어 준다. 어느 시트에서 읽었는지도 함께 돌려준다.
export async function readSheetValuesWithArchive({
  range,
  ttlMs,
  noCache = false,
  timeoutMs,
  retryDelayMs,
  fetcher,
  minRows = 2,
} = {}) {
  const ids = getKakaoSheetIds();
  let best = null;
  let lastError = null;

  for (let i = 0; i < ids.length; i += 1) {
    const spreadsheetId = ids[i];
    try {
      const values = await readSheetValues({
        spreadsheetId,
        range,
        ttlMs,
        noCache,
        timeoutMs,
        retryDelayMs,
        fetcher,
      });
      const rows = Array.isArray(values) ? values : [];
      const source = i === 0 ? 'primary' : 'archive';
      if (rows.length >= minRows) return { spreadsheetId, values: rows, source };
      if (!best || rows.length > best.values.length) best = { spreadsheetId, values: rows, source };
    } catch (err) {
      lastError = err;
    }
  }

  if (best) return best;
  if (lastError) throw lastError;
  return { spreadsheetId: ids[0], values: [], source: 'primary' };
}

export async function readSheetValues({
  spreadsheetId,
  range,
  ttlMs,
  noCache = false,
  timeoutMs,
  retryDelayMs,
  fetcher,
} = {}) {
  const targetId = extractSheetId(spreadsheetId) || String(spreadsheetId || '').trim();
  const targetRange = String(range || '').trim();
  const effectiveTtlMs = noCache ? 0 : getGoogleSheetsCacheTtlMs(ttlMs);
  const cacheKey = `values::${targetId}::${targetRange}`;

  if (effectiveTtlMs > 0) {
    const cached = getCacheEntry(readCache, cacheKey);
    if (cached.hit) return cached.value;
  }

  if (!noCache && inFlightReads.has(cacheKey)) {
    return inFlightReads.get(cacheKey);
  }

  const reqOpts = { timeoutMs, retryDelayMs, fetcher };
  const task = (async () => {
    const token = await getAccessToken(reqOpts);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(targetId)}/values/${encodeURIComponent(targetRange)}?majorDimension=ROWS`;
    const res = await fetchWithTimeoutAndRetry(
      url,
      { headers: { Authorization: `Bearer ${token}` } },
      reqOpts
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error?.message || `Google Sheet 조회 실패 (HTTP ${res.status})`);
      err.status = res.status;
      throw err;
    }
    const values = data.values || [];
    if (effectiveTtlMs > 0) {
      setCacheEntry(readCache, cacheKey, values, effectiveTtlMs);
    }
    return values;
  })().finally(() => {
    if (inFlightReads.get(cacheKey) === task) {
      inFlightReads.delete(cacheKey);
    }
  });

  if (!noCache) inFlightReads.set(cacheKey, task);
  return task;
}

export function evaluateSheetCapacity(
  metadata,
  {
    spreadsheetId = '',
    maxCells = SHEETS_MAX_CELLS,
    warnPct = SHEETS_WARN_PCT,
    criticalPct = SHEETS_CRITICAL_PCT,
  } = {}
) {
  const rawSheets = Array.isArray(metadata?.sheets) ? metadata.sheets : [];
  const tabs = rawSheets
    .map((sheet) => {
      const props = sheet?.properties || {};
      const grid = props.gridProperties || {};
      const rowCount = Math.max(0, Number(grid.rowCount || 0));
      const columnCount = Math.max(0, Number(grid.columnCount || 0));
      const cells = rowCount * columnCount;
      const usagePct = maxCells > 0 ? Number(((cells / maxCells) * 100).toFixed(2)) : 0;
      return {
        title: String(props.title || '(untitled)'),
        rowCount,
        columnCount,
        cells,
        usagePct,
      };
    })
    .sort((a, b) => b.cells - a.cells || a.title.localeCompare(b.title, 'ko'));

  const totalCells = tabs.reduce((sum, tab) => sum + tab.cells, 0);
  const remainingCells = Math.max(0, maxCells - totalCells);
  const usagePct = maxCells > 0 ? Number(((totalCells / maxCells) * 100).toFixed(2)) : 0;
  const status =
    usagePct >= criticalPct ? 'critical' : usagePct >= warnPct ? 'warn' : 'ok';

  return {
    spreadsheetId,
    totalCells,
    maxCells,
    remainingCells,
    usagePct,
    status,
    thresholds: { warnPct, criticalPct },
    tabCount: tabs.length,
    tabs,
    topTabs: tabs.slice(0, 5),
  };
}

export async function readSheetCapacity({
  spreadsheetId = getKakaoSheetId(),
  ttlMs,
  noCache = false,
  timeoutMs,
  retryDelayMs,
  fetcher,
  maxCells = SHEETS_MAX_CELLS,
  warnPct = SHEETS_WARN_PCT,
  criticalPct = SHEETS_CRITICAL_PCT,
} = {}) {
  const targetId = extractSheetId(spreadsheetId) || String(spreadsheetId || '').trim();
  const effectiveTtlMs = noCache ? 0 : getGoogleSheetsCacheTtlMs(ttlMs);
  const cacheKey = `capacity::${targetId}::${maxCells}::${warnPct}::${criticalPct}`;

  if (effectiveTtlMs > 0) {
    const cached = getCacheEntry(readCache, cacheKey);
    if (cached.hit) return cached.value;
  }

  if (!noCache && inFlightReads.has(cacheKey)) {
    return inFlightReads.get(cacheKey);
  }

  const reqOpts = { timeoutMs, retryDelayMs, fetcher };
  const task = (async () => {
    const token = await getAccessToken(reqOpts);
    const fields = encodeURIComponent('sheets.properties(title,gridProperties)');
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(targetId)}?fields=${fields}`;
    const res = await fetchWithTimeoutAndRetry(
      url,
      { headers: { Authorization: `Bearer ${token}` } },
      reqOpts
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error?.message || `Google Sheet 용량 메타데이터 조회 실패 (HTTP ${res.status})`);
      err.status = res.status;
      throw err;
    }
    const evaluated = {
      ...evaluateSheetCapacity(data, { spreadsheetId: targetId, maxCells, warnPct, criticalPct }),
      checkedAt: new Date().toISOString(),
    };
    if (effectiveTtlMs > 0) {
      setCacheEntry(readCache, cacheKey, evaluated, effectiveTtlMs);
    }
    return evaluated;
  })().finally(() => {
    if (inFlightReads.get(cacheKey) === task) {
      inFlightReads.delete(cacheKey);
    }
  });

  if (!noCache) inFlightReads.set(cacheKey, task);
  return task;
}
