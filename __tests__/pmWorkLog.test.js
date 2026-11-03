// __tests__/pmWorkLog.test.js — /pm 작업 로그 필터·부서간 넘김 추정(같은 국가·N시간)
// 실행: node __tests__/pmWorkLog.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmw-'));
const src = fs.readFileSync(path.join(process.cwd(), 'lib', 'pmWorkLog.js'), 'utf8').replace(/^export (const|function) /gm, '$1 ')
  + '\nmodule.exports = { HANDOFF_CHAINS, buildHandoffs, filterLog, logFacets, kstHM, chainView, nodeMatches, sortLog };';
fs.writeFileSync(path.join(dir, 'pmWorkLog.cjs'), src);
const m = require(path.join(dir, 'pmWorkLog.cjs'));

const R = (at, name, dept, stage, country, label) => ({ at, name, dept, stage, country, label: label || `${country} ${stage}작업 중`, screen: '' });
const log = [
  R('2026-11-03T01:40:00Z', '김원빈', '수입부', '발주', '중국'),       // 10:40 KST
  R('2026-11-03T01:12:00Z', '박성수', '영업부', '발주', '중국'),       // 10:12
  R('2026-11-03T01:00:00Z', '정재훈', '영업부', '발주', '콜롬비아'),
  R('2026-11-03T09:00:00Z', '김지니', '수입부', '발주', '콜롬비아'),   // 8h 뒤 → 6h 초과
  R('2026-11-03T02:00:00Z', '김지니', '수입부', '입고', '중국'),       // 수입부발주(김원빈)→입고
  R('2026-11-03T03:00:00Z', '조현욱', '영업부', '현장출고', ''),       // 국가 없음
  R('2026-11-03T03:30:00Z', '김도준', '영업지원', '분배', ''),
  R('2026-11-03T04:00:00Z', '조현욱', '영업부', '현장출고', '네덜란드'),
  R('2026-11-03T04:20:00Z', '김도준', '영업지원', '견적서', '네덜란드'),
  R('2026-11-03T04:10:00Z', '김원빈', '수입부', '입고', '중국'),       // 같은 사람 김원빈 발주→입고: 제외, 김지니 행과 별개
  { at: 'bad', name: 'x' }, null,
];
assert.strictEqual(m.kstHM('2026-11-03T01:12:00Z'), '10:12');
assert.strictEqual(m.sortLog(log).length, 10);

const h = m.buildHandoffs(log);
const key = (x) => `${x.a.name}>${x.b.name}:${x.country}:${x.gapMin}`;
const keys = h.map(key).sort();
assert.deepStrictEqual(keys, ['김원빈>김지니:중국:20', '박성수>김원빈:중국:28', '조현욱>김도준:네덜란드:20'].sort(), keys.join());
const ps = h.find((x) => x.a.name === '박성수');
assert.ok(ps.sameStage && /추정/.test(ps.basis) && /확정 아님/.test(ps.basis) && /같은 국가\(중국\)/.test(ps.basis) && /28분/.test(ps.basis));
assert.strictEqual(ps.chain, 'order'); assert.strictEqual(ps.from, 'sales-order'); assert.strictEqual(ps.to, 'import-order');
// 창 넓히면 콜롬비아 8h 묶임
assert.ok(m.buildHandoffs(log, { windowH: 10 }).some((x) => x.country === '콜롬비아' && x.gapMin === 480));
// 가장 가까운 앞 행 선택
const h2 = m.buildHandoffs([R('2026-11-03T01:00:00Z', 'A', '영업부', '발주', '중국'), R('2026-11-03T02:00:00Z', 'B', '영업부', '발주', '중국'), R('2026-11-03T02:30:00Z', 'C', '수입부', '발주', '중국')]);
assert.strictEqual(h2.length, 1); assert.strictEqual(h2[0].a.name, 'B');
// 순서 역행(다음 부서가 먼저) 은 넘김 아님
assert.strictEqual(m.buildHandoffs([R('2026-11-03T02:30:00Z', 'A', '영업부', '발주', '중국'), R('2026-11-03T02:00:00Z', 'C', '수입부', '발주', '중국')]).length, 0);
assert.deepStrictEqual(m.buildHandoffs(null), []);

// 외부 노드
const ship = m.HANDOFF_CHAINS.find((c) => c.key === 'ship');
assert.ok(ship.nodes[ship.nodes.length - 1].external);
assert.strictEqual(m.nodeMatches(ship.nodes[3], { dept: '현장팀', stage: '' }), false);
const v = m.chainView(log, h);
assert.strictEqual(v[0].links[0].items.length, 1); assert.strictEqual(v[1].links[2].external, true); assert.strictEqual(v[1].nodes[3].count, null);

// 필터·패싯
assert.strictEqual(m.filterLog(log, { dept: '수입부' }).length, 4);
assert.strictEqual(m.filterLog(log, { country: '중국', stage: '입고' }).length, 2);
assert.strictEqual(m.filterLog(log, { name: '조현욱' }).length, 2);
const f = m.logFacets(log);
assert.ok(f.country.includes('중국') && !f.country.includes(''));
console.log('pmWorkLog ok', h.length);
