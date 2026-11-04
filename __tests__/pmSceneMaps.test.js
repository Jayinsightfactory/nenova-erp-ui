// __tests__/pmSceneMaps.test.js — 배경 장면 좌표 지도 검사: 스테이션 9개·부서 5구역·좌표 0~100·배경 파일 존재(600KB 이하)
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const maps = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'lib', 'pmSceneMaps.json'), 'utf8'));
const DEPTS = ['영업지원', '영업부', '수입부', '경영지원', '현장팀'];
const ok = (p) => Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === 'number' && v >= 0 && v <= 100);
let n = 0;
for (const [id, m] of Object.entries(maps)) {
  if (id === '_doc') continue;
  n += 1;
  assert.strictEqual(m.stations.length, 9, `${id} 스테이션 9개`);
  m.stations.forEach((p, i) => assert.ok(ok(p), `${id} 스테이션 ${i + 1} 좌표`));
  for (const d of DEPTS) { assert.ok(Array.isArray(m.seats[d]) && m.seats[d].length, `${id} ${d} 자리`); m.seats[d].forEach((p) => assert.ok(ok(p), `${id} ${d} 좌표`)); }
  assert.ok(m.lab.length === 4 && m.lab[0] < m.lab[2] && m.lab[1] < m.lab[3], `${id} 연구실`);
  assert.ok(m.robots.length >= 1 && m.robots.every(ok), `${id} 로봇`);
  for (const f of [`${m.src}.webp`, `${m.src}-lq.webp`]) {
    const fp = path.join(process.cwd(), 'public', 'pm', 'scene-bg', f);
    assert.ok(fs.existsSync(fp), `${fp} 없음`);
    assert.ok(fs.statSync(fp).size <= 600 * 1024, `${fp} 600KB 초과`);
  }
}
console.log(`pmSceneMaps ok (배경 장면 ${n}종)`);
