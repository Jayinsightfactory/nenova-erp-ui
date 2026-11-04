// __tests__/workLivePipelines.test.js — 라이브 매뉴얼: 목록엔 이미지·직원 이름 없음, 근거0='추정', 직원 확인은 _state.json 에 남아 재생성이 덮어쓰지 않음,
//   화면 색 하드코딩 금지·reduced-motion 처리·UI 키트 버튼만. 실행: node __tests__/workLivePipelines.test.js (MSSQL 불필요)
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repo = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wlp-test-'));
fs.mkdirSync(path.join(tmp, 'data', 'work-manuals'), { recursive: true });
const IMG = 'data:image/jpeg;base64,AAAA';
const sample = {
  generatedAt: '2026-11-04T00:00:00Z', period: { weeks: 8 }, stats: {},
  tasks: [
    { id: 'live-a', task: '인보이스', label: '콜롬비아 인보이스 작업', dept: '수입부', people: ['김원빈', '김지니'], evidence: { sessions: 12, people: 2, lastSeen: '2026-11-03' }, confidence: 'medium',
      handoff: { to: '경영지원', what: '정산·송금 준비' }, totalSec: 300,
      steps: [{ i: 0, title: '메일함 → INVOICE 메일 열기', tool: '메일', avgSec: 120, captures: [{ img: IMG, click: { x: 0.5, y: 0.5 } }] }, { i: 1, title: '전산 입고 입력·저장', tool: '전산', avgSec: 180, captures: [] }] },
    { id: 'live-b', task: '소독 일정', label: '소독 일정 작업', dept: '영업지원', people: [], evidence: { sessions: 0 }, confidence: 'high', steps: [] },
  ],
};
fs.writeFileSync(path.join(tmp, 'data', 'work-feature-live-pipelines.json'), JSON.stringify(sample));
process.chdir(tmp);

const strip = (src) => src.replace(/^import (\w+) from '(fs|path)';/gm, "const $1 = require('$2');").replace(/^export (const|function|async function) /gm, '$1 ');
fs.writeFileSync(path.join(tmp, 'wfd.cjs'), strip(fs.readFileSync(path.join(repo, 'lib', 'workFeatureData.js'), 'utf8')) + '\nmodule.exports = { FEATURE_NAMES, featureFilePath, saveFeatureFile };');
fs.writeFileSync(path.join(tmp, 'wm.cjs'), strip(fs.readFileSync(path.join(repo, 'lib', 'workManuals.js'), 'utf8'))
  .replace(/^import \{ isOrbitReportViewer \} from '\.\/orbitReportAccess';/m, 'const isOrbitReportViewer = () => false;')
  + '\nmodule.exports = { loadState, saveRoutineConfirmState };');
fs.writeFileSync(path.join(tmp, 'wl.cjs'), strip(fs.readFileSync(path.join(repo, 'lib', 'workLivePipelines.js'), 'utf8'))
  .replace(/^import \{ featureFilePath \} from '\.\/workFeatureData';/m, "const { featureFilePath } = require('./wfd.cjs');")
  .replace(/^import \{ loadState, saveRoutineConfirmState \} from '\.\/workManuals';/m, "const { loadState, saveRoutineConfirmState } = require('./wm.cjs');")
  + '\nmodule.exports = { listLivePipelines, getLivePipeline, confirmLivePipeline, liveConfidence };');
const { FEATURE_NAMES } = require(path.join(tmp, 'wfd.cjs'));
const L = require(path.join(tmp, 'wl.cjs'));

assert.ok(FEATURE_NAMES.includes('live-pipelines'), 'feature-data-ingest 가 live-pipelines 를 받아야 함');
const list = L.listLivePipelines();
const rawList = JSON.stringify(list);
assert.ok(!rawList.includes('data:image'), '목록 응답엔 이미지 없음');
assert.ok(!/김원빈|김지니/.test(rawList), '목록 응답엔 직원 이름 없음(수만)');
assert.strictEqual(list.tasks[0].captures, 1);
assert.strictEqual(list.tasks[1].confidence, 'estimate', '근거 0 이면 high 라도 추정');
const one = L.getLivePipeline('live-a');
assert.strictEqual(one.people, 2);
assert.ok(one.steps[0].captures[0].img.startsWith('data:image'), '상세엔 캡처');

const user = { userId: 'kwb', userName: '김원빈' };
assert.strictEqual(L.confirmLivePipeline(user, 'nope', { status: 'confirmed' }).status, 404);
assert.strictEqual(L.confirmLivePipeline(user, 'live-a', { status: 'bogus' }).status, 400);
assert.ok(L.confirmLivePipeline(user, 'live-a', { status: 'wrong', note: '순서 다름' }).ok);
sample.generatedAt = '2026-11-11T00:00:00Z';
fs.writeFileSync(path.join(tmp, 'data', 'work-feature-live-pipelines.json'), JSON.stringify(sample));
assert.strictEqual(L.listLivePipelines().tasks[0].confirm.status, 'wrong', '재생성 후에도 확인 유지');
assert.ok(L.confirmLivePipeline(user, 'live-a', { status: 'clear' }).ok);
assert.strictEqual(L.listLivePipelines().tasks[0].confirm, null);
process.chdir(repo);

const ui = fs.readFileSync(path.join(repo, 'components', 'manuals', 'LivePipelineManual.js'), 'utf8');
assert.ok(!/(^|[^&\w$])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/m.test(ui), 'LivePipelineManual 색은 var(--pm-*) 만');
assert.ok(!/rgba?\(/.test(ui), 'rgb() 하드코딩 금지');
assert.ok(!/<button/.test(ui), '버튼은 components/pm/ui 키트만');
assert.ok(/prefers-reduced-motion/.test(ui), 'reduced-motion 처리');
console.log('workLivePipelines ok');
