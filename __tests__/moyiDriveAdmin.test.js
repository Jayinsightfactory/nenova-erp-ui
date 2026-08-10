const assert = require('node:assert/strict');
const fs = require('node:fs');

const helper = fs.readFileSync('lib/moyiDriveAdmin.js', 'utf8');
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
assert.match(api, /connectionReady:\s*false/, '가짜 연결 완료 상태를 만들면 안 됩니다.');
assert.match(layout, /userIds:\s*\['nenovaSS3'\]/, '메뉴는 지정 계정에만 보여야 합니다.');
assert.match(layout, /fetch\('\/api\/auth\/me'\)/, 'PC 메뉴는 서버의 실제 로그인 정보를 다시 확인해야 합니다.');
assert.match(mobileHome, /import\s*\{\s*MENU_ITEMS\s*\}[^\n]+components\/Layout/, '모바일 메뉴는 PC와 같은 메뉴 원본을 사용해야 합니다.');
assert.match(mobileHome, /userIds\.includes\(me\.userId\)/, '모바일 메뉴도 서버에서 받은 실제 UserID로 표시를 제한해야 합니다.');
assert.match(page, /연결 대기/, '화면에 연결 대기 이유를 알려야 합니다.');
assert.match(page, /다운로드 기록/, '다운로드 성공·차단 화면이 있어야 합니다.');
assert.match(page, /전산 변경 별도 승인/, 'ERP 변경을 일반 자동 업무 승인과 분리해야 합니다.');

(async () => {
  const { isMoyiDriveAdmin } = await import('../lib/moyiDriveAdmin.js');
  assert.equal(isMoyiDriveAdmin('nenovaSS3'), true, '지정 관리자는 접근할 수 있어야 합니다.');
  assert.equal(isMoyiDriveAdmin('nenovass3'), false, '대소문자가 다른 계정을 허용하면 안 됩니다.');
  assert.equal(isMoyiDriveAdmin('관리자'), false, '표시 이름으로 접근할 수 없어야 합니다.');
  assert.equal(isMoyiDriveAdmin('nenovaSS3 '), false, '비슷한 계정이나 공백 변형을 허용하면 안 됩니다.');
  assert.equal(isMoyiDriveAdmin(undefined), false, '로그인 식별값이 없으면 차단해야 합니다.');
  console.log('MOYI Drive admin access and UI contract tests passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
