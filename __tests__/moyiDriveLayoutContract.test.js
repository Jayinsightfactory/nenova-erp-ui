// pages/integrations/moyi-drive.js + components/moyiDrive/* 의 반응형/접근성 계약을
// 실제 렌더링 없이 소스 텍스트로 검사한다(이 저장소 다른 UI 계약 테스트와 동일한 방식).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const page = fs.readFileSync('pages/integrations/moyi-drive.js', 'utf8');
const viewModel = fs.readFileSync('lib/moyiDriveViewModel.js', 'utf8');
const componentDir = 'components/moyiDrive';
const componentFiles = fs.readdirSync(componentDir).filter((f) => f.endsWith('.js'));
const components = Object.fromEntries(componentFiles.map((f) => [f, fs.readFileSync(path.join(componentDir, f), 'utf8')]));
const allSource = [page, viewModel, ...Object.values(components)].join('\n');

// ── 필수 재사용 구성요소 존재 ────────────────────────────────
for (const name of ['Button.js', 'Input.js', 'StatusBadge.js', 'StatusPanel.js', 'Tabs.js', 'FileRow.js', 'PermissionRow.js']) {
  assert.ok(componentFiles.includes(name), `${name} 컴포넌트가 있어야 합니다.`);
}
assert.ok(componentFiles.includes('Toolbar.js'), 'Toolbar.js(회사/검색/업로드/분류 도구 묶음) 컴포넌트가 있어야 합니다.');
assert.match(page, /import Button from '\.\.\/\.\.\/components\/moyiDrive\/Button'/);
assert.match(page, /import StatusPanel from '\.\.\/\.\.\/components\/moyiDrive\/StatusPanel'/);
assert.match(page, /import Toolbar from '\.\.\/\.\.\/components\/moyiDrive\/Toolbar'/);

// ── 잘림 방지: 헤더 요소(회사/검색/업로드/분류/탭/본문)가 모두 존재 ──
// (회사/검색/업로드/분류는 Toolbar.js로, 나머지는 page.js에 남아 있을 수 있어 전체 소스에서 확인한다)
assert.match(allSource, /moyi-company-value/, '회사 표시 영역이 있어야 합니다.');
assert.match(allSource, /파일 이름 검색/, '검색창이 있어야 합니다.');
assert.match(allSource, />파일 올리기</, '업로드 버튼이 있어야 합니다.');
assert.match(allSource, />분류 확인</, '분류 도구 버튼이 있어야 합니다.');
assert.match(page, /<Tabs /, '탭 영역이 있어야 합니다.');
assert.match(page, /<Toolbar\b/, '회사/검색/업로드/분류 도구 묶음이 있어야 합니다.');
assert.match(page, /role="tabpanel"/, '본문에 tabpanel 역할이 있어야 합니다.');

