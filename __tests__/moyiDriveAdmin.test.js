const assert = require('node:assert/strict');
const fs = require('node:fs');

const helper = fs.readFileSync('lib/moyiDriveAdmin.js', 'utf8');
const gateway = fs.readFileSync('lib/moyiDriveGateway.js', 'utf8');
const api = fs.readFileSync('pages/api/moyi/drive-admin.js', 'utf8');
const page = fs.readFileSync('pages/integrations/moyi-drive.js', 'utf8');
const layout = fs.readFileSync('components/Layout.js', 'utf8');
const mobileHome = fs.readFileSync('pages/m/index.js', 'utf8');

assert.match(helper, /MOYI_DRIVE_ADMIN_USER_IDS[^\n]+nenovaSS3/, '허용 계정은 실제 UserID nenovaSS3로 고정해야 합니다.');
assert.match(helper, /includes\(String\(userId/, '표시 이름이 아니라 정확한 로그인 ID를 검사해야 합니다.');
assert.match(api, /withAuth\(handler\)/, 'API는 로그인이 필요해야 합니다.');
assert.match(api, /requireMoyiDriveAdmin/, 'API도 관리자 계정을 다시 검사해야 합니다.');
assert.match(api, /status\(503\)/, 'MOYI 저장 계약 확인 전 변경을 차단해야 합니다.');
assert.match(api, /writePermissionAudit/, '허용되지 않거나 대기 중인 변경 시도를 기록해야 합니다.');
assert.doesNotMatch(api, /sample-1|설계 미리보기|직원 예시/, '가짜 파일·권한 자료를 반환하면 안 됩니다.');
assert.match(api, /loadMoyiDrive/, '실제 MOYI Drive 읽기 gateway를 사용해야 합니다.');
assert.match(gateway, /MOYI_DRIVE_LEDGER_READY/, '운영 반영이 확인되기 전에는 연결을 차단해야 합니다.');
assert.match(gateway, /MOYI_DRIVE_ROOT_FOLDER_ID/, '폴더 범위는 서버 설정으로 고정해야 합니다.');
assert.match(gateway, /drive\/v2\/folders\//, '확인된 backend Drive 원장 경로만 호출해야 합니다.');
assert.doesNotMatch(gateway, /access_token|nenovaToken/, '응답 모델에 인증 토큰을 포함하면 안 됩니다.');
assert.match(api, /hasCrossWorkspaceInput/, '클라이언트가 다른 회사·작업공간을 지정하면 차단해야 합니다.');
assert.match(layout, /userIds:\s*\['nenovaSS3'\]/, '메뉴는 지정 계정에만 보여야 합니다.');
assert.match(layout, /fetch\('\/api\/auth\/me'\)/, 'PC 메뉴는 서버의 실제 로그인 정보를 다시 확인해야 합니다.');
assert.match(mobileHome, /MOYI Drive 관리[^\n]+userIds:\s*\['nenovaSS3'\]/, '모바일 메뉴에도 지정 관리자용 Drive 진입점이 있어야 합니다.');
assert.match(mobileHome, /userIds\.includes\(me\.userId\)/, '모바일 메뉴도 서버에서 받은 실제 UserID로 표시를 제한해야 합니다.');
assert.match(page, /연결 대기/, '화면에 연결 대기 이유를 알려야 합니다.');
assert.match(page, /다운로드 기록/, '다운로드 성공·차단 화면이 있어야 합니다.');
assert.match(page, /전산 변경 별도 승인/, 'ERP 변경을 일반 자동 업무 승인과 분리해야 합니다.');

(async () => {
  const { isMoyiDriveAdmin } = await import('../lib/moyiDriveAdmin.js');
  const { hasCrossWorkspaceInput, loadMoyiDrive, mapDriveItem, pendingDriveModel } = await import('../lib/moyiDriveGateway.js');
  assert.equal(isMoyiDriveAdmin('nenovaSS3'), true, '지정 관리자는 접근할 수 있어야 합니다.');
  assert.equal(isMoyiDriveAdmin('nenovass3'), false, '대소문자가 다른 계정을 허용하면 안 됩니다.');
  assert.equal(isMoyiDriveAdmin('관리자'), false, '표시 이름으로 접근할 수 없어야 합니다.');
  assert.equal(isMoyiDriveAdmin('nenovaSS3 '), false, '비슷한 계정이나 공백 변형을 허용하면 안 됩니다.');
  assert.equal(isMoyiDriveAdmin(undefined), false, '로그인 식별값이 없으면 차단해야 합니다.');
  assert.equal(hasCrossWorkspaceInput({ workspace_id: 'other' }), true, '다른 작업공간 입력을 거부해야 합니다.');
  assert.equal(hasCrossWorkspaceInput({ targetId: 'folder-1' }), false, '허용된 대상 식별값은 작업공간 입력이 아닙니다.');
  assert.deepEqual(mapDriveItem({ id: 'i1', file_id: 'f1', name: '업무.pdf', source_kind: 'moyi_upload', sync_state: 'verified' }), {
    id: 'i1', fileId: 'f1', name: '업무.pdf', source: 'MOYI 앱', state: '확인 완료', sourceDeleted: false, contentReady: true,
  });
  assert.deepEqual(mapDriveItem({ id: 'i2', file_id: null, name: '백업.xlsx', source_kind: 'naverworks_drive', sync_state: 'observed' }), {
    id: 'i2', fileId: null, name: '백업.xlsx', source: '네이버웍스 Drive', state: '백업 대기', sourceDeleted: false, contentReady: false,
  });
  const pending = pendingDriveModel('아직 준비되지 않았습니다.');
  assert.equal(pending.connectionReady, false);
  assert.deepEqual(pending.files, [], '연결 대기 중 sample 파일을 반환하면 안 됩니다.');
  assert.match(pending.pending.naverworks, /connector/, '실제 connector 미구현 사유를 표시해야 합니다.');
  const previousReady = process.env.MOYI_DRIVE_LEDGER_READY;
  const previousFolder = process.env.MOYI_DRIVE_ROOT_FOLDER_ID;
  const previousRevision = process.env.MOYI_DRIVE_CONTRACT_REVISION;
  const previousFetch = global.fetch;
  try {
    delete process.env.MOYI_DRIVE_LEDGER_READY;
    const notDeployed = await loadMoyiDrive({ headers: {} });
    assert.equal(notDeployed.status, 503, 'backend 운영 반영 전에는 503 연결 대기여야 합니다.');
    process.env.MOYI_DRIVE_LEDGER_READY = 'true';
    process.env.MOYI_DRIVE_ROOT_FOLDER_ID = 'folder-fixed-by-server';
    process.env.MOYI_DRIVE_CONTRACT_REVISION = 'talkhub-drive-v2@bf8ee45';
    let fetchCall = 0;
    global.fetch = async (url, options) => {
      fetchCall += 1;
      if (fetchCall === 1) return { ok: true, status: 200, json: async () => ({ paths: { '/drive/v2/folders/{folder_id}/items': { get: {} }, '/files/{file_id}/raw-url': { get: {} }, '/files/{file_id}/raw': { get: {} } } }) };
      assert.match(String(url), /folder-fixed-by-server\/items$/, '클라이언트 입력이 아닌 서버 폴더 설정을 사용해야 합니다.');
      assert.equal(options.headers.Authorization, 'Bearer connection-token');
      return { ok: true, status: 200, json: async () => [{ id: 'real-1', file_id: 'file-1', name: '실제.pdf', source_kind: 'moyi_upload', sync_state: 'verified', source_deleted: false }] };
    };
    const connected = await loadMoyiDrive({ headers: { cookie: 'moyiNenovaToken=connection-token' } });
    assert.equal(connected.status, 200);
    assert.equal(connected.body.files[0].name, '실제.pdf');
    assert.equal(JSON.stringify(connected.body).includes('connection-token'), false, '연결 token을 응답에 노출하면 안 됩니다.');
  } finally {
    if (previousReady === undefined) delete process.env.MOYI_DRIVE_LEDGER_READY; else process.env.MOYI_DRIVE_LEDGER_READY = previousReady;
    if (previousFolder === undefined) delete process.env.MOYI_DRIVE_ROOT_FOLDER_ID; else process.env.MOYI_DRIVE_ROOT_FOLDER_ID = previousFolder;
    if (previousRevision === undefined) delete process.env.MOYI_DRIVE_CONTRACT_REVISION; else process.env.MOYI_DRIVE_CONTRACT_REVISION = previousRevision;
    global.fetch = previousFetch;
  }
  console.log('MOYI Drive admin access and UI contract tests passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
