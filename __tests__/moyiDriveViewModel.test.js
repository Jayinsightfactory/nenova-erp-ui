const assert = require('node:assert/strict');

(async () => {
  const vm = await import('../lib/moyiDriveViewModel.js');
  const {
    TAB_DEFS,
    BREAKPOINTS,
    TOUCH_TARGET,
    filterFiles,
    fileBadgeTone,
    mapFileRowView,
    mapPermissionRowView,
    classifyDriveResponse,
    nextStepFor,
    connectionStatusPanel,
    hardErrorStatusPanel,
    topStatusPanel,
    loadingStatusPanel,
    tabStatusPanel,
    emptyFileStatusPanel,
    fileTabStatus,
  } = vm;

  // ── 탭·반응형 상수 ──────────────────────────────────────────
  assert.deepEqual(TAB_DEFS.map((t) => t.label), ['파일', '버전', '권한', '다운로드 기록', '사용자 연결', '자동 업무']);
  assert.equal(new Set(TAB_DEFS.map((t) => t.key)).size, TAB_DEFS.length, '탭 key는 중복되면 안 됩니다.');
  assert.equal(BREAKPOINTS.desktop, 1440);
  assert.equal(BREAKPOINTS.tablet, 768);
  assert.equal(BREAKPOINTS.phone, 390);
  assert.equal(BREAKPOINTS.phoneSmall, 360);
  assert.ok(TOUCH_TARGET.min >= 40 && TOUCH_TARGET.min <= TOUCH_TARGET.preferred, '터치 대상은 40~44px 범위여야 합니다.');
  assert.equal(TOUCH_TARGET.preferred, 44);

  // ── 파일 목록 ──────────────────────────────────────────────
  const files = [
    { id: '1', name: '업무보고.pdf', source: 'MOYI 앱', state: '확인 완료', sourceDeleted: false, contentReady: true },
    { id: '2', name: '백업.xlsx', source: '네이버웍스 Drive', state: '백업 대기', sourceDeleted: false, contentReady: false },
    { id: '3', name: '원본삭제.pdf', source: '네이버웍스 Drive', state: '원본에서 삭제됨', sourceDeleted: true, contentReady: false },
  ];
  assert.equal(filterFiles(files, '').length, 3, '빈 검색어는 전체를 반환해야 합니다.');
  assert.deepEqual(filterFiles(files, '업무').map((f) => f.id), ['1']);
  assert.deepEqual(filterFiles(files, 'PDF').map((f) => f.id), ['1', '3'], '대소문자를 구분하지 않아야 합니다.');
  assert.equal(fileBadgeTone(files[0]), 'green');
  assert.equal(fileBadgeTone(files[1]), 'amber');
  assert.equal(fileBadgeTone(files[2]), 'red');

  const row = mapFileRowView(files[0]);
  assert.equal(row.name.value, '업무보고.pdf');
  assert.equal(row.name.pending, false);
  assert.equal(row.source.value, 'MOYI 앱');
  assert.equal(row.status.tone, 'green');
  for (const key of ['folder', 'size', 'modifiedAt', 'permission']) {
    assert.equal(row[key].pending, true, `${key} 열은 backend DTO가 없어 pending이어야 합니다.`);
    assert.match(row[key].value, /연결대기/, `${key} 열은 실제 값을 지어내면 안 됩니다.`);
    assert.doesNotMatch(row[key].value, /^\d+(\.\d+)?\s*(KB|MB|GB)?$/, `${key} 열에 지어낸 숫자를 넣으면 안 됩니다.`);
  }

  // ── 권한 행(계약 준비용) ───────────────────────────────────
  const permRow = mapPermissionRowView({ subjectLabel: '홍길동', subjectType: '직원', scopeLabel: '영업부', actions: { view: 'allowed', download: 'denied' } });
  assert.equal(permRow.actions.find((a) => a.key === 'view').label, '직접 허용');
  assert.equal(permRow.actions.find((a) => a.key === 'download').label, '차단');
  assert.equal(permRow.actions.find((a) => a.key === 'share').label, '확인 필요', '지정 안 된 동작은 확인 필요로 표시해야 합니다.');
  assert.equal(mapPermissionRowView({}).subject, '알 수 없음');

  // ── 응답 분류 ──────────────────────────────────────────────
  assert.equal(classifyDriveResponse({ networkError: true }).kind, 'networkError');
  assert.equal(classifyDriveResponse({ status: 200, body: { connectionReady: true } }).kind, 'connected');
  assert.equal(classifyDriveResponse({ status: 503, body: { connectionReady: false } }).kind, 'pending');
  assert.equal(classifyDriveResponse({ status: 401, body: { connectionReady: false } }).kind, 'pending', 'connectionReason이 있으면 401도 연결대기로 다뤄야 합니다.');
  assert.equal(classifyDriveResponse({ status: 401, body: { success: false, error: '로그인이 필요합니다.' } }).kind, 'authRequired');
  assert.equal(classifyDriveResponse({ status: 403, body: { success: false, error: '관리자만' } }).kind, 'adminForbidden');
  assert.equal(classifyDriveResponse({ status: 404, body: { success: false } }).kind, 'unknown');
  assert.equal(classifyDriveResponse({ status: 500, body: { success: false } }).kind, 'serverError');
  assert.equal(classifyDriveResponse({ status: 503, body: { success: false } }).kind, 'serverError');

  // ── 하드 에러/로딩 패널 ────────────────────────────────────
  for (const kind of ['authRequired', 'adminForbidden', 'serverError', 'networkError']) {
    const panel = hardErrorStatusPanel({ kind, body: {} });
    assert.equal(panel.tone, 'red');
    assert.equal(panel.role, 'alert', `${kind}은 role=alert이어야 합니다.`);
    assert.equal(panel.lines.length, 2);
  }
  assert.equal(hardErrorStatusPanel({ kind: 'connected' }), null, '정상 상태는 하드 에러 패널이 없어야 합니다.');
  assert.equal(loadingStatusPanel().role, 'status');

  // ── 연결 대기 3줄(원인/가능한 것/다음 확인) ──────────────────
  const pendingBody = { connectionReady: false, code: 'MOYI_CONNECTION_TOKEN_MISSING', connectionReason: 'MOYI 계정 연결 토큰이 없습니다.' };
  const panel = connectionStatusPanel(pendingBody);
  assert.equal(panel.role, 'status');
  assert.deepEqual(panel.lines.map((l) => l.label), ['원인', '지금 가능한 것', '관리자가 할 다음 확인']);
  assert.equal(panel.lines[0].text, pendingBody.connectionReason);
  assert.match(panel.lines[2].text, /MOYI 보고 연동/);

  assert.match(nextStepFor('MOYI_DRIVE_UPSTREAM_REJECTED', '연결된 MOYI 회사에서 지정 Drive 폴더를 찾을 수 없거나 접근할 수 없습니다.'), /루트 폴더/);
  assert.match(nextStepFor('MOYI_DRIVE_UPSTREAM_REJECTED', 'MOYI 연결이 만료됐거나 지정 폴더를 볼 권한이 없습니다.'), /권한/);
  assert.match(nextStepFor('MOYI_DRIVE_CONNECTION_PENDING', 'MOYI Drive 원장 PR이 아직 운영에 반영됐다는 설정이 없습니다.'), /배포 담당자/);
  assert.match(nextStepFor('MOYI_DRIVE_CONNECTION_PENDING', 'Nenova 연결에 고정할 MOYI 루트 폴더가 설정되지 않았습니다.'), /루트 폴더/);
  assert.match(nextStepFor('알수없는코드', '아무 이유'), /관리자/);

  const connectedPanel = topStatusPanel({ kind: 'connected', body: { connectionReason: '연결된 MOYI 회사의 실제 Drive 원장을 조회했습니다.' } });
  assert.equal(connectedPanel.tone, 'green');
  const pendingTop = topStatusPanel({ kind: 'pending', body: pendingBody });
  assert.equal(pendingTop.tone, 'amber');

  // ── 탭별 상태 패널: 실제 pending 사유만 노출, 값을 지어내지 않음 ──
  const connectedBody = {
    connectionReady: true,
    files: [],
    pending: {
      versions: 'backend에 파일 버전 조회 API가 아직 없습니다.',
      permissions: 'backend에 ACL 조회 API가 아직 없습니다.',
      downloads: 'backend에 관리자용 다운로드 감사 조회 API가 아직 없습니다.',
      identities: 'Nenova UserInfo.UserID 연결표와 승인 API가 아직 없습니다.',
      automations: 'Drive 동기화 작업 조회·제어 API가 아직 없습니다.',
      naverworks: 'backend에 동기화 작업·checkpoint 조회 API와 실제 connector 인증 계약이 아직 없습니다.',
    },
  };
  for (const key of ['versions', 'permissions', 'downloads', 'identities']) {
    const tabPanel = tabStatusPanel(key, connectedBody);
    assert.equal(tabPanel.lines[0].text, connectedBody.pending[key], `${key} 탭은 실제 pending 사유를 그대로 써야 합니다.`);
  }
  const automationsPanel = tabStatusPanel('automations', connectedBody);
  assert.ok(automationsPanel.lines.some((l) => l.label === '네이버웍스 연결'), '자동 업무 탭은 네이버웍스 연결 사유도 보여줘야 합니다.');
  assert.equal(tabStatusPanel('files', connectedBody), null, '파일 탭은 tabStatusPanel 대상이 아닙니다.');

  // ── 파일 탭 empty/검색결과없음/연결대기 분기 ─────────────────
  assert.equal(fileTabStatus({ kind: 'pending', body: pendingBody }, '').title, '연결 대기');
  assert.deepEqual(emptyFileStatusPanel('사유').lines, [{ label: '원인', text: '사유' }]);
  const connectedWithFiles = { kind: 'connected', body: { connectionReady: true, files } };
  assert.equal(fileTabStatus(connectedWithFiles, ''), null, '파일이 있으면 상태 패널 없이 목록을 그려야 합니다.');
  assert.match(fileTabStatus(connectedWithFiles, '존재하지않는파일').title, /표시할 파일 없음/);
  assert.match(fileTabStatus(connectedWithFiles, '존재하지않는파일').lines[0].text, /검색과 일치하는 파일이 없습니다/);
  assert.match(fileTabStatus({ kind: 'connected', body: { connectionReady: true, files: [] } }, '').title, /표시할 파일 없음/);

  console.log('MOYI Drive view-model 상태/레이아웃 계약 테스트 통과');
})().catch((error) => { console.error(error); process.exitCode = 1; });
