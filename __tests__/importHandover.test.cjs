// __tests__/importHandover.test.cjs — 수입부 인수인계 업무표·새 기준 매뉴얼 검사(MSSQL 불필요).
//   매뉴얼 6항목이 다 있는지, 단계 번호가 1,2,3… 인지, 영상 목차와 글 단계의 번호·제목이 같은지,
//   업무표 줄마다 확정/추정과 근거가 있는지, 쓰지 않는 말이 없는지, 화면 색 하드코딩이 없는지 본다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repo = process.cwd();
const strip = (src) => src.replace(/^import (\w+) from '(fs|path)';/gm, "const $1 = require('$2');").replace(/^export (const|function|async function) /gm, '$1 ');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ih-test-'));
fs.writeFileSync(path.join(tmp, 'ih.cjs'), strip(fs.readFileSync(path.join(repo, 'lib', 'importHandover.js'), 'utf8'))
  + '\nmodule.exports = { loadImportHandover, validateImportHandover, importHandoverForView, BANNED_WORDS };');
const H = require(path.join(tmp, 'ih.cjs'));
const guides = JSON.parse(fs.readFileSync(path.join(repo, 'config', 'workflow-guides.json'), 'utf8')).workflows;

// 1) 저장소의 실제 자료가 기준을 통과
const data = H.loadImportHandover();
assert.ok(data, 'data/import-handover.json 을 읽을 수 있어야 함');
assert.deepEqual(H.validateImportHandover(data, guides), [], '수입부 인수인계 자료가 매뉴얼 기준을 통과해야 함');
assert.ok(data.manuals.some((m) => m.id === 'product-new-registration' && m.video), '신규 품목 등록은 영상 + 글 매뉴얼이어야 함');
for (const kind of ['daily', 'weekly', 'monthly']) assert.ok(data.schedule[kind].length > 0, `${kind} 업무표가 비어 있으면 안 됨`);
assert.ok(data.questions.length > 0 && data.notYet.length > 0, '물어볼 질문·못 만든 절차 목록이 있어야 함');
const view = H.importHandoverForView();
const linked = [...view.schedule.daily, ...view.schedule.weekly, ...view.schedule.monthly].filter((r) => r.manualId);
assert.ok(linked.length > 0 && linked.every((r) => r.manualTitle), '업무표 줄에서 매뉴얼로 들어갈 수 있어야 함');

// 1-1) 국가별 주간 업무표: 나라가 나뉘어 있고 칸마다 작업 순서가 있음
assert.ok(data.countryCalendar.length >= 6, '국가별 주간 업무표에 나라가 나뉘어 있어야 함');
for (const want of ['콜롬비아', '중국', '네덜란드', '태국', '에콰도르']) assert.ok(data.countryCalendar.some((c) => c.country.includes(want)), `${want} 줄이 있어야 함`);
assert.ok(data.countryCalendar.some((c) => c.cells.some((x) => x.manualId)), '칸에서 매뉴얼로 들어갈 수 있어야 함');
const oneWord = { version: 1, manuals: [], schedule: {}, countryCalendar: [{ country: '콜롬비아', partner: '농장', cells: [{ weekday: '월', title: '입고', steps: [], screens: [], time: '', handoff: '', status: 'estimated', evidence: [] }] }] };
const bad = H.validateImportHandover(oneWord);
assert.ok(bad.some((x) => x.includes('한 단어가 아니라')) && bad.some((x) => x.includes('작업 순서')), '한 단어짜리 칸을 잡아야 함');

