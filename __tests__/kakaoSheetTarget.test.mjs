// 카카오 시트 2호 전환: 기본 대상이 2호인지, 2호가 비어 있을 때 1호(아카이브)로 읽는지 확인한다.
// 외부 호출은 없음 — 서비스 계정 키는 테스트 안에서 만들고 fetch 는 가짜로 바꾼다.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  clearGoogleSheetsCache,
  getKakaoArchiveSheetId,
  getKakaoSheetId,
  getKakaoSheetIds,
  readSheetValuesWithArchive,
} from '../lib/googleSheets.js';

const SHEET_2ND_ID = '1x7kGxLMOgHcf4_120vDXRa77-2Pi3VKXs2NlBe-4dAE';
const SHEET_1ST_ID = '1pXLVZqiMwWt6Vh0IhWwASBvgLtZqLnbHXMWqOLNwAXU';

const { privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const TEST_SA_JSON = JSON.stringify({
  client_email: 'sheets-test@example.iam.gserviceaccount.com',
  private_key: privateKey,
});

const ENV_KEYS = [
  'GOOGLE_SERVICE_ACCOUNT_JSON',
  'GOOGLE_SHEETS_CACHE_TTL_MS',
  'KAKAO_SHEET_ID',
  'GOOGLE_SHEET_URL',
  'KAKAO_ARCHIVE_SHEET_ID',
];

function jsonResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    body: { cancel: async () => {} },
    json: async () => body,
  };
}

async function withEnv(env, fn) {
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  const savedFetch = globalThis.fetch;
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = TEST_SA_JSON;
  Object.assign(process.env, env);
  clearGoogleSheetsCache();
  try {
    return await fn();
  } finally {
    clearGoogleSheetsCache();
    globalThis.fetch = savedFetch;
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function sheetFetch(rowsBySheet) {
  return async (url) => {
    const target = String(url);
    if (target.includes('oauth2.googleapis.com/token')) {
      return jsonResponse({ access_token: 'tok-test', expires_in: 3600 });
    }
    for (const [id, rows] of Object.entries(rowsBySheet)) {
      if (target.includes(encodeURIComponent(id))) return jsonResponse({ values: rows });
    }
    return jsonResponse({ error: { message: 'PERMISSION_DENIED' } }, { status: 403 });
  };
}

test('기본 읽기 대상은 2호이고, 1호는 아카이브로 함께 남는다', async () => {
  await withEnv({}, async () => {
    assert.equal(getKakaoSheetId(), SHEET_2ND_ID);
    assert.equal(getKakaoArchiveSheetId(), SHEET_1ST_ID);
    assert.deepEqual(getKakaoSheetIds(), [SHEET_2ND_ID, SHEET_1ST_ID]);
  });
});

test('KAKAO_SHEET_ID 는 URL 이든 ID 든 기본값을 이긴다', async () => {
  await withEnv({ KAKAO_SHEET_ID: `https://docs.google.com/spreadsheets/d/${SHEET_1ST_ID}/edit#gid=0` }, async () => {
    assert.equal(getKakaoSheetId(), SHEET_1ST_ID);
    assert.deepEqual(getKakaoSheetIds(), [SHEET_1ST_ID]);
  });
  await withEnv({ KAKAO_SHEET_ID: 'sheet-by-env', GOOGLE_SHEET_URL: 'ignored-when-sheet-id-set' }, async () => {
    assert.equal(getKakaoSheetId(), 'sheet-by-env');
    assert.deepEqual(getKakaoSheetIds(), ['sheet-by-env', SHEET_1ST_ID]);
  });
});

test('2호가 헤더만 있으면 1호에서 읽고, 2호에 데이터가 쌓이면 2호에서 읽는다', async () => {
  const header = ['시각', '방이름', '파이프라인', '발신자', '원문', '메시지ID'];

  await withEnv({}, async () => {
    globalThis.fetch = sheetFetch({
      [SHEET_2ND_ID]: [header],
      [SHEET_1ST_ID]: [header, ['오전 9:00', '수입방', 'IMPORT', '가브리엘', '1호 원문', 'msg1']],
    });
    const archived = await readSheetValuesWithArchive({ range: '이벤트로그!A:F' });
    assert.equal(archived.source, 'archive');
    assert.equal(archived.spreadsheetId, SHEET_1ST_ID);
    assert.equal(archived.values.length, 2);
    assert.equal(archived.values[1][4], '1호 원문');
  });

  await withEnv({}, async () => {
    globalThis.fetch = sheetFetch({
      [SHEET_2ND_ID]: [header, ['오전 9:05', '수입방', 'IMPORT', '아드리아나', '2호 원문', 'msg2']],
      [SHEET_1ST_ID]: [header, ['오전 9:00', '수입방', 'IMPORT', '가브리엘', '1호 원문', 'msg1']],
    });
    const live = await readSheetValuesWithArchive({ range: '이벤트로그!A:F' });
    assert.equal(live.source, 'primary');
    assert.equal(live.spreadsheetId, SHEET_2ND_ID);
    assert.equal(live.values[1][4], '2호 원문');
  });
});

test('KAKAO_ARCHIVE_SHEET_ID 가 대상과 같으면 보관 시트로 되돌아 읽지 않는다', async () => {
  await withEnv({ KAKAO_ARCHIVE_SHEET_ID: SHEET_2ND_ID }, async () => {
    assert.deepEqual(getKakaoSheetIds(), [SHEET_2ND_ID]);
    globalThis.fetch = sheetFetch({ [SHEET_2ND_ID]: [['헤더']] });
    const result = await readSheetValuesWithArchive({ range: '이벤트로그!A:F' });
    assert.equal(result.source, 'primary');
    assert.equal(result.values.length, 1);
  });
});
