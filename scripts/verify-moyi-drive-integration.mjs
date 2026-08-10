import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  MOYI_DRIVE_CONTRACT_REVISION,
  hasCrossWorkspaceInput,
  inspectDriveOpenApi,
  loadMoyiDrive,
  mapDriveItem,
  moyiUpstreamFailure,
  pendingDriveModel,
} from '../lib/moyiDriveGateway.js';
import { isMoyiDriveAdmin } from '../lib/moyiDriveAdmin.js';

const modeArg = process.argv.find((value) => value.startsWith('--mode='));
const mode = modeArg?.split('=')[1] || 'mock';
const fixture = JSON.parse(fs.readFileSync(new URL('../__tests__/fixtures/moyi-drive-openapi.json', import.meta.url), 'utf8'));

function checkStaticContracts() {
  const capabilities = inspectDriveOpenApi(fixture);
  assert.equal(MOYI_DRIVE_CONTRACT_REVISION, 'talkhub-drive-v2@bf8ee45');
  assert.equal(fixture['x-moyi-contract'].revision, MOYI_DRIVE_CONTRACT_REVISION);
  assert.equal(fixture['x-moyi-contract'].rawUrlTtlSeconds, 300, 'raw-url TTL은 5분이어야 합니다.');
  assert.equal(fixture['x-moyi-contract'].stagingVisibility, 'admin-only-not-found');
  assert.equal(fixture['x-moyi-contract'].acl.expiredIgnored, true);
  assert.equal(fixture['x-moyi-contract'].acl.explicitDenyWins, true);
  assert.deepEqual(capabilities, { listItems: true, writeAcl: true, recordManifest: true, rawUrl: true, guardedRaw: true });
  assert.equal(isMoyiDriveAdmin('nenovaSS3'), true);
  assert.equal(isMoyiDriveAdmin('employee'), false);
  assert.equal(hasCrossWorkspaceInput({ workspace_id: 'other' }), true);
  assert.deepEqual(mapDriveItem({ id: 'item', file_id: null, name: '대기.pdf', source_kind: 'naverworks_drive', sync_state: 'observed' }), {
    id: 'item', fileId: null, name: '대기.pdf', source: '네이버웍스 Drive', state: '백업 대기', sourceDeleted: false, contentReady: false,
  });
  const pending = pendingDriveModel('연결 대기');
  assert.equal(pending.files.length, 0);
  assert.equal(JSON.stringify(pending).match(/sig=|Bearer |moyiNenovaToken/g), null);
  for (const status of [401, 403, 404, 500, 503]) {
    const failure = moyiUpstreamFailure(status);
    assert.equal(failure.body.connectionReady, false);
    assert.match(failure.body.connectionReason, /MOYI|Drive|폴더|권한/);
    if (status >= 500) assert.equal(failure.status, 503);
  }
}

async function checkMock() {
  const saved = {
    ready: process.env.MOYI_DRIVE_LEDGER_READY,
    folder: process.env.MOYI_DRIVE_ROOT_FOLDER_ID,
    revision: process.env.MOYI_DRIVE_CONTRACT_REVISION,
    fetch: global.fetch,
  };
  try {
    delete process.env.MOYI_DRIVE_LEDGER_READY;
    assert.equal((await loadMoyiDrive({ headers: {} })).status, 503);
    process.env.MOYI_DRIVE_LEDGER_READY = 'true';
    process.env.MOYI_DRIVE_ROOT_FOLDER_ID = 'fixture-root';
    process.env.MOYI_DRIVE_CONTRACT_REVISION = MOYI_DRIVE_CONTRACT_REVISION;
    let call = 0;
    global.fetch = async (url, options) => {
      call += 1;
      if (call === 1) return { ok: true, status: 200, json: async () => fixture };
      assert.match(String(url), /\/drive\/v2\/folders\/fixture-root\/items$/);
      assert.equal(options.headers.Authorization, 'Bearer mock-secret');
      return { ok: true, status: 200, json: async () => [{ id: 'f1', file_id: 'raw1', name: '업무.pdf', source_kind: 'moyi_upload', sync_state: 'verified' }] };
    };
    const result = await loadMoyiDrive({ headers: { cookie: 'moyiNenovaToken=mock-secret' } });
    assert.equal(result.status, 200);
    assert.equal(result.body.capabilities.download, true);
    assert.equal(JSON.stringify(result.body).includes('mock-secret'), false);
    assert.equal(JSON.stringify(result.body).includes('sig='), false);
  } finally {
    const restore = (key, value) => value === undefined ? delete process.env[key] : process.env[key] = value;
    restore('MOYI_DRIVE_LEDGER_READY', saved.ready);
    restore('MOYI_DRIVE_ROOT_FOLDER_ID', saved.folder);
    restore('MOYI_DRIVE_CONTRACT_REVISION', saved.revision);
    global.fetch = saved.fetch;
  }
}

async function checkReadonly() {
  const base = String(process.env.MOYI_API_BASE || 'https://api.nowlink.kr').replace(/\/$/, '');
  const response = await fetch(`${base}/openapi.json`, { headers: { Accept: 'application/json' } });
  assert.equal(response.ok, true, `OpenAPI 읽기 실패: HTTP ${response.status}`);
  const capabilities = inspectDriveOpenApi(await response.json());
  assert.equal(capabilities.listItems, true, 'Drive v2 목록 API가 배포되지 않았습니다.');
  assert.equal(capabilities.rawUrl && capabilities.guardedRaw, true, '권한형 raw-url/raw 계약이 배포되지 않았습니다.');
  console.log(`연결 token 설정 여부: ${Boolean(process.env.MOYI_DRIVE_CONNECTION_TOKEN) ? '있음' : '없음'} (값은 출력하지 않음)`);
}

checkStaticContracts();
if (mode === 'mock') await checkMock();
else if (mode === 'readonly') await checkReadonly();
else throw new Error('mode는 mock 또는 readonly만 허용됩니다.');
console.log(`MOYI Drive 자동 연동 검사 통과 (${mode}, ${MOYI_DRIVE_CONTRACT_REVISION})`);
