import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  clearGoogleSheetsCache,
  evaluateSheetCapacity,
  getGoogleSheetsCacheStats,
  getGoogleSheetsTimeoutMs,
  readSheetCapacity,
  readSheetValues,
  SHEETS_MAX_CELLS,
} from '../lib/googleSheets.js';
import {
  classifyImportFeed,
  importCustomerAliases,
  latestImportFeed,
} from '../lib/importKakaoOrderText.js';
import { offsetImportDay } from '../lib/importKakaoArchive.js';

const { privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const TEST_SA_JSON = JSON.stringify({
  client_email: 'sheets-test@example.iam.gserviceaccount.com',
  private_key: privateKey,
});

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  const headerMap = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name) => headerMap.get(String(name).toLowerCase()) ?? null,
    },
    body: {
      cancel: async () => {},
    },
    json: async () => body,
  };
}

async function withMockedEnvAndFetch(mockFetch, fn, extraEnv = {}) {
  const savedEnv = {
    GOOGLE_SERVICE_ACCOUNT_JSON: process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
    GOOGLE_SHEETS_TIMEOUT_MS: process.env.GOOGLE_SHEETS_TIMEOUT_MS,
    GOOGLE_SHEETS_CACHE_TTL_MS: process.env.GOOGLE_SHEETS_CACHE_TTL_MS,
    GOOGLE_SHEETS_RETRY_DELAY_MS: process.env.GOOGLE_SHEETS_RETRY_DELAY_MS,
    KAKAO_SHEET_ID: process.env.KAKAO_SHEET_ID,
  };
  const savedFetch = globalThis.fetch;

  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = TEST_SA_JSON;
  process.env.GOOGLE_SHEETS_RETRY_DELAY_MS = '5';
  delete process.env.GOOGLE_SHEETS_TIMEOUT_MS;
  delete process.env.GOOGLE_SHEETS_CACHE_TTL_MS;
  for (const [k, v] of Object.entries(extraEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = String(v);
  }
  clearGoogleSheetsCache();
  globalThis.fetch = mockFetch;

  try {
    return await fn();
  } finally {
    clearGoogleSheetsCache();
    globalThis.fetch = savedFetch;
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('OAuth/Sheets fetch applies AbortSignal.timeout and honors GOOGLE_SHEETS_TIMEOUT_MS', async () => {
  const seenSignals = [];
  await withMockedEnvAndFetch(
    async (url, init) => {
      seenSignals.push({ url: String(url), hasSignal: init?.signal instanceof AbortSignal });
      if (String(url).includes('oauth2.googleapis.com/token')) {
        return jsonResponse({ access_token: 'tok-timeout-check', expires_in: 3600 });
      }
      return new Promise((_, reject) => {
        init.signal.addEventListener('abort', () => {
          reject(init.signal.reason || Object.assign(new Error('aborted'), { name: 'TimeoutError' }));
        });
      });
    },
    async () => {
      assert.equal(getGoogleSheetsTimeoutMs(), 40);
      await assert.rejects(
        () => readSheetValues({ spreadsheetId: 'sheet-timeout', range: 'A1:B2' }),
        (err) => err.code === 'GSHEETS_TIMEOUT' && err.name === 'TimeoutError' && /40ms/.test(err.message)
      );
      assert.equal(seenSignals.length, 2);
      assert.equal(seenSignals.every((s) => s.hasSignal), true);
      assert.equal(getGoogleSheetsCacheStats().readCacheSize, 0);
      assert.equal(getGoogleSheetsCacheStats().inFlightSize, 0);
    },
    { GOOGLE_SHEETS_TIMEOUT_MS: '40' }
  );
});

test('retries once with short backoff on 429 and 503, and fails after exhausting single retry', async () => {
  let valuesAttempts = 0;
  let tokenAttempts = 0;

  await withMockedEnvAndFetch(
    async (url) => {
      const target = String(url);
      if (target.includes('oauth2.googleapis.com/token')) {
        tokenAttempts += 1;
        if (tokenAttempts === 1) return jsonResponse({ error: 'temporarily_unavailable' }, { status: 503 });
        return jsonResponse({ access_token: 'tok-retry', expires_in: 3600 });
      }
      valuesAttempts += 1;
      if (valuesAttempts === 1) {
        return jsonResponse(
          { error: { message: 'Quota exceeded for quota metric (429)' } },
          { status: 429, headers: { 'retry-after': '0' } }
        );
      }
      if (target.includes('always-429')) {
        return jsonResponse({ error: { message: '429 RESOURCE_EXHAUSTED' } }, { status: 429 });
      }
      return jsonResponse({ values: [['헤더'], ['행1']] });
    },
    async () => {
      const rows = await readSheetValues({ spreadsheetId: 'sheet-retry', range: '테스트!A1:B2' });
      assert.deepEqual(rows, [['헤더'], ['행1']]);
      assert.equal(tokenAttempts, 2);
      assert.equal(valuesAttempts, 2);

      const beforeFailAttempts = valuesAttempts;
      await assert.rejects(
        () => readSheetValues({ spreadsheetId: 'always-429', range: '테스트!A1:B2' }),
        (err) => err.status === 429 && /429/.test(err.message)
      );
      // Initial attempt + 1 retry = 2 calls
      assert.equal(valuesAttempts - beforeFailAttempts, 2);
    }
  );
});

test('deduplicates concurrent reads via singleflight and serves subsequent reads from 60s TTL cache', async () => {
  let tokenCalls = 0;
  let sheetCalls = 0;

  await withMockedEnvAndFetch(
    async (url) => {
      if (String(url).includes('oauth2.googleapis.com/token')) {
        tokenCalls += 1;
        await new Promise((r) => setTimeout(r, 15));
        return jsonResponse({ access_token: 'tok-sf', expires_in: 3600 });
      }
      sheetCalls += 1;
      await new Promise((r) => setTimeout(r, 20));
      return jsonResponse({ values: [['colA'], [`batch-${sheetCalls}`]] });
    },
    async () => {
      const results = await Promise.all([
        readSheetValues({ spreadsheetId: 'sheet-sf', range: "'수입방 주문검토'!A:U" }),
        readSheetValues({ spreadsheetId: 'sheet-sf', range: "'수입방 주문검토'!A:U" }),
        readSheetValues({ spreadsheetId: 'sheet-sf', range: "'수입방 주문검토'!A:U" }),
        readSheetValues({ spreadsheetId: 'sheet-sf', range: "'수입방 주문검토'!A:U" }),
        readSheetValues({ spreadsheetId: 'sheet-sf', range: "'수입방 주문검토'!A:U" }),
      ]);
      assert.equal(tokenCalls, 1);
      assert.equal(sheetCalls, 1);
      for (const rows of results) {
        assert.deepEqual(rows, [['colA'], ['batch-1']]);
      }

      // Subsequent read within 60s TTL hits cache with 0 extra fetch calls
      const cached = await readSheetValues({ spreadsheetId: 'sheet-sf', range: "'수입방 주문검토'!A:U" });
      assert.deepEqual(cached, [['colA'], ['batch-1']]);
      assert.equal(sheetCalls, 1);

      // Short TTL expiration triggers fresh read
      clearGoogleSheetsCache();
      const firstShort = await readSheetValues({ spreadsheetId: 'sheet-ttl', range: 'A1:A2', ttlMs: 25 });
      assert.equal(firstShort[1][0], 'batch-2');
      await new Promise((r) => setTimeout(r, 40));
      const afterExpire = await readSheetValues({ spreadsheetId: 'sheet-ttl', range: 'A1:A2', ttlMs: 25 });
      assert.equal(afterExpire[1][0], 'batch-3');
    }
  );
});

test('readSheetCapacity calculates 10M cell ratio, top-5 tabs, and ok/warn/critical thresholds (96.5% critical)', async () => {
  const okEval = evaluateSheetCapacity({
    sheets: [{ properties: { title: '이벤트로그', gridProperties: { rowCount: 450_000, columnCount: 10 } } }],
  });
  assert.equal(okEval.usagePct, 45);
  assert.equal(okEval.status, 'ok');

  const warnEval = evaluateSheetCapacity({
    sheets: [{ properties: { title: '이벤트로그', gridProperties: { rowCount: 820_000, columnCount: 10 } } }],
  });
  assert.equal(warnEval.usagePct, 82);
  assert.equal(warnEval.status, 'warn');

  let requestedUrl = '';
  let metaCalls = 0;
  await withMockedEnvAndFetch(
    async (url) => {
      const target = String(url);
      if (target.includes('oauth2.googleapis.com/token')) {
        return jsonResponse({ access_token: 'tok-cap', expires_in: 3600 });
      }
      metaCalls += 1;
      requestedUrl = target;
      return jsonResponse({
        sheets: [
          { properties: { title: '이벤트로그', gridProperties: { rowCount: 700_000, columnCount: 8 } } },       // 5,600,000
          { properties: { title: '비즈니스이벤트', gridProperties: { rowCount: 150_000, columnCount: 16 } } },   // 2,400,000
          { properties: { title: '수입방 주문검토', gridProperties: { rowCount: 50_000, columnCount: 21 } } },   // 1,050,000
          { properties: { title: '의사결정추적', gridProperties: { rowCount: 40_000, columnCount: 10 } } },      //   400,000
          { properties: { title: '주문요약', gridProperties: { rowCount: 15_000, columnCount: 10 } } },          //   150,000
          { properties: { title: '설정', gridProperties: { rowCount: 5_000, columnCount: 10 } } },               //    50,000
        ],
      });
    },
    async () => {
      const cap = await readSheetCapacity({ spreadsheetId: 'sheet-965' });
      assert.match(requestedUrl, /fields=sheets\.properties\(title%2CgridProperties\)/);
      assert.equal(cap.totalCells, 9_650_000);
      assert.equal(cap.maxCells, SHEETS_MAX_CELLS);
      assert.equal(cap.remainingCells, 350_000);
      assert.equal(cap.usagePct, 96.5);
      assert.equal(cap.status, 'critical');
      assert.equal(cap.tabCount, 6);
      assert.equal(cap.topTabs.length, 5);
      assert.equal(cap.topTabs[0].title, '이벤트로그');
      assert.equal(cap.topTabs[0].cells, 5_600_000);
      assert.equal(cap.topTabs[4].title, '주문요약');

      // Cached on second read
      const cached = await readSheetCapacity({ spreadsheetId: 'sheet-965' });
      assert.equal(cached.usagePct, 96.5);
      assert.equal(metaCalls, 1);
    }
  );
});

test('kakao-additions isolates Google Sheet failures (429/limit/timeout) and serves Orbit primary data with HTTP 200 + aliasWarning', async () => {
  const routeRaw = fs.readFileSync(new URL('../pages/api/import/tools/kakao-additions.js', import.meta.url), 'utf8');
  assert.doesNotMatch(routeRaw, /catch\s*\{\s*\}/, 'kakao-additions.js must not contain empty catch {} blocks');

  const routeSource = routeRaw
    .replace(/^import .*;\r?$/gm, '')
    .replace('export default withAuth(', 'return withAuth(');

  const sampleOrbitMessages = [
    {
      id: 'archive:sample-1',
      time: '2026년 11월 25일 오전 9:10',
      text: '48-1 콜 수국 발주 추가\nCL2\n화이트 15박스',
      sender: 'fixture',
      items: [],
    },
  ];

  const buildRoute = ({ readSheetValuesStub, readImportArchiveStub }) =>
    new Function(
      'withAuth',
      'canManageInvoiceReceipt',
      'getKakaoSheetId',
      'readSheetValues',
      'todaySeoul',
      'classifyImportFeed',
      'importCustomerAliases',
      'latestImportFeed',
      'offsetImportDay',
      'readImportArchive',
      routeSource
    )(
      (fn) => fn,
      () => true,
      () => 'fixture-sheet',
      readSheetValuesStub,
      () => '2026-11-25',
      classifyImportFeed,
      importCustomerAliases,
      latestImportFeed,
      offsetImportDay,
      readImportArchiveStub
    );

  const invoke = async (route, query = { day: '2026-11-25' }) => {
    const res = {
      code: 200,
      headers: {},
      body: null,
      setHeader(k, v) { this.headers[k] = v; },
      status(c) { this.code = c; return this; },
      end() { return this; },
      json(b) { this.body = b; return this; },
    };
    await route({ method: 'GET', user: { authority: 1 }, query }, res);
    return res;
  };

  // 1) Google Sheet 429 / 10M cell limit error -> HTTP 200 + Orbit messages + aliasWarning
  const limitRoute = buildRoute({
    readSheetValuesStub: async () => {
      const err = new Error('This action would increase the number of cells in the workbook above the limit of 10000000 cells (429)');
      err.status = 429;
      throw err;
    },
    readImportArchiveStub: async () => sampleOrbitMessages,
  });
  const limitRes = await invoke(limitRoute);
  assert.equal(limitRes.code, 200);
  assert.equal(limitRes.body.messages.length, 1);
  assert.equal(limitRes.body.messages[0].items[0].quantity, '15');
  assert.equal(limitRes.body.messages[0].items[0].customer, 'CL2');
  assert.match(limitRes.body.aliasWarning, /한도|429/);

  // 2) Google Sheet timeout -> HTTP 200 + Orbit messages + aliasWarning (default window path)
  const timeoutRoute = buildRoute({
    readSheetValuesStub: async () => {
      const err = new Error('Google Sheets 요청 시간 초과 (12000ms)');
      err.name = 'TimeoutError';
      err.code = 'GSHEETS_TIMEOUT';
      throw err;
    },
    readImportArchiveStub: async () => sampleOrbitMessages,
  });
  const timeoutRes = await invoke(timeoutRoute, { days: '14' });
  assert.equal(timeoutRes.code, 200);
  assert.equal(timeoutRes.body.messages.length, 1);
  assert.equal(timeoutRes.body.windowDays, 14);
  assert.match(timeoutRes.body.aliasWarning, /시간 초과/);

  // 3) Google Sheet healthy -> HTTP 200, alias applied, no aliasWarning
  const aliasRow = Array(21).fill('');
  aliasRow[7] = 'CL2';
  aliasRow[8] = '연습꽃도매';
  const healthyRoute = buildRoute({
    readSheetValuesStub: async () => [[], aliasRow],
    readImportArchiveStub: async () => sampleOrbitMessages,
  });
  const healthyRes = await invoke(healthyRoute);
  assert.equal(healthyRes.code, 200);
  assert.equal(healthyRes.body.messages[0].items[0].customer, '연습꽃도매');
  assert.equal('aliasWarning' in healthyRes.body, false);

  // 4) Primary Orbit archive failure -> HTTP 502 with sanitized detail
  const archiveFailRoute = buildRoute({
    readSheetValuesStub: async () => [[], aliasRow],
    readImportArchiveStub: async () => {
      throw new Error('Kakao archive unavailable Bearer secret-token-123');
    },
  });
  const failRes = await invoke(archiveFailRoute);
  assert.equal(failRes.code, 502);
  assert.match(failRes.body.error, /아카이브/);
  assert.doesNotMatch(failRes.body.detail, /secret-token-123/);
  assert.match(failRes.body.detail, /\[redacted\]/);
});

test('/api/kakao/diag returns 10M cell capacity, top-5 tabs, critical hint, and degrades safely on metadata failure', async () => {
  const diagRaw = fs.readFileSync(new URL('../pages/api/kakao/diag.js', import.meta.url), 'utf8');
  const diagSource = diagRaw
    .replace(/^import .*;\r?$/gm, '')
    .replace('export default withAuth(handler);', 'return withAuth(handler);');

  const buildDiag = ({ readSheetValuesStub, readSheetCapacityStub }) =>
    new Function('withAuth', 'getKakaoSheetId', 'readSheetCapacity', 'readSheetValues', diagSource)(
      (fn) => fn,
      () => 'sheet-diag-1',
      readSheetCapacityStub,
      readSheetValuesStub
    );

  const invokeDiag = async (route) => {
    const res = {
      code: 200,
      body: null,
      status(c) { this.code = c; return this; },
      json(b) { this.body = b; return this; },
    };
    await route({ method: 'GET', user: { authority: 1 }, query: {} }, res);
    return res;
  };

  const savedSa = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = TEST_SA_JSON;
  try {
    const criticalCap = {
      ...evaluateSheetCapacity({
        sheets: [
          { properties: { title: '이벤트로그', gridProperties: { rowCount: 600_000, columnCount: 10 } } },
          { properties: { title: '비즈니스이벤트', gridProperties: { rowCount: 150_000, columnCount: 16 } } },
          { properties: { title: '수입방 주문검토', gridProperties: { rowCount: 50_000, columnCount: 20 } } },
          { properties: { title: '의사결정추적', gridProperties: { rowCount: 15_000, columnCount: 10 } } },
          { properties: { title: '요약', gridProperties: { rowCount: 8_000, columnCount: 10 } } },
          { properties: { title: '기타', gridProperties: { rowCount: 2_000, columnCount: 10 } } },
        ],
      }),
      checkedAt: '2026-11-25T13:50:00.000Z',
    };

    const diagRoute = buildDiag({
      readSheetValuesStub: async () => [['h'], ['r1']],
      readSheetCapacityStub: async () => criticalCap,
    });
    const res = await invokeDiag(diagRoute);
    assert.equal(res.code, 200);
    assert.equal(res.body.connected, true);
    assert.equal(res.body.capacity.ok, true);
    assert.equal(res.body.capacity.totalCells, 9_650_000);
    assert.equal(res.body.capacity.maxCells, 10_000_000);
    assert.equal(res.body.capacity.usagePct, 96.5);
    assert.equal(res.body.capacity.status, 'critical');
    assert.equal(res.body.capacity.topTabs.length, 5);
    assert.equal(res.body.capacity.topTabs[0].title, '이벤트로그');
    assert.match(res.body.hint, /긴급 용량 경고/);
    assert.match(res.body.hint, /96\.5%/);

    // Metadata error still returns HTTP 200 with connected=true and capacity.ok=false
    const degradedDiag = buildDiag({
      readSheetValuesStub: async () => [['h']],
      readSheetCapacityStub: async () => {
        throw new Error('Google Sheets 요청 시간 초과 (12000ms)');
      },
    });
    const degradedRes = await invokeDiag(degradedDiag);
    assert.equal(degradedRes.code, 200);
    assert.equal(degradedRes.body.connected, true);
    assert.equal(degradedRes.body.capacity.ok, false);
    assert.equal(degradedRes.body.capacity.status, 'error');
    assert.match(degradedRes.body.hint, /용량 메타데이터 조회 실패/);
  } finally {
    if (savedSa === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    else process.env.GOOGLE_SERVICE_ACCOUNT_JSON = savedSa;
  }
});
