// lib/pm3dDecor.js — /pm 3D(베타) 해변 배경 밀도(순수 함수, 테스트: __tests__/pm3dDecor.test.js)
// 2D 장면(클레이 시안, docs/pm-design-standard.md)과의 가장 큰 격차였던 "빈 모래밭"을 채운다:
//   초가 오두막 3~4채 · 야자수 군락(테두리 다발) · 바위/조개/불가사리 산포.
// 전부 결정적(의사난수 시드 고정)이고, 주행로(둘레 링)·좌석·스테이션·허브·책상과 교차 0 을 보증한다.
import { ringRect, CORRIDOR_Z } from './pm3dRide.js';
import { stationPos, seatWorld } from './pm3dLayout.js';
import { HUB_POS, HUB_R } from './pm3dHub.js';
import { decorCells, cellCenter, occupy, key } from './pm3dGrid.js';

// 최소 이격 거리(m). hut/palm/scatter 가 각 대상에서 떨어져야 하는 거리.
export const DECOR_CLEAR = Object.freeze({
  ring: 0.9,      // 둘레 주행로(탑승 캐릭터 폭 고려)
  seat: 1.3,      // 좌석(책상 그룹 원점 기준 seatWorld)
  desk: 1.5,      // 책상 중심
  station: 1.5,   // 스테이션 1~9
  hub: HUB_R + 1.2,
  item: 1.1,      // 장식끼리
});

const rnd = (n) => { const v = Math.sin(n * 127.1) * 43758.5453; return v - Math.floor(v); };

// 점 → 링(사각 둘레선)까지의 거리
export function ringDistance(hx, hz, x, z) {
  const { x0, z0, x1, z1 } = ringRect(hx, hz);
  const inside = x >= x0 && x <= x1 && z >= z0 && z <= z1;
  if (inside) return Math.min(x - x0, x1 - x, z - z0, z1 - z);
  const dx = Math.max(x0 - x, 0, x - x1); const dz = Math.max(z0 - z, 0, z - z1);
  return Math.hypot(dx, dz);
}

function clearOf(p, ctx, placed) {
  const { hx, hz, desks, seats, stations, corrX } = ctx;
  if (ringDistance(hx, hz, p.x, p.z) < DECOR_CLEAR.ring) return false;
  // 자리↔스테이션 주행 복도(z=±CORRIDOR_Z, lib/pm3dRide) — 책상·스테이션 x 범위 안
  for (const sz of [-1, 1]) {
    const cx = Math.min(Math.max(p.x, corrX[0]), corrX[1]);
    if (Math.hypot(p.x - cx, p.z - sz * CORRIDOR_Z) < DECOR_CLEAR.ring) return false;
  }
  if (Math.hypot(p.x - HUB_POS.x, p.z - HUB_POS.z) < DECOR_CLEAR.hub) return false;
  for (const s of stations) if (Math.hypot(p.x - s.x, p.z - s.z) < DECOR_CLEAR.station) return false;
  for (const d of desks) if (Math.hypot(p.x - d.x, p.z - d.z) < DECOR_CLEAR.desk) return false;
  for (const s of seats) if (Math.hypot(p.x - s.x, p.z - s.z) < DECOR_CLEAR.seat) return false;
  for (const q of placed) if (Math.hypot(p.x - q.x, p.z - q.z) < DECOR_CLEAR.item) return false;
  return true;
}

