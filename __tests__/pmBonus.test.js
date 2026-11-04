// __tests__/pmBonus.test.js — /pm 효율 보상: 기본 OFF, 처리시간 구간·기준선 중앙값·2주 기록만·판정 불가·품질 0·난이도·레벨·팀 퀘스트
// 실행: node __tests__/pmBonus.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmb-'));
const cjs = (f, exp, rep = (s) => s) => rep(fs.readFileSync(path.join(process.cwd(), 'lib', f), 'utf8')).replace(/^export (const|function) /gm, '$1 ') + `\nmodule.exports = { ${exp} };`;
fs.writeFileSync(path.join(dir, 'pmWorkLog.cjs'), cjs('pmWorkLog.js', 'buildHandoffs, DEFAULT_WINDOW_H'));
fs.writeFileSync(path.join(dir, 'pmBonus.cjs'), cjs('pmBonus.js', 'PM_BONUS_ENABLED, segments, baselines, judge, levelOf, teamQuests, bonusView, RECORD_ONLY_DAYS, MIN_SAMPLES',
  (s) => s.replace(/^import \{([^}]+)\} from '\.\/pmWorkLog';/m, "const {$1} = require('./pmWorkLog.cjs');")));
const m = require(path.join(dir, 'pmBonus.cjs'));

delete process.env.PM_BONUS_ENABLED;
assert.strictEqual(m.PM_BONUS_ENABLED(), false, '기본 OFF');
const now = Date.parse('2026-11-03T09:00:00Z');
const day = 86400e3;
const log = [];
// 20일 동안 매일 분배(중국) 60분 → 다음 줄
for (let d = 20; d >= 1; d--) {
  const s = now - d * day;
  log.push({ at: new Date(s).toISOString(), name: '강현우', dept: '영업지원', stage: '분배', country: '중국', label: '중국 분배작업 중' });
  log.push({ at: new Date(s + 60 * 60000).toISOString(), name: '강현우', dept: '영업지원', stage: '견적', country: '중국', label: '견적' });
}
const segs = m.segments(log);
assert.ok(segs.find((s) => s.key === '분배|중국' && s.minutes === 60), '다음 줄까지 = 처리시간');
const base = m.baselines(segs, now)['분배|중국'];
assert.strictEqual(base.medianMin, 60); assert.strictEqual(base.learning, false);
const fast = { key: '분배|중국', stage: '분배', minutes: 40, measurable: true };
assert.strictEqual(m.judge(fast, base, null).verdict, '판정 불가', '품질 신호 없으면 판정 불가(감점 없음)');
assert.strictEqual(m.judge(fast, base, false).points, 0, '재수정·반려 = 품질 0');
assert.strictEqual(m.judge(fast, base, true).points, 3, '(60−40)/10 × 난이도 1.5');
assert.strictEqual(m.judge({ ...fast, minutes: 70 }, base, true).points, 0, '기준보다 느리면 0(감점 없음)');
assert.strictEqual(m.judge({ ...fast, measurable: false }, base, true).verdict, '판정 불가');
assert.strictEqual(m.judge(fast, { ...base, learning: true }, true).verdict, '기록만', '첫 2주는 기록만');
assert.strictEqual(m.judge(fast, { ...base, n: 2 }, true).verdict, '판정 불가', '표본 부족');
assert.deepStrictEqual([m.levelOf(0).level, m.levelOf(300).level, m.levelOf(1500).level], [1, 3, 5]);
assert.ok(m.levelOf(1500).unlocks.includes('legendary') && !m.levelOf(300).unlocks.includes('legendary'));
const v = m.bonusView(log, now);
assert.strictEqual(v.mode, 'record-only');
assert.ok(v.people.every((p) => p.points === 0), '품질 신호 미연결 → 전원 0(기록만)');
const q = m.teamQuests([
  { at: new Date(now - 3600e3).toISOString(), name: '박성수', dept: '영업부', stage: '발주', country: '중국', label: '중국 발주작업 중' },
  { at: new Date(now - 1800e3).toISOString(), name: '김원빈', dept: '수입부', stage: '발주', country: '중국', label: '중국 발주작업 중' },
], now);
assert.strictEqual(q.done, 1); assert.ok(q.depts.includes('영업부') && q.depts.includes('수입부'), '부서 공동 진행');
console.log('pmBonus ok');
