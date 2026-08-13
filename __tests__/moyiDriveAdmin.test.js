const assert = require('node:assert/strict');
const fs = require('node:fs');

const helper = fs.readFileSync('lib/moyiDriveAdmin.js', 'utf8');
const gateway = fs.readFileSync('lib/moyiDriveGateway.js', 'utf8');
const viewModel = fs.readFileSync('lib/moyiDriveViewModel.js', 'utf8');
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
assert.match(gateway, /drive\/capabilities/, '운영 계약 revision을 backend에서 확인해야 합니다.');
assert.match(gateway, /integrations\/nenovaweb\/drive-root/, '폴더 범위는 승인된 연결에서 서버가 정해야 합니다.');
assert.match(gateway, /drive\/v2\/folders\//, '확인된 backend Drive 원장 경로만 호출해야 합니다.');
assert.doesNotMatch(gateway, /access_token|nenovaToken/, '응답 모델에 인증 토큰을 포함하면 안 됩니다.');
assert.match(gateway, /writeAcl:\s*false/, 'ACL 쓰기 능력을 완화하면 안 됩니다.');
assert.match(api, /hasCrossWorkspaceInput/, '클라이언트가 다른 회사·작업공간을 지정하면 차단해야 합니다.');
assert.match(layout, /userIds:\s*\['nenovaSS3'\]/, '메뉴는 지정 계정에만 보여야 합니다.');
assert.match(layout, /fetch\('\/api\/auth\/me'\)/, 'PC 메뉴는 서버의 실제 로그인 정보를 다시 확인해야 합니다.');
assert.match(mobileHome, /import\s*\{\s*MENU_ITEMS\s*\}[^\n]+components\/Layout/, '모바일 메뉴는 PC와 같은 메뉴 원본을 사용해야 합니다.');
assert.match(mobileHome, /userIds\.includes\(me\.userId\)/, '모바일 메뉴도 서버에서 받은 실제 UserID로 표시를 제한해야 합니다.');
assert.match(page, /전산 변경 별도 승인/, 'ERP 변경을 일반 자동 업무 승인과 분리해야 합니다.');
assert.match(page, /MOYI 앱에서 올림/, 'MOYI 앱 업로드만 모아보는 빠른 보기가 있어야 합니다.');
assert.match(page, /네이버웍스에서 가져옴/, '네이버웍스에서 들어온 자료를 구분해서 볼 수 있어야 합니다.');
assert.match(page, /정리 필요/, '분류·백업 확인이 필요한 파일을 별도 보기로 제공해야 합니다.');
assert.match(page, /폴더는 팀·업무 중심으로 적게 만들고/, '폴더와 분류 정보의 역할을 직원에게 안내해야 합니다.');
// 화면 재구성(components/moyiDrive/*, lib/moyiDriveViewModel.js) 이후에는
// 탭 라벨·연결 대기 문구가 page.js가 아니라 view-model에 있다.
// 구성요소 조립/반응형/접근성 세부 계약은 __tests__/moyiDriveLayoutContract.test.js,
// view-model 순수 함수 동작은 __tests__/moyiDriveViewModel.test.js에서 각각 검사한다.
assert.match(viewModel, /연결 대기/, '화면에 연결 대기 이유를 알려야 합니다.');
assert.match(viewModel, /다운로드 기록/, '다운로드 성공·차단 화면이 있어야 합니다.');

(async () => {
  const { isMoyiDriveAdmin } = await import('../lib/moyiDriveAdmin.js');
  const { hasCrossWorkspaceInput, loadMoyiDrive, mapDriveItem, pendingDriveModel } = await import('../lib/moyiDriveGateway.js');
  const { classifyDriveResponse } = await import('../lib/moyiDriveViewModel.js');
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
  const previousFetch = global.fetch;
  try {
    let fetchCall = 0;
    global.fetch = async (url, options) => {
      fetchCall += 1;
      if (String(url).endsWith('/drive/capabilities')) return { ok: true, status: 200, json: async () => ({ contract_revision: '2026-08-12.1', flags: { drive_legacy_inline_url: false } }) };
      if (String(url).endsWith('/openapi.json')) return { ok: true, status: 200, json: async () => ({ paths: { '/drive/v2/folders/{folder_id}/items': { get: {} }, '/integrations/nenovaweb/drive-items': { get: {} }, '/files/{file_id}/raw-url': { get: {} }, '/files/{file_id}/raw': { get: {} } } }) };
      if (String(url).endsWith('/integrations/nenovaweb/drive-root')) return { ok: true, status: 200, json: async () => ({ ready: true, root_folder_id: 'folder-fixed-by-server' }) };
      assert.match(String(url), /integrations\/nenovaweb\/drive-items$/, '연결 토큰 전용 목록 경로를 사용해야 합니다.');
      assert.equal(options.headers.Authorization, 'Bearer connection-token');
      return { ok: true, status: 200, json: async () => [{ id: 'real-1', file_id: 'file-1', name: '실제.pdf', source_kind: 'moyi_upload', sync_state: 'verified', source_deleted: false }] };
    };
    const connected = await loadMoyiDrive({ headers: { cookie: 'moyiNenovaToken=connection-token' } });
    assert.equal(connected.status, 200);
    assert.equal(connected.body.files[0].name, '실제.pdf');
    assert.equal(JSON.stringify(connected.body).includes('connection-token'), false, '연결 token을 응답에 노출하면 안 됩니다.');
    assert.equal(classifyDriveResponse({ status: connected.status, body: connected.body }).kind, 'connected', '실제 연결 응답은 pending이 아니라 connected로 분류되어야 합니다.');
  } finally {
    global.fetch = previousFetch;
  }
  console.log('MOYI Drive admin access and UI contract tests passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
