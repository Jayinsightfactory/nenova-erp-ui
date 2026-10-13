// lib/shinhanApi.js — 신한은행 오픈API(이용기관 인증 2-legged) 클라이언트
//
// 근거 문서: 17.계좌거래내역조회_신한은행 오픈API 연동 가이드(2-legged) v1.5.1
//           26.계좌거래내역조회(여신) 연동 가이드 v0.1
//
// 인증(접근키 발급):  POST {BASE}/v1/oauth/partner/token  (x-www-form-urlencoded)
//   client_hash = Base64( HMAC-SHA256( client_secret, `${timestamp}|${client_id}` ) )
//   접근키 유효 10분(가이드 3.3) → 만료 전 재발급, 멀티 사용 가능.
// 거래 API:            POST {BASE}/v2/firm/search/transactions        (수신 계좌 거래내역)
//                      POST {BASE}/v2/firm/search/loan-transactions   (여신 거래내역)
//   헤더: apiKey(client id) · Authorization: Bearer <접근키> · hsKey = Base64(HMAC-SHA256(client_secret, BODY 문자열))
//         reqKey(요청 추적키, 서버가 그대로 반환) · clientIp
//   바디: { dataHeader: { subChannel }, dataBody: { 계좌번호, 조회시작일, 조회종료일 } }
//
// 키 보관 원칙(보안성심의 6항): client secret 은 서버 .env.local(GitHub Secrets 동기화)에만 두고
// 코드·로그·응답에 절대 싣지 않는다. 계좌번호는 로그/응답에서 maskAccount()로 가린다.

import crypto from 'node:crypto';

export const SHINHAN_BASE_URLS = Object.freeze({
  dev: 'https://dev-shbapi.shinhan.com:6443',
  prod: 'https://shbapi.shinhan.com:6443',
});
export const SHINHAN_PATHS = Object.freeze({
  token: '/v1/oauth/partner/token',
  transactions: '/v2/firm/search/transactions',
  loanTransactions: '/v2/firm/search/loan-transactions',
});
// 가이드: 접근키 유효 10분. 네트워크 지연을 감안해 9분 뒤엔 새로 받는다.
export const TOKEN_TTL_MS = 9 * 60 * 1000;

const ENV_KEYS = ['SHINHAN_CLIENT_ID', 'SHINHAN_CLIENT_SECRET'];

// ── 설정 ──────────────────────────────────────────────
export function loadShinhanConfig(env = process.env) {
  const mode = (env.SHINHAN_ENV || 'dev').toLowerCase() === 'prod' ? 'prod' : 'dev';
  const missing = ENV_KEYS.filter((k) => !env[k]);
  return {
    mode,
    baseUrl: env.SHINHAN_BASE_URL || SHINHAN_BASE_URLS[mode],
    clientId: env.SHINHAN_CLIENT_ID || '',
    clientSecret: env.SHINHAN_CLIENT_SECRET || '',
    subChannel: env.SHINHAN_SUB_CHANNEL || '',
    clientIp: env.SHINHAN_CLIENT_IP || '',
    accounts: parseAccountList(env.SHINHAN_ACCOUNT_NOS),
    loanAccounts: parseAccountList(env.SHINHAN_LOAN_ACCOUNT_NOS),
    configured: missing.length === 0,
    missing,
  };
}

export function parseAccountList(raw) {
  return String(raw || '')
    .split(/[,\s]+/)
    .map((s) => s.replace(/-/g, '').trim())
    .filter(Boolean);
}

// ── 암호 보조 (가이드 4.2 / 5.2) ─────────────────────
export function hmacBase64(secret, message) {
  return crypto.createHmac('sha256', String(secret)).update(String(message), 'utf8').digest('base64');
}

// client_hash = HMAC-SHA256(secret, "<unix timestamp>|<client id>") → Base64
export function buildClientHash(clientId, clientSecret, timestamp) {
  return hmacBase64(clientSecret, `${timestamp}|${clientId}`);
}

// hsKey = HMAC-SHA256(secret, <요청 BODY 문자열 그대로>) → Base64
export function buildHsKey(clientSecret, bodyString) {
  return hmacBase64(clientSecret, bodyString);
}

export function maskAccount(no) {
  const s = String(no || '').replace(/-/g, '');
  if (s.length <= 6) return s ? '***' : '';
  return `${s.slice(0, 3)}${'*'.repeat(s.length - 6)}${s.slice(-3)}`;
}

