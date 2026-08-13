import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import jwt from 'jsonwebtoken';

const results = [];
const record = (name, ok, detail = '') => results.push({ name, result: ok ? '통과' : '실패', detail });

let upstreamMode = 200;
const openapi = {
  paths: {
    '/drive/v2/folders/{folder_id}/items': { get: {} },
    '/integrations/nenovaweb/drive-items': { get: {} },
    '/files/{file_id}/raw-url': { get: {} },
    '/files/{file_id}/raw': { get: {} },
  },
};
const items = [
  { id: 'moyi-1', file_id: 'file-1', name: '모이업무.pdf', source_kind: 'moyi_upload', sync_state: 'verified', source_deleted: false },
  { id: 'nw-1', file_id: null, name: '네이버백업.xlsx', source_kind: 'naverworks_drive', sync_state: 'observed', source_deleted: false },
  { id: 'nw-2', file_id: null, name: '원본삭제.pdf', source_kind: 'naverworks_drive', sync_state: 'source_deleted', source_deleted: true },
];

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/drive/capabilities') return res.end(JSON.stringify({ contract_revision: '2026-08-12.1', flags: { drive_legacy_inline_url: false } }));
  if (req.url === '/openapi.json') return res.end(JSON.stringify(openapi));
  if (req.url === '/integrations/nenovaweb/drive-root') {
    assert.equal(req.headers.authorization, 'Bearer e2e-connection-secret');
    return res.end(JSON.stringify({ ready: true, root_folder_id: 'e2e-root' }));
  }
  if (req.url === '/integrations/nenovaweb/drive-items') {
    assert.equal(req.headers.authorization, 'Bearer e2e-connection-secret');
    if (upstreamMode !== 200) {
      res.statusCode = upstreamMode;
      return res.end(JSON.stringify({ detail: 'fixture rejection' }));
    }
    return res.end(JSON.stringify(items));
  }
  if (req.url === '/files/file-1/raw-url') return res.end(JSON.stringify({ url: '/files/file-1/raw?uid=u&exp=1&sig=fixture', expires_in: 300 }));
  res.statusCode = 404;
  return res.end(JSON.stringify({ detail: 'not found' }));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();

