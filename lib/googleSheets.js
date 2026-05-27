import crypto from 'crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const DEFAULT_KAKAO_SHEET_ID = '1pXLVZqiMwWt6Vh0IhWwASBvgLtZqLnbHXMWqOLNwAXU';

let cachedToken = null;

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

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp > now + 60) return cachedToken.token;

  const account = parseServiceAccount();
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: account.client_email,
    scope: SHEETS_SCOPE,
    aud: TOKEN_URL,
    exp: now + 3600,
    iat: now,
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

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error_description || data.error || 'Google access token 발급 실패');
  }

  cachedToken = {
    token: data.access_token,
    exp: now + Number(data.expires_in || 3600),
  };
  return cachedToken.token;
}

export function getKakaoSheetId() {
  return extractSheetId(process.env.KAKAO_SHEET_ID || process.env.GOOGLE_SHEET_URL) || DEFAULT_KAKAO_SHEET_ID;
}

export async function readSheetValues({ spreadsheetId, range }) {
  const token = await getAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?majorDimension=ROWS`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error?.message || 'Google Sheet 조회 실패');
  }
  return data.values || [];
}
