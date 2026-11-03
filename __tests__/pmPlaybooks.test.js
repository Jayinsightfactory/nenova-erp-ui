// __tests__/pmPlaybooks.test.js — /pm 재발 학습 카드 정렬·요약·KST 표기
// 실행: node __tests__/pmPlaybooks.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmpb-'));
const src = fs.readFileSync(path.join(process.cwd(), 'lib', 'pmPlaybooks.js'), 'utf8').replace(/^export (const|function) /gm, '$1 ')
  + '\nmodule.exports = { normalizePlaybooks, playbookSummary, sortPlaybookCards, kstDateTime };';
fs.writeFileSync(path.join(dir, 'pmPlaybooks.cjs'), src);
const m = require(path.join(dir, 'pmPlaybooks.cjs'));

assert.strictEqual(m.normalizePlaybooks(undefined), null);
assert.strictEqual(m.normalizePlaybooks({ total: 3 }), null);
assert.strictEqual(m.playbookSummary(null), null);

const cards = [
  { id: 'a', hits: 0, learnedAt: null },
  { id: 'b', hits: 3, learnedAt: null },
  { id: 'c', hits: 0, learnedAt: '2026-11-03T01:00:00Z' },
  { id: 'd', hits: 0, learnedAt: '2026-11-02T01:00:00Z' },
  { id: 'e', hits: 3, learnedAt: '2026-11-01T00:00:00Z' },
  null,
];
assert.deepStrictEqual(m.sortPlaybookCards(cards).map((c) => c.id), ['e', 'b', 'c', 'd', 'a']);
assert.deepStrictEqual(m.sortPlaybookCards(undefined), []);

const s = m.playbookSummary({ total: 14, learned: 1, hits: 0, resolved: { auto: 0, investigated: 2, escalated: 1 }, cards: [] });
assert.deepStrictEqual(s, { total: 14, learned: 1, hits: 0, auto: 0, investigated: 2, escalated: 1 });
const s2 = m.playbookSummary({ cards });
assert.deepStrictEqual(s2, { total: 5, learned: 3, hits: 6, auto: 0, investigated: 0, escalated: 0 });

assert.strictEqual(m.kstDateTime('2026-11-03T16:05:00Z'), '11-04 01:05');
assert.strictEqual(m.kstDateTime('bad'), '');
assert.strictEqual(m.kstDateTime(null), '');
console.log('pmPlaybooks OK');