const jwtSecret = 'local-e2e-jwt-secret-not-production';
const portProbe = http.createServer();
await new Promise((resolve) => portProbe.listen(0, '127.0.0.1', resolve));
const nextPort = portProbe.address().port;
await new Promise((resolve) => portProbe.close(resolve));
const nextLogs = [];
const nextProcess = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-p', String(nextPort)], {
  cwd: new URL('..', import.meta.url),
  env: {
    ...process.env,
    JWT_SECRET: jwtSecret,
    MOYI_API_BASE: `http://127.0.0.1:${address.port}`,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
nextProcess.stdout.on('data', (chunk) => nextLogs.push(String(chunk)));
nextProcess.stderr.on('data', (chunk) => nextLogs.push(String(chunk)));
for (let attempt = 0; attempt < 60; attempt += 1) {
  try {
    const ready = await fetch(`http://127.0.0.1:${nextPort}/api/ping`);
    if (ready.ok) break;
  } catch (_) { /* starting */ }
  await new Promise((resolve) => setTimeout(resolve, 250));
  if (attempt === 59) throw new Error(`Next E2E 서버 시작 실패: ${nextLogs.join('').slice(-1000)}`);
}

function token(userId, extra = {}) {
  return jwt.sign({ userId, userName: '격리 검사', authority: 'fixture', accountActive: true, ...extra }, jwtSecret, { expiresIn: '5m' });
}

async function invoke({ userId = 'nenovaSS3', method = 'GET', body = {}, active = true } = {}) {
  const response = await fetch(`http://127.0.0.1:${nextPort}/api/moyi/drive-admin`, {
    method,
    headers: {
      Authorization: `Bearer ${token(userId, { accountActive: active })}`,
      Cookie: 'moyiNenovaToken=e2e-connection-secret',
      'Content-Type': 'application/json',
    },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });
  return { statusCode: response.status, body: await response.json(), headers: Object.fromEntries(response.headers) };
}

const captured = [];
const originalInfo = console.info;
console.info = (...args) => captured.push(args.join(' '));
try {
  const pcPage = await fetch(`http://127.0.0.1:${nextPort}/integrations/moyi-drive`);
  const mobilePage = await fetch(`http://127.0.0.1:${nextPort}/m`);
  assert.equal(pcPage.status, 200);
  assert.equal(mobilePage.status, 200);
  assert.match(await pcPage.text(), /MOYI Drive 관리/);
  assert.match(await mobilePage.text(), /"page":"\/m"/);
  record('PC·모바일 화면 경로', true, '모두 HTTP 200·정확한 Next 페이지 확인');

  upstreamMode = 200;
  const admin = await invoke();
  assert.equal(admin.statusCode, 200);
  assert.deepEqual(admin.body.files.map((file) => [file.source, file.state]), [
    ['MOYI 앱', '확인 완료'], ['네이버웍스 Drive', '백업 대기'], ['네이버웍스 Drive', '원본에서 삭제됨'],
  ]);
  assert.equal(admin.body.files.some((file) => 'url' in file), false, '고정 public URL을 반환하면 안 됩니다.');
  assert.equal(JSON.stringify(admin.body).match(/e2e-connection-secret|sig=/), null);
  record('관리자 실제 목록·DTO', true, 'MOYI/네이버웍스/staging 상태');

  const rawUrlFixture = await fetch(`http://127.0.0.1:${address.port}/files/file-1/raw-url`).then((response) => response.json());
  assert.equal(rawUrlFixture.expires_in, 300);
  assert.match(rawUrlFixture.url, /^\/files\/file-1\/raw\?/);
  assert.equal(/^https?:\/\//.test(rawUrlFixture.url), false, '고정 public URL이면 안 됩니다.');
  record('권한형 다운로드 주소', true, '상대경로·300초');

  assert.equal((await invoke({ userId: 'employee' })).statusCode, 403);
  assert.equal((await invoke({ userId: 'nenovass3' })).statusCode, 403);
  assert.equal((await invoke({ active: false })).statusCode, 403);
  record('일반·유사 ID·비활성 차단', true, '모두 403');

  const cross = await invoke({ method: 'PUT', body: { workspace_id: 'other', targetId: 'folder' } });
  assert.equal(cross.statusCode, 403);
  const writePending = await invoke({ method: 'PUT', body: { targetId: 'folder' } });
  assert.equal(writePending.statusCode, 503);
  record('회사 범위·권한 저장 차단', true, '교차 403, 저장 503');

  for (const code of [401, 403, 404, 500, 503]) {
    upstreamMode = code;
    const rejected = await invoke();
    assert.equal(rejected.body.connectionReady, false);
    assert.match(rejected.body.connectionReason, /MOYI|Drive|폴더|권한/);
    assert.equal(JSON.stringify(rejected.body).match(/e2e-connection-secret|sig=/), null);
  }
  record('backend 철회·오류 한글 안내', true, '401/403/404/500/503');
  assert.equal(captured.join('\n').match(/e2e-connection-secret|sig=/), null);
  record('token·서명 기록 비노출', true);
} catch (error) {
  record('HTTP E2E', false, String(error.message || error).slice(0, 300));
  throw error;
} finally {
  console.info = originalInfo;
  nextProcess.kill();
  await new Promise((resolve) => nextProcess.once('exit', resolve));
  await new Promise((resolve) => server.close(resolve));
  assert.equal(nextLogs.join('').match(/e2e-connection-secret|sig=fixture/), null, 'Next 로그에 token·서명이 남으면 안 됩니다.');
  console.table(results);
}

console.log(JSON.stringify({ suite: 'moyi-drive-http-e2e', passed: results.filter((row) => row.result === '통과').length, failed: results.filter((row) => row.result === '실패').length, results }));