// 2) 기준 위반을 잡아내는지
const good = { id: 'a', title: '가', status: 'estimated', why: '왜', when: '언제', prepare: ['자료'], steps: [{ no: 1, title: '하나', look: '봄', input: '넣음', why: '이유', captureKind: 'screen' }], media: { video: '대기', videoWaiting: '연습 자료 준비 뒤' }, doneCheck: ['확인'], pitfalls: [{ mistake: '실수', fix: '처리' }], next: '다음', evidence: [{ source: '전산', count: 1 }] };
const wrap = (m, schedule = {}) => ({ version: 1, manuals: [m], schedule });
assert.deepEqual(H.validateImportHandover(wrap(good)), []);
assert.ok(H.validateImportHandover(wrap({ ...good, why: '' })).some((x) => x.includes('①')), '왜·언제 누락을 잡아야 함');
assert.ok(H.validateImportHandover(wrap({ ...good, media: { video: '대기' } })).some((x) => x.includes('videoWaiting')), '영상이 없는데 이유가 없으면 잡아야 함(놓치지 않게)');
assert.ok(H.validateImportHandover(wrap({ ...good, steps: [{ ...good.steps[0], captureKind: undefined }] })).some((x) => x.includes('captureKind')), '단계에 화면 종류가 없으면 잡아야 함');
assert.ok(H.validateImportHandover(wrap({ ...good, steps: [{ ...good.steps[0], no: 2 }] })).some((x) => x.includes('번호')), '단계 번호가 1부터가 아니면 잡아야 함');
assert.ok(H.validateImportHandover(wrap({ ...good, steps: [{ no: 1, title: '신규 누르기', look: '', input: '', why: '' }] })).some((x) => x.includes('무엇을 보고')), '버튼 순서만 있는 단계를 잡아야 함');
assert.ok(H.validateImportHandover(wrap({ ...good, doneCheck: [] })).some((x) => x.includes('④')));
assert.ok(H.validateImportHandover(wrap({ ...good, video: { workflowId: 'w', guideId: 'g' } }), [{ id: 'w', guides: [{ id: 'g', chapters: [{ title: '1. 다른 제목' }] }] }]).some((x) => x.includes('영상 목차')), '영상 목차와 글 단계 제목이 다르면 잡아야 함');
assert.deepEqual(H.validateImportHandover(wrap({ ...good, video: { workflowId: 'w', guideId: 'g' } }), [{ id: 'w', guides: [{ id: 'g', chapters: [{ title: '1. 하나' }] }] }]), []);
assert.ok(H.validateImportHandover(wrap(good, { daily: [{ id: 'r', when: '08:00', title: '일', status: 'confirmed', evidence: [] }] })).some((x) => x.includes('확정이면')), '근거 없는 확정을 잡아야 함');
assert.ok(H.validateImportHandover(wrap(good, { daily: [{ id: 'r', when: '08:00', title: '일', status: 'estimated', evidence: [], manualId: 'none' }] })).some((x) => x.includes('없는 매뉴얼')));
assert.ok(H.validateImportHandover(wrap({ ...good, why: '직원을 감시하려고' })).some((x) => x.includes('쓰지 않는 말')));

// 3) 화면: 색 하드코딩 금지, 6항목 제목이 화면에 있음, 첫 화면에 걸려 있음
const ui = fs.readFileSync(path.join(repo, 'components', 'manuals', 'ImportHandover.js'), 'utf8');
assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(ui.replace(/&#?\w+;/g, '')), 'ImportHandover 는 /pm 색 토큰만 써야 함(hex 금지)');
for (const head of ['① 이 일을 왜', '② 시작 전에 준비할 자료', '③ 단계별로 따라 하기', '④ 끝났는지 확인하는 법', '⑤ 자주 틀리는 곳', '⑥ 다음 일']) assert.ok(ui.includes(head), `매뉴얼 화면에 "${head}" 가 있어야 함`);
for (const w of H.BANNED_WORDS) assert.ok(!ui.includes(w), `화면 문구에 쓰지 않는 말: ${w}`);
const page = fs.readFileSync(path.join(repo, 'pages', 'work', 'manuals.js'), 'utf8');
assert.ok(page.includes('<ImportHandover') && page.includes('data.handover'), '부서별 업무 매뉴얼 첫 화면에 수입부 업무표가 걸려 있어야 함');
assert.ok(fs.readFileSync(path.join(repo, 'pages', 'api', 'work', 'manuals.js'), 'utf8').includes('importHandoverForView'), 'API 가 업무표를 내려 줘야 함');

console.log('importHandover ok');

// 4) 신입 교육 자료: 그림·사전에 쓸 자료가 있고, 개인 이름·쓰지 않는 말이 없음
{
  const edu = JSON.parse(fs.readFileSync(path.join(repo, 'data', 'import-education.json'), 'utf8'));
  assert.ok(edu.countries.length >= 5 && edu.countries.every((c) => c.subs.length && Object.keys(c.heat).length), '나라별 카드(입고 요일 규칙·달력)');
  assert.ok(edu.cycles.length >= 1 && edu.cycles.every((c) => c.events.length >= 10 && c.events.every((e) => e.role && e.what)), '차수 한 바퀴는 역할·내용이 있는 단계 10개 이상');
  for (const k of ['notices', 'qa', 'glossary', 'partners', 'incidents', 'fileKinds', 'templates']) assert.ok(edu[k].length > 0, `교육 자료 ${k}`);
  const raw = JSON.stringify(edu);
  for (const w of H.BANNED_WORDS) assert.ok(!raw.includes(w), `교육 자료에 쓰지 않는 말: ${w}`);
  for (const name of data.manuals.flatMap((m) => m.practicedBy || [])) assert.ok(!raw.includes(name), '교육 자료에는 개인 이름 대신 역할을 쓴다');
  assert.ok(!/01[016789][- ]?\d{3,4}[- ]?\d{4}/.test(raw), '교육 자료에 전화번호가 없어야 함');
  const eui = fs.readFileSync(path.join(repo, 'components', 'manuals', 'ImportEducation.js'), 'utf8');
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(eui), 'ImportEducation 은 /pm 색 토큰만 써야 함');
  assert.ok(ui.includes("'신입 교육'") && ui.includes('<ImportEducation'), '업무표에 신입 교육 탭이 있어야 함');
}
console.log('importEducation ok');