// ── PC 1440 / 태블릿·모바일 768·390·360 반응형 계약 ─────────────
assert.match(viewModel, /desktop:\s*1440/);
assert.match(viewModel, /tablet:\s*768/);
assert.match(viewModel, /phone:\s*390/);
assert.match(viewModel, /phoneSmall:\s*360/);
assert.match(page, /@media \(max-width: 768px\)/, '탭·본문은 768px 이하에서 모바일 레이아웃으로 바뀌어야 합니다.');
assert.match(components['Tabs.js'], /@media \(max-width: 768px\)/, '탭은 자체적으로 모바일 대응을 해야 합니다.');
assert.match(components['Toolbar.js'], /@media \(max-width: 768px\)/, '툴바(회사/검색/업로드/분류)도 자체적으로 모바일 대응을 해야 합니다.');
assert.doesNotMatch(allSource, /minWidth:\s*240/, '검색창을 고정 폭으로 다시 굳히면 안 됩니다(좁은 화면 잘림).');
assert.match(components['Toolbar.js'], /moyi-search-input\s*\{\s*min-width:\s*0\s*!important/, '모바일에서는 검색창 최소폭 제한을 풀어야 합니다.');

// ── 탭 오버플로우: 가로 스크롤 또는 접근 가능한 대안 ─────────────
assert.match(components['Tabs.js'], /overflow-x:\s*auto/, '탭은 모바일에서 가로 스크롤을 지원해야 합니다.');
assert.match(components['Tabs.js'], /옆으로 밀어 더 보기/, '스크롤 가능하다는 안내가 있어야 합니다.');

// ── 터치 대상 40~44px ───────────────────────────────────────
assert.match(viewModel, /min:\s*40/);
assert.match(viewModel, /preferred:\s*44/);
assert.match(components['Tabs.js'], /min-height:\s*44px/, '탭 터치 대상은 44px 이상이어야 합니다.');
assert.match(page, /min-height:\s*44px/, '모바일 버튼/입력 터치 대상은 44px 이상이어야 합니다.');

// ── 키보드 focus-visible ───────────────────────────────────
assert.match(components['Button.js'], /:focus-visible/, '버튼은 focus-visible 스타일이 있어야 합니다.');
assert.match(components['Tabs.js'], /:focus-visible/, '탭은 focus-visible 스타일이 있어야 합니다.');
assert.match(components['FileRow.js'], /:focus-visible/, '파일 행은 focus-visible 스타일이 있어야 합니다.');

// ── 접근성: aria-live/status/alert, aria-selected/tablist, disabled 이유 ─────
assert.match(components['StatusPanel.js'], /aria-live/);
assert.match(components['StatusPanel.js'], /role=\{role \|\| 'status'\}/);
assert.match(components['StatusPanel.js'], /aria-live=\{isAlert \? 'assertive' : 'polite'\}/);
assert.match(components['Tabs.js'], /role="tablist"/);
assert.match(components['Tabs.js'], /aria-selected=\{activeKey === tab\.key\}/);
assert.match(components['Button.js'], /aria-describedby/, '비활성 버튼은 이유를 스크린리더에도 알려야 합니다.');
// 미구현 버튼(Button 컴포넌트)은 각 사용처에서 disabled와 reason을 같은 태그에 함께 지정해야 한다.
// (한 줄짜리 <Button ...>라벨</Button> 태그 안에서만 검사 — 파일 전체를 가로지르는 오탐을 피한다)
const BUTTON_TAG_RE = /<Button\b[^>]*>[^<]*<\/Button>/g;
for (const [file, src] of Object.entries({ 'Toolbar.js': components['Toolbar.js'], 'moyi-drive.js': page })) {
  const tags = src.match(BUTTON_TAG_RE) || [];
  const disabledTags = tags.filter((tag) => /\bdisabled\b/.test(tag));
  assert.ok(disabledTags.length > 0, `${file}에 비활성 Button이 있어야 합니다.`);
  for (const tag of disabledTags) {
    assert.match(tag, /\breason=\{/, `${file}의 비활성 버튼에는 reason이 있어야 합니다: ${tag}`);
  }
}

// ── 색상만으로 상태를 전달하지 않음: 배지/패널은 항상 글자와 함께 ───
assert.match(components['StatusBadge.js'], /\{children\}/, '배지는 항상 글자를 함께 표시해야 합니다.');

// ── 실제 DTO가 있을 때만 렌더: 없는 열은 값을 지어내지 않고 연결대기 표시 ──
assert.match(viewModel, /연결대기 · 폴더 구조 미구현/);
assert.match(viewModel, /연결대기 · 크기 API 없음/);
assert.match(viewModel, /연결대기 · 변경시각 API 없음/);
assert.match(viewModel, /연결대기 · 권한 API 없음/);
assert.match(page, /<th>폴더<\/th>/);
assert.match(page, /<th>크기<\/th>/);
assert.match(page, /<th>변경시각<\/th>/);
assert.match(page, /<th>권한<\/th>/);

// ── nenovaSS3 서버 제한·client workspace 입력 차단·ACL save 503 차단 등
//     기존 보안 계약을 담은 파일은 이번 UI 작업에서 손대지 않는다 ─────────
for (const untouchedFile of ['lib/moyiDriveGateway.js', 'lib/moyiDriveAdmin.js', 'pages/api/moyi/drive-admin.js']) {
  assert.ok(fs.existsSync(untouchedFile), `${untouchedFile}는 그대로 있어야 합니다.`);
}

// ── 비밀값 비노출: 화면 소스에 토큰·서명·쿠키 이름을 그대로 심지 않는다 ───
assert.doesNotMatch(allSource, /moyiNenovaToken=|Bearer [A-Za-z0-9._-]{10,}|sig=[A-Za-z0-9%]/);

console.log('MOYI Drive 레이아웃/접근성 계약 테스트 통과');
