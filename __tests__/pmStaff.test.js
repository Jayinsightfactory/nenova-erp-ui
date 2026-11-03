// __tests__/pmStaff.test.js — /pm 직원 상세 슬라이스: 별칭·준비도 계산·파이프라인 단계·후보 순위·개인정보(evidence 미노출)
// 실행: node __tests__/pmStaff.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const src = fs.readFileSync(path.join(process.cwd(), 'lib', 'pmStaff.js'), 'utf8').replace(/^export (const|function) /gm, '$1 ')
  + '\nmodule.exports = { buildStaffSlice, summarizeWorkflow, freqPerWeek, findPerson };';
const mod = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pms-')), 'pmStaff.cjs');
fs.writeFileSync(mod, src);
const m = require(mod);

const step = (conf, basis, dest) => ({ no: 1, text: 't', confidence: conf, sourceVerified: basis ? { basis } : undefined, destination: dest ? { app: dest } : null, evidence: ['secret-window-title'] });
const workflows = { generatedAt: 'g', people: [{ name: '아드리아나', dept: '수입부', roleSummary: 'r', workflows: [
  { name: 'ETA 입력', frequency: '매일', stepsDetail: [step('confirmed', 'erp-verified', '전산'), step('confirmed', null, '네노바웹'), step('confirmed'), step('confirmed'), step('estimated')] },
  { name: '정산', frequency: '월 1회', stepsDetail: [step('estimated'), step('confirmed')] },
] }] };
const simulations = { people: [{ name: '아드리아나', items: [{ title: 'ETA 입력', observed: 'o', before: { totalMinutes: 30, perWeek: 5 }, after: { totalMinutes: 5 }, savingPerWeekMin: 125 }] }] };

const s = m.buildStaffSlice('김지니', { workflows, simulations });
assert.strictEqual(s.dataName, '아드리아나', '별칭');
const w = s.workflows[0];
assert.deepStrictEqual([w.readiness.total, w.readiness.confirmed, w.readiness.erpVerified, w.readiness.executable, w.readiness.estimated, w.readiness.ratio], [5, 4, 1, 2, 1, 80]);
assert.strictEqual(w.pipelineStage, '절차 확정');
assert.strictEqual(s.workflows[1].pipelineStage, '관찰');
assert.strictEqual(s.summary.savedPerWeekMin, 125);
assert.strictEqual(s.summary.candidates[0].name, 'ETA 입력');
assert.strictEqual(s.simulations[0].savedPerCase, 25);
assert.ok(!JSON.stringify(s).includes('secret-window-title'), 'evidence 미노출');
const none = m.buildStaffSlice('임재용', { workflows, simulations });
assert.strictEqual(none.hasData, false);
assert.strictEqual(m.freqPerWeek('매일'), 5);
// workflowRefs 정확 연결 우선, perWeek 출처
const w2 = { people: [{ name: 'A', workflows: [{ name: '발주', frequency: '매일', observed: { days: 6, weeks: 3, perWeek: 2, basis: 'evidence-capture-days' }, stepsDetail: [step('confirmed')] }, { name: '정산', stepsDetail: [step('confirmed')] }] }] };
const s2 = { people: [{ name: 'A', items: [{ title: '정산 자동', workflowRefs: ['정산'], observed: '발주', before: { totalMinutes: 10, perWeek: 3 }, after: { totalMinutes: 4 } }] }] };
const r2 = m.buildStaffSlice('A', { workflows: w2, simulations: s2 });
assert.strictEqual(r2.workflows[0].link, null, 'refs 있는 개선안은 이름포함 추정연결 안 함');
assert.strictEqual(r2.workflows[0].freq.source, 'observed');
assert.strictEqual(r2.workflows[0].freq.perWeek, 2);
assert.strictEqual(r2.workflows[1].link.basis, 'exact');
assert.strictEqual(r2.workflows[1].freq.source, 'simulation');
console.log('pmStaff tests passed');
