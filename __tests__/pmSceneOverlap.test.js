// __tests__/pmSceneOverlap.test.js — 배경 장면 겹침 검사: 라벨칩이 캐릭터·이름표·다른 칩과 교차 0, 이름표가 캐릭터 히트영역과 교차 0.
//   모든 배경 지도 × 화면 폭(1100·1440·1920) × 실데이터 형태 샘플(12명·로봇 11·지금 작업 8건).
// 실행: node __tests__/pmSceneOverlap.test.js  (ESM lib 를 쓰므로 동적 import)
const assert = require('assert');
const fs = require('fs');
const path = require('path');
(async () => {
  const { register } = require('module');
  const maps = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'lib', 'pmSceneMaps.json'), 'utf8'));
  const src = fs.readFileSync(path.join(process.cwd(), 'lib', 'pmSceneLayout.js'), 'utf8')
    .replace("import { seatPoints } from './pmSceneMap';", fs.readFileSync(path.join(process.cwd(), 'lib', 'pmSceneMap.js'), 'utf8').split('\n').filter((l) => !/^import /.test(l) && !/PM_SCENE_MAPS|hasSceneMap|sceneMapFor/.test(l)).join('\n'));
  const tmp = path.join(require('os').tmpdir(), `pmSceneLayout-${process.pid}.mjs`);
  fs.writeFileSync(tmp, src);
  const { layoutScene, boxesOverlap } = await import(require('url').pathToFileURL(tmp).href);
  fs.unlinkSync(tmp);
  void register;
  const R = { '경영지원': ['강명훈', '설연주'], '영업지원': ['임재용', '강현우', '김도준'], '영업부': ['김원영', '박성수', '정재훈', '조현욱', '송준호'], '수입부': ['김원빈', '김지니'] };
  const rooms = Object.entries(R).map(([dept, names]) => ({ dept, seats: names.map((name) => ({ name, dept, status: 'working' })) }));
  const agents = Array.from({ length: 11 }, (_, i) => ({ id: `a${i}`, name: `에이전트${i}`, status: 'working' }));
  const names = Object.values(R).flat();
  const links = names.slice(0, 8).map((name, i) => ({ name, stage: [1, 1, 3, 5, 5, 5, 8, 9][i], kind: 'current', text: '콜롬비아 인보이스 확인 중', hm: '14:20' }));
  const labelOf = (l) => `${l.text} · ${l.hm}`;
  let n = 0; let maxErr = 0; let sumErr = 0; let cnt = 0;
  for (const [id, map] of Object.entries(maps)) {
    if (id === '_doc') continue;
    for (const hostW of [1100, 1440, 1920]) {
      const L = layoutScene({ map, rooms, agents, links, hostW, labelOf });
      const chars = L.seats.map((s) => s.box); const tags = L.seats.map((s) => s.tag);
      L.chips.forEach((c, i) => {
        for (const o of [...chars, ...tags]) assert.ok(!boxesOverlap(c, o, 0), `${id}@${hostW} 칩 "${c.key}" 이 ${o.kind} ${o.name} 와 겹침`);
        L.chips.slice(i + 1).forEach((d) => assert.ok(!boxesOverlap(c, d, 0), `${id}@${hostW} 칩 ${c.key}·${d.key} 겹침`));
      });
      L.stations.forEach((st) => [...chars, ...tags].forEach((o) => assert.ok(!boxesOverlap(st, o, 0), `${id}@${hostW} 스테이션 ${st.no} 이 ${o.kind} ${o.name} 와 겹침`)));
      tags.forEach((t) => chars.forEach((c) => { if (c.name !== t.name) assert.ok(!boxesOverlap(t, c, 0), `${id}@${hostW} 이름표 ${t.name} 이 캐릭터 ${c.name} 을 덮음`); }));
      // 같은 스테이션 묶음: 스테이션 1 두 명 → 한 칩 "+1"
      const s5 = L.chips.find((c) => c.stage === 5); if (s5) assert.ok(/\+2$/.test(s5.text), `${id} 스테이션5 묶음 +2`);
      // 캐릭터-책상 정렬 오차: 지도 자리(seats[i])에서 실제 앉은 점까지 거리(%)
      const errs = L.seats.map((st) => { const base = map.seats[st.dept][st.i % map.seats[st.dept].length]; return Math.hypot(st.p[0] - base[0], st.p[1] - base[1]); });
      const firstLap = L.seats.filter((st) => st.i < map.seats[st.dept].length).map((st) => Math.hypot(st.p[0] - map.seats[st.dept][st.i][0], st.p[1] - map.seats[st.dept][st.i][1]));
      maxErr = Math.max(maxErr, ...firstLap); sumErr += errs.reduce((a, b) => a + b, 0); cnt += errs.length;
      assert.ok(Math.max(...firstLap) <= 8, `${id}@${hostW} 캐릭터-책상 정렬 오차 ${Math.max(...firstLap).toFixed(1)}% > 8%`);
      n += 1;
    }
  }
  console.log(`pmSceneOverlap ok (${n}개 장면·폭 조합, 겹침 0, 책상 정렬 오차 평균 ${(sumErr / cnt).toFixed(2)}% · 최대 ${maxErr.toFixed(1)}%)`);
})().catch((e) => { console.error(e.message); process.exit(1); });
