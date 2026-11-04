// __tests__/workManualRoutines.test.js — 부서별 신입 루틴: 근거0='추정', 직원 확인은 _state.json 에 남아 데이터 재생성이 덮어쓰지 않음,
//   화면 색 하드코딩 금지, 데이터 스냅샷에 금액·연락처 없음. 실행: node __tests__/workManualRoutines.test.js (MSSQL 불필요)
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repo = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wmr-test-'));
fs.mkdirSync(path.join(tmp, 'data', 'work-manuals'), { recursive: true });
const sample = {
  generatedAt: '2026-11-04T00:00:00Z', period: { from: '2026-10-03', to: '2026-11-02' },
  departments: [{ id: 'import', name: '수입부', people: [{ name: '김원빈', observedDays: 17,
    daily: [{ id: 'a', from: '09:00', to: '09:30', evidence: { count: 12, days: 9, of: 17 }, confidence: 'high' },
      { id: 'b', from: '10:00', to: '10:30', evidence: { count: 0, days: 0, of: 17 }, confidence: 'high' }],
    weekly: [], monthly: [{ id: 'm', evidence: { days: 3, of: 4, months: 1 }, confidence: 'estimate' }], mail: [] }] }],
  field: { staff: [] },
};
fs.writeFileSync(path.join(tmp, 'data', 'work-feature-manual-routines.json'), JSON.stringify(sample));
process.chdir(tmp);

const strip = (src) => src.replace(/^import (\w+) from '(fs|path)';/gm, "const $1 = require('$2');").replace(/^export (const|function|async function) /gm, '$1 ');
const fd = strip(fs.readFileSync(path.join(repo, 'lib', 'workFeatureData.js'), 'utf8')) + '\nmodule.exports = { FEATURE_NAMES, featureFilePath };';
fs.writeFileSync(path.join(tmp, 'wfd.cjs'), fd);
const wm = strip(fs.readFileSync(path.join(repo, 'lib', 'workManuals.js'), 'utf8'))
  .replace(/^import \{ isOrbitReportViewer \} from '\.\/orbitReportAccess';/m, 'const isOrbitReportViewer = () => false;')
  + '\nmodule.exports = { loadState, saveRoutineConfirmState };';
fs.writeFileSync(path.join(tmp, 'wm.cjs'), wm);
const wr = strip(fs.readFileSync(path.join(repo, 'lib', 'workManualRoutines.js'), 'utf8'))
  .replace(/^import \{ featureFilePath \} from '\.\/workFeatureData';/m, "const { featureFilePath } = require('./wfd.cjs');")
  .replace(/^import \{ loadState, saveRoutineConfirmState \} from '\.\/workManuals';/m, "const { loadState, saveRoutineConfirmState } = require('./wm.cjs');")
  + '\nmodule.exports = { normalizeConfidence, getRoutines, confirmRoutineItem, routinesForView };';
fs.writeFileSync(path.join(tmp, 'wr.cjs'), wr);
const { FEATURE_NAMES } = require(path.join(tmp, 'wfd.cjs'));
const R = require(path.join(tmp, 'wr.cjs'));

assert.ok(FEATURE_NAMES.includes('manual-routines'), 'feature-data-ingest 가 manual-routines 를 받아야 함');
// 근거 0 이면 생성기가 high 를 줘도 '추정'
assert.strictEqual(R.normalizeConfidence({ evidence: { count: 0, days: 0 }, confidence: 'high' }), 'estimate');
assert.strictEqual(R.normalizeConfidence({ evidence: { count: 12, days: 9 }, confidence: 'high' }), 'high');
const v = R.getRoutines();
assert.strictEqual(v.departments[0].people[0].daily[1].confidence, 'estimate');

// 직원 확인 → state 에 저장, 데이터 파일 재생성 후에도 유지
const user = { userId: 'kwb', userName: '김원빈' };
assert.strictEqual(R.confirmRoutineItem(user, 'nope', { status: 'confirmed' }).status, 404);
assert.strictEqual(R.confirmRoutineItem(user, 'a', { status: 'bogus' }).status, 400);
assert.ok(R.confirmRoutineItem(user, 'a', { status: 'confirmed', note: '맞음' }).ok);
sample.generatedAt = '2026-11-11T00:00:00Z';
fs.writeFileSync(path.join(tmp, 'data', 'work-feature-manual-routines.json'), JSON.stringify(sample));
const v2 = R.getRoutines();
assert.strictEqual(v2.departments[0].people[0].daily[0].confirm.status, 'confirmed');
assert.strictEqual(v2.departments[0].people[0].daily[0].confirm.by, '김원빈');
assert.ok(R.confirmRoutineItem(user, 'a', { status: 'clear' }).ok);
assert.strictEqual(R.getRoutines().departments[0].people[0].daily[0].confirm, undefined);
process.chdir(repo);

// 화면: hex 색 금지 · localStorage 는 try/catch
const ui = fs.readFileSync(path.join(repo, 'components', 'manuals', 'RoutineManual.js'), 'utf8');
assert.ok(!/(^|[^&\w$])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/m.test(ui), 'RoutineManual 색은 var(--pm-*) 만');
assert.ok(/try \{ return JSON\.parse\(window\.localStorage/.test(ui) && /try \{ window\.localStorage\.setItem/.test(ui), 'localStorage try/catch');

// 저장소 스냅샷: 구조 + 개인정보(금액·전화·메일 주소) 없음 + 손지윤/Luke 제외
const snapPath = path.join(repo, 'data', 'work-feature-manual-routines.json');
const raw = fs.readFileSync(snapPath, 'utf8');
const snap = JSON.parse(raw);
assert.ok(snap.generatedAt && Array.isArray(snap.departments), 'generatedAt·departments');
assert.ok(snap.departments.some((d) => d.id === 'field'), '현장팀 부서 포함');
assert.ok(!/\d{1,3}(,\d{3}){1,}\s*원/.test(raw), '금액 없음');
assert.ok(!/01[016789]-?\d{3,4}-?\d{4}/.test(raw), '전화번호 없음');
assert.ok(!/[\w.+-]+@[\w-]+\.[\w.]+/.test(raw), '메일 주소 없음');
assert.ok(!/손지윤|"Luke"/.test(raw), '제외 대상');
for (const d of snap.departments) for (const p of d.people) for (const k of ['daily', 'weekly', 'monthly', 'mail']) for (const it of p[k]) {
  assert.ok(it.id && it.evidence, `${p.name} ${k} 항목 근거 필드`);
}
console.log('workManualRoutines ok');
