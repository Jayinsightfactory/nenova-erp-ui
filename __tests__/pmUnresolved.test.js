// __tests__/pmUnresolved.test.js — /pm "PM이 스스로 해결 못 한 일" 판정·쉬운 제목
// 실행: node __tests__/pmUnresolved.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmun-'));
const src = fs.readFileSync(path.join(process.cwd(), 'lib', 'pmUnresolved.js'), 'utf8').replace(/^export (const|function) /gm, '$1 ')
  + '\nmodule.exports = { isUnresolved, plainTitle, pmUnresolved, pmAlertCards };\n';
fs.writeFileSync(path.join(dir, 'm.cjs'), src);
const { isUnresolved, pmUnresolved, pmAlertCards } = require(path.join(dir, 'm.cjs'));

// 판정: 올린 건·승인 필요·3일 이상만. 조사 중·검증 중·예정은 제외.
assert.equal(isUnresolved({ state: 'escalated', days: 1 }), true);
assert.equal(isUnresolved({ state: 'needs-approval', days: 1 }), true);
assert.equal(isUnresolved({ state: 'planned', days: 3 }), true);
assert.equal(isUnresolved({ state: 'investigating', days: 1 }), false);
assert.equal(isUnresolved({ state: 'verifying', days: 2 }), false);
assert.equal(isUnresolved(null), false);

