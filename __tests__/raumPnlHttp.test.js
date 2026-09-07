import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fetchRaumPnlJson, readRaumPnlJsonResponse } from '../lib/raumPnlHttp.js';

async function rejects(response, context, pattern) {
  await assert.rejects(() => readRaumPnlJsonResponse(response, context), pattern);
}

const pnlSource = fs.readFileSync(new URL('../pages/raum/pnl.js', import.meta.url), 'utf8');
assert.match(pnlSource, /import \{ fetchRaumPnlJson, MAX_RAUM_PNL_UPLOAD_BYTES \} from '\.\.\/\.\.\/lib\/raumPnlHttp'/,
  'P&L page must use its scoped HTTP reader rather than the global parser');
assert.match(pnlSource, /Number\(file\.size\) > MAX_RAUM_PNL_UPLOAD_BYTES/,
  'large files must be blocked before multipart upload');
assert.match(pnlSource, /fetchRaumPnlJson\('\/api\/raum\/pnl-import', \{ method: 'POST', body: fd \}, \{ operation: 'preview' \}\)/,
  'preview must use the scoped response reader');
assert.match(pnlSource, /operation: 'save'/,
  'save must use the scoped response reader without a retry loop');
assert.match(pnlSource, /retryUploadFile/, 'failed preview must retain a file for an explicit retry');
assert.match(pnlSource, /setRetryUploadFile\(null\);[\s\S]{0,100}fileRef\.current\.value = ''/,
  'partner/year changes must discard a retained upload file');
const onUploadSource = pnlSource.slice(pnlSource.indexOf('const onUpload'), pnlSource.indexOf('const saveBulkPreview'));
assert.match(onUploadSource, /let saveAttempted = false;/,
  'the upload flow must track whether auto-save has begun');
assert.match(onUploadSource, /saveAttempted = true;/,
  'the upload flow must mark the auto-save attempt before its POST');
assert.match(onUploadSource, /if \(!saveAttempted\) setRetryUploadFile\(file\)/,
  'a failed request after any save attempt must not offer a preview retry that auto-saves');

await rejects(
  new Response('<html><body>nginx private diagnostic</body></html>', { status: 413 }),
  { operation: 'preview' },
  /서버에서 거절.*413/,
);

await rejects(
  new Response('<html>login gateway</html>', { status: 401 }),
  { operation: 'preview' },
  /로그인.*401/,
);

await rejects(
  new Response('<html>forbidden gateway</html>', { status: 403 }),
  { operation: 'preview' },
  /로그인.*403/,
);

await rejects(
  new Response('<html>bad gateway diagnostic</html>', { status: 502 }),
  { operation: 'preview' },
  /미리보기.*다시/,
);

await rejects(
  new Response('<html>upstream temporary detail</html>', { status: 503 }),
  { operation: 'preview' },
  /미리보기.*다시/,
);

await rejects(
  new Response('<html>upstream temporary detail</html>', { status: 504 }),
  { operation: 'save' },
  /자동으로 다시 저장하지 않았습니다/,
);

try {
  await readRaumPnlJsonResponse(new Response('<html>secret proxy diagnostic</html>', { status: 200 }), { operation: 'preview' });
  assert.fail('HTML 200 must not be accepted as JSON');
} catch (error) {
  assert.match(error.message, /응답 형식/);
  assert.doesNotMatch(error.message, /secret proxy diagnostic/);
}

try {
  await readRaumPnlJsonResponse(new Response('<html>secret proxy diagnostic</html>', { status: 200 }), { operation: 'save' });
  assert.fail('HTML 200 save response must be treated as unknown');
} catch (error) {
  assert.match(error.message, /저장 완료 여부가 확정되지 않았습니다/);
  assert.doesNotMatch(error.message, /JSON|secret proxy diagnostic/);
}

let reads = 0;
const onceOnlyResponse = {
  ok: true,
  status: 200,
  async text() {
    reads += 1;
    return '{"success":true,"batches":[]}';
  },
};
assert.deepEqual(await readRaumPnlJsonResponse(onceOnlyResponse), { success: true, batches: [] });
assert.equal(reads, 1, 'response body must be read exactly once');

assert.deepEqual(
  await readRaumPnlJsonResponse(new Response(JSON.stringify({ success: true, previewToken: 'token' }), { status: 200 })),
  { success: true, previewToken: 'token' },
);

await rejects(
  new Response('{}', { status: 200 }),
  { operation: 'preview' },
  /미리보기 결과를 확인할 수 없습니다/,
);

await rejects(
  new Response('{}', { status: 200 }),
  { operation: 'save' },
  /저장 완료 여부가 확정되지 않았습니다/,
);

await rejects(
  new Response(JSON.stringify({ success: false, error: '엑셀 파일 형식을 확인하세요.' }), { status: 422 }),
  { operation: 'preview' },
  /엑셀 파일 형식/,
);

await rejects(
  new Response(JSON.stringify({ success: false, error: '파일 크기를 줄여 주세요.' }), { status: 413 }),
  { operation: 'save' },
  /저장 완료되지 않았습니다.*파일 크기/,
);

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new TypeError('browser network detail'); };
try {
  await assert.rejects(
    () => fetchRaumPnlJson('/api/raum/pnl-import', { method: 'POST' }, { operation: 'save' }),
    error => /자동으로 다시 저장하지 않았습니다/.test(error.message) && !/browser network detail/.test(error.message),
  );
} finally {
  globalThis.fetch = originalFetch;
}

console.log('Raum P&L HTTP response tests passed');