// 해변 배경 배치. desks = lib/pm3dLayout.layoutDesks().desks, hx/hz = floorBounds 결과.
// 반환: { huts:[{x,z,ry,s}], palms:[{x,z,ry,s}], scatter:[{m,x,z,ry,s}] }
export function beachDecor({ hx, hz, desks = [] }) {
  const stations = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(stationPos);
  const xs = [...desks.map((d) => d.x), ...stations.map((s) => s.x)];
  const ctx = { hx, hz, desks, seats: desks.map(seatWorld), stations, corrX: [Math.min(...xs) - 1.2, Math.max(...xs) + 1.2] };
  const placed = [];
  const keep = (list, arr) => { for (const p of list) if (clearOf(p, ctx, placed)) { placed.push(p); arr.push(p); } };

  // 초가 오두막 3~4채 — 스테이션 줄(z=0) 양옆 빈 띠 + 좌우 가장자리 안쪽(후보 8 → 이격 통과분, 최대 4)
  const huts = [];
  const hutCand = [
    { x: -(hx - 3.2), z: -2.2, ry: 0.5, s: 1.05 }, { x: hx - 3.2, z: -2.0, ry: -0.6, s: 1 },
    { x: -(hx - 3.5), z: 2.3, ry: 0.9, s: 0.95 }, { x: hx - 3.6, z: 2.2, ry: 2.6, s: 1 },
    { x: -(hx * 0.35), z: -(hz - 3.1), ry: 0.3, s: 1 }, { x: hx * 0.4, z: -(hz - 3.3), ry: -0.4, s: 1.05 },
    { x: -(hx * 0.4), z: hz - 3.2, ry: 2.8, s: 0.95 }, { x: hx * 0.35, z: hz - 3.0, ry: 2.4, s: 1 },
  ];
  keep(hutCand, huts);
  huts.length = Math.min(huts.length, 4);

  // 야자수 군락 — 네 모퉁이(링 안쪽) 3그루 다발 + 오두막 곁 1그루
  const palms = [];
  const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  const palmCand = [];
  corners.forEach(([sx, sz], c) => {
    const bx = sx * (hx - 2.7); const bz = sz * (hz - 2.7);
    [[0, 0], [-sx * 1.15, sz * 0.4], [sx * 0.35, -sz * 1.25]].forEach(([ox, oz], k) => {
      palmCand.push({ x: bx + ox, z: bz + oz, ry: rnd(c * 7 + k) * 6, s: 0.85 + rnd(c * 11 + k) * 0.45 });
    });
  });
  huts.forEach((h, i) => palmCand.push({ x: h.x + (h.x > 0 ? -1.5 : 1.5), z: h.z + (i % 2 ? 1.4 : -1.4), ry: rnd(40 + i) * 6, s: 0.9 + rnd(44 + i) * 0.3 }));
  keep(palmCand, palms);

  // 바위·조개·불가사리 산포 — 바닥 전역 결정적 샘플링(링 안쪽), 통과분만
  const scatter = [];
  const models = ['shell', 'starfish', 'rock'];
  const cand = [];
  for (let k = 0; k < 64; k++) {
    const m = models[k % 3];
    cand.push({
      m,
      x: (rnd(k + 101) * 2 - 1) * (hx - 2.0),
      z: (rnd(k + 301) * 2 - 1) * (hz - 2.0),
      ry: rnd(k + 501) * 6,
      s: m === 'rock' ? 0.45 + rnd(k) * 0.55 : 0.8 + rnd(k) * 0.35,
    });
  }
  keep(cand, scatter);
  return { huts, palms, scatter };
}

// 격자 섬 배경(lib/pm3dGrid): 야자수·바위·조개·불가사리를 "비점유 해변 끝단 칸"에만 1칸 1개로 놓고 그 칸을 점유한다.
//   해변 끝단(edge 0)은 둘레 보드워크(edge 1) 바깥이라 걷기 경로를 끊지 않고, 다리 착지 칸 주변은 decorCells 가 뺀다.
//   world 는 layoutDesks().world(호출마다 새로 만듦) — 점유가 기록되어 이후 배치와 충돌 검사가 된다.
export function beachDecorGrid(world) {
  const palms = []; const scatter = [];
  const models = ['shell', 'starfish', 'rock'];
  decorCells(world).forEach((c, i) => {
    const u = rnd(c.X * 7.3 + c.Z * 13.1 + 0.5);
    if (u >= 0.66) return; // [2026-11-06 시안 정합] 장식 밀도 0.42→0.66 — 모래에 조개·불가사리·바위가 시안처럼 깔리게(야자수 비율은 유지)
    const p = cellCenter(c.X, c.Z);
    const o = { x: p.x, z: p.z, X: c.X, Z: c.Z, ry: rnd(i + 501) * 6 };
    if (world.occ.has(key(c.X, c.Z))) return;
    if (u < 0.16) { palms.push({ ...o, s: 0.85 + rnd(i + 11) * 0.4 }); occupy(world, [c], `decor:palm:${palms.length}`); }
    else { const m = models[i % 3]; scatter.push({ ...o, m, s: m === 'rock' ? 0.45 + rnd(i) * 0.5 : 0.8 + rnd(i) * 0.35 }); occupy(world, [c], `decor:${m}:${scatter.length}`); }
  });
  return { huts: [], palms, scatter };
}