const rows = pmUnresolved([
  { key: 'staff-decode-fresh', state: 'investigating', days: 1, msg: '캡처는 오는데 해독 3시간+ 멈춤: 아드리아나(마지막 없음)' },
  { key: 'staff-decode-fresh', state: 'escalated', days: 1, msg: '캡처는 오는데 해독 3시간+ 멈춤: 아드리아나(마지막 없음)' },
  { key: 'staff-silent', state: 'escalated', days: 1, msg: '오늘 켜져 있던 PC가 40분+ 무응답: 박성수(10:13)' },
  { key: 'auto-erpgap-김원빈', state: 'escalated', days: 1, msg: '전산 대조 공백: 김원빈 저장 6건 중 일치 2건(33%), 변경없음 1건. 안 맞은 예: …' },
  { key: 'kakao-report', state: 'needs-approval', days: 1, msg: '카톡 일일보고 마지막 발송 2026-11-09' },
  { key: 'radar-pilot-microsoft-playwright', state: 'needs-approval', days: 1, msg: '[기술 파일럿] microsoft/playwright 시험 완료 — 5점: 실물량표 47시트' },
  { key: 'radar-pilot-stale', state: 'escalated', days: 2, msg: '"바로 시험" 항목 7일+ 파일럿 미완 7건: a, b' },
  { key: 'auto-todo-server_js_8500', state: 'escalated', days: 1, msg: 'TODO 처리: mindmap-viewer server.js:8500' },
  { key: 'auto-todo-src_avatar-store_js_226', state: 'escalated', days: 1, msg: 'TODO 처리: mindmap-viewer src/avatar-store.js:226' },
  { key: 'auto-ci-42984892095', state: 'escalated', days: 1, msg: '본편 자동 검사 실패: Build Windows Installer' },
  { key: 'vision-decode-verify', state: 'escalated', days: 1, msg: '야간 병렬 해독 효과 검증(대화 2026-11-10)' },
  { key: 'auto-followup-vision-decode-verify', state: 'escalated', days: 1, msg: '장기 미해결(vision-decode-verify) 후속' },
  { key: 'something-new', state: 'planned', days: 4, msg: '[실행] 새 종류의 일이 생김 — 자세한 내부 설명' },
]);
const titles = rows.map((r) => r.title);
assert.deepEqual(titles.slice(0, 2).sort(), ['기술 시험 끝남: playwright (5점)', '카톡 일일 보고가 11/9 이후 안 나감'].sort(), '승인 필요가 맨 위');
assert.ok(titles.includes('아드리아나 PC 화면 해독이 3시간 넘게 멈춤'));
assert.equal(titles.filter((t) => /화면 해독이 3시간/.test(t)).length, 1, '조사 중인 같은 건은 목록에 없다');
assert.ok(titles.includes('박성수 PC가 40분 넘게 응답 없음'));
assert.ok(titles.includes('김원빈 PC 전산 대조: 6건 중 4건 안 맞음'));
assert.ok(titles.includes('기술 시험 7건이 7일 넘게 시작 못 함'));
assert.ok(titles.includes('프로그램에 미완성으로 남은 곳 2곳'), '같은 종류는 한 줄로 묶는다');
assert.ok(titles.includes('Orbit 자동 검사 실패 1건'));
assert.equal(titles.filter((t) => /야간 화면 해독/.test(t)).length, 1, '후속 건은 원래 건과 한 줄');
assert.ok(titles.includes('새 종류의 일이 생김'));
for (const t of titles) assert.ok(!/staff-|auto-|erpgap|radar-pilot|escalat|TODO/i.test(t), `내부 이름이 제목에 없다: ${t}`);
const kakao = rows.find((r) => /카톡/.test(r.title));
assert.equal(kakao.todo, '다시 보낼지 결정'); assert.equal(kakao.since, '1일째');
assert.equal(rows.find((r) => /박성수/.test(r.title)).todo, '사장님 확인 필요');
assert.equal(rows.find((r) => /새 종류/.test(r.title)).since, '4일째');
assert.deepEqual(pmUnresolved(undefined), []);
assert.deepEqual(pmUnresolved([{ key: 'x', state: 'verifying', days: 1 }]), []);
// 관리자 알림 창 카드: 쉬운 제목 + 내용·정할 것. 묶인 항목은 상세를 붙이지 않는다.
const cards = pmAlertCards([
  { key: 'radar-pilot-apache-echarts', state: 'needs-approval', days: 1, msg: '[기술 파일럿] apache/echarts 시험 완료 — 6점: 합계 100% 일치', decision: '승인 대기: 채택 여부 사장님 결정', owner: '사장님' },
  { key: 'staff-silent', state: 'escalated', days: 2, msg: '오늘 켜져 있던 PC가 40분+ 무응답: 박성수(10:13)' },
  { key: 'auto-todo-a', state: 'escalated', days: 1, msg: 'TODO 처리: a' },
  { key: 'auto-todo-b', state: 'escalated', days: 1, msg: 'TODO 처리: b' },
  { key: 'x', state: 'verifying', days: 1, msg: '검증 중' },
  { key: 'long', state: 'escalated', days: 1, msg: '가'.repeat(900) },
]);
assert.equal(cards.length, 4);
const pilot = cards[0];
assert.equal(pilot.approval, true, '승인 필요가 맨 위'); assert.equal(pilot.sig, 'radar-pilot-apache-echarts|approval');
assert.equal(pilot.title, '기술 시험 끝남: echarts (6점)'); assert.equal(pilot.todo, '쓸지 말지 결정');
assert.ok(pilot.detail.startsWith('apache/echarts 시험 완료'), '앞의 [표시]는 뗀다'); assert.equal(pilot.decision, '승인 대기: 채택 여부 사장님 결정');
const silent = cards.find((c) => c.id === 'staff-silent');
assert.equal(silent.approval, false); assert.equal(silent.sig, 'staff-silent|check'); assert.equal(silent.since, '2일째'); assert.equal(silent.decision, '');
const todo = cards.find((c) => c.id === 'todo');
assert.equal(todo.title, '프로그램에 미완성으로 남은 곳 2곳'); assert.equal(todo.detail, '', '묶인 항목은 상세 없음');
assert.ok(cards.find((c) => c.id === 'long').detail.length <= 400);
assert.deepEqual(pmAlertCards(null), []);
// 관리자 알림 API 는 관리자 계정에만 열리고 그 외에는 404 로 숨긴다(읽기 전용).
const api = fs.readFileSync(path.join(process.cwd(), 'pages', 'api', 'pm', 'admin-alerts.js'), 'utf8');
assert.ok(api.includes('if (!isOrbitReportViewer(user)) return res.status(404)'), '관리자 아니면 404');
assert.ok(api.includes('GET only')); assert.ok(!/writeFile|appendFile|getPool|mssql/.test(api), '쓰기·DB 없음');
console.log('pmUnresolved: OK');