function yyyymmdd(d) {
  if (typeof d === 'string') return d.replace(/-/g, '').slice(0, 8);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

function toIsoDate(raw) {
  const s = String(raw || '').replace(/[^0-9]/g, '');
  return s.length >= 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : '';
}

function toHms(raw) {
  const s = String(raw || '').replace(/[^0-9]/g, '').padEnd(6, '0').slice(0, 6);
  return `${s.slice(0, 2)}:${s.slice(2, 4)}:${s.slice(4, 6)}`;
}

function num(v) {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

// ── 응답 → BankTransaction 행 매핑 ───────────────────
// 가이드 별첨 응답 항목: 거래일자(2020-08-01)·거래시간(6)·출금금액·입금금액·거래메모·잔액·입지구분(1입금/2출금)·거래점명
export function mapTransactionRow(row, ctx = {}) {
  const inAmt = num(row['입금금액']);
  const outAmt = num(row['출금금액']);
  const kind = String(row['입지구분'] || '').trim();
  const txType = kind === '1' || (kind !== '2' && inAmt > 0) ? '입금' : '출금';
  return {
    txDtm: `${toIsoDate(row['거래일자'])} ${toHms(row['거래시간'])}`,
    txType,
    accountNo: String(ctx.accountNo || row['계좌번호'] || ''),
    accountName: String(ctx.accountName || row['상품부기명'] || ''),
    custName: String(ctx.custName || row['고객명'] || ''),
    amount: txType === '입금' ? inAmt : outAmt,
    balance: num(row['잔액']),
    counterpart: String(row['거래메모'] || '').trim(),
    bankName: '신한은행',
    branchName: String(row['거래점명'] || '').trim(),
    memo: String(row['거래메모'] || '').trim(),
  };
}

// 여신(대출) 거래: 거래일자(8)·거래순번·거래종류·거래금액·원금금액·이자금액·거래후잔액·이율
export function mapLoanRow(row, ctx = {}) {
  return {
    txDtm: `${toIsoDate(row['거래일자'])} 00:00:00`,
    txType: '출금',
    accountNo: String(ctx.accountNo || ''),
    accountName: String(ctx.accountName || '여신'),
    custName: String(ctx.custName || ''),
    amount: num(row['거래금액']),
    balance: num(row['거래후잔액']),
    counterpart: String(row['거래종류'] || '').trim(),
    bankName: '신한은행',
    branchName: '',
    memo: `${row['거래종류'] || ''} 원금 ${num(row['원금금액'])} 이자 ${num(row['이자금액'])} 이율 ${row['이율'] ?? ''} #${row['거래순번'] ?? ''}`.trim(),
  };
}

// ── 에러 해석 (가이드 4.4 / 5.4) ─────────────────────
export class ShinhanApiError extends Error {
  constructor(message, { resultCode, category, httpStatus, retryable = false } = {}) {
    super(message);
    this.name = 'ShinhanApiError';
    this.resultCode = resultCode;
    this.category = category;
    this.httpStatus = httpStatus;
    this.retryable = retryable;
  }
}

export function isTokenExpiredError(header) {
  const code = String(header?.resultCode || '');
  const msg = String(header?.resultMessage || '');
  return code === '89' || /Access token (has expired|does not exist)/i.test(msg);
}

// ── 클라이언트 ────────────────────────────────────────
export function createShinhanClient(options = {}) {
  const cfg = options.config || loadShinhanConfig(options.env);
  const fetchImpl = options.fetch || globalThis.fetch;
  const now = options.now || (() => Date.now());
  let token = null; // { value, expiresAt }

  function assertConfigured() {
    if (!cfg.configured) {
      throw new ShinhanApiError(`신한 API 미설정: ${cfg.missing.join(', ')} (서버 .env.local)`, { resultCode: 'NOT_CONFIGURED' });
    }
  }

  async function getToken(force = false) {
    assertConfigured();
    if (!force && token && token.expiresAt > now()) return token.value;
    const timestamp = Math.floor(now() / 1000);
    const body = new URLSearchParams({
      client_id: cfg.clientId,
      scope: 'oob',
      grant_type: 'client_credentials',
      timestamp: String(timestamp),
      client_hash: buildClientHash(cfg.clientId, cfg.clientSecret, timestamp),
    });
    const res = await fetchImpl(cfg.baseUrl + SHINHAN_PATHS.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: body.toString(),
    });
    const json = await safeJson(res);
    const header = json?.dataHeader || {};
    const accessToken = json?.dataBody?.access_token;
    if (!accessToken) {
      throw new ShinhanApiError(`접근키 발급 실패: ${header.resultCode || res.status} ${header.resultMessage || ''}`.trim(), {
        resultCode: header.resultCode, category: header.category, httpStatus: res.status,
      });
    }
    const ttlFromBank = Number(json.dataBody.expires_in) > 0 ? Number(json.dataBody.expires_in) * 1000 : TOKEN_TTL_MS;
    token = { value: accessToken, expiresAt: now() + Math.min(ttlFromBank, TOKEN_TTL_MS) };
    return token.value;
  }

  async function call(path, dataBody, { retryOnExpired = true } = {}) {
    const accessToken = await getToken();
    const bodyString = JSON.stringify({ dataHeader: { subChannel: cfg.subChannel }, dataBody });
    const reqKey = crypto.randomUUID();
    const res = await fetchImpl(cfg.baseUrl + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        Accept: 'application/json; charset=UTF-8',
        reqKey,
        apiKey: cfg.clientId,
        Authorization: `Bearer ${accessToken}`,
        hsKey: buildHsKey(cfg.clientSecret, bodyString),
        clientIp: cfg.clientIp,
      },
      body: bodyString,
    });
    const json = await safeJson(res);
    const header = json?.dataHeader || {};
    if (String(header.successCode ?? '0') === '1' || !res.ok) {
      if (retryOnExpired && isTokenExpiredError(header)) {
        token = null;
        return call(path, dataBody, { retryOnExpired: false });
      }
      throw new ShinhanApiError(`${header.resultCode || res.status} ${header.resultMessage || 'API 오류'}`.trim(), {
        resultCode: header.resultCode, category: header.category, httpStatus: res.status,
        retryable: ['500', '503'].includes(String(header.resultCode)),
      });
    }
    return { reqKey, dataBody: json?.dataBody || {}, dataHeader: header };
  }

  // 수신계좌 거래내역 (/v2/firm/search/transactions)
  async function fetchTransactions({ accountNo, from, to }) {
    const r = await call(SHINHAN_PATHS.transactions, {
      계좌번호: String(accountNo).replace(/-/g, ''),
      조회시작일: yyyymmdd(from),
      조회종료일: yyyymmdd(to),
    });
    const ctx = { accountNo, accountName: r.dataBody['상품부기명'], custName: r.dataBody['고객명'] };
    const rows = Array.isArray(r.dataBody['거래내역']) ? r.dataBody['거래내역'] : [];
    return { balance: num(r.dataBody['계좌잔액']), rows: rows.map((row) => mapTransactionRow(row, ctx)), reqKey: r.reqKey };
  }

  // 여신 거래내역 (/v2/firm/search/loan-transactions) — 다음여부=1 이면 다음거래순번으로 이어서 조회
  async function fetchLoanTransactions({ accountNo, from, to, maxPages = 20 }) {
    const out = [];
    let startSeq = null;
    let balance = 0;
    let loanTotal = 0;
    for (let page = 0; page < maxPages; page += 1) {
      const dataBody = { 계좌번호: String(accountNo).replace(/-/g, '') };
      if (from) dataBody['조회시작일'] = yyyymmdd(from);
      if (to) dataBody['조회종료일'] = yyyymmdd(to);
      if (startSeq != null) dataBody['조회시작거래번호'] = startSeq;
      const r = await call(SHINHAN_PATHS.loanTransactions, dataBody);
      const ctx = { accountNo, accountName: r.dataBody['상품명'], custName: r.dataBody['고객명'] };
      const rows = Array.isArray(r.dataBody['거래내역']) ? r.dataBody['거래내역'] : [];
      out.push(...rows.map((row) => mapLoanRow(row, ctx)));
      balance = num(r.dataBody['대출잔액']);
      loanTotal = num(r.dataBody['대출누계금액']);
      if (String(r.dataBody['다음여부']) !== '1') break;
      startSeq = r.dataBody['다음거래순번'];
    }
    return { balance, loanTotal, rows: out };
  }

  return { config: cfg, getToken, call, fetchTransactions, fetchLoanTransactions, maskAccount };
}

async function safeJson(res) {
  try { return await res.json(); } catch { return null; }
}
