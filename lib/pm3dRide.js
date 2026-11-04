// lib/pm3dRide.js — /pm 3D 탈것 주행 경로(순수 함수, 테스트 대상: __tests__/pm3dRide.test.js)
// 설계: docs/pm-skills-mounts.md 2절. 좌표는 lib/pm3dLayout 과 같은 월드 미터.
//   둘레 보드워크(링) = 맵 가장자리 안쪽 1타일 순환로. 자리↔스테이션은 책상 열 사이 틈 → 복도(z=±CORRIDOR) → 스테이션 앞.
import { DESK_DX, DESK_DZ, STATION_GAP, stationPos, SEAT_OFF, CAM_YAW } from './pm3dLayout.js';

export const RIDE_MAX_CONCURRENT = 3;   // 동시 주행 상한(사장님 지시)
export const CORRIDOR_Z = 2.0;          // 스테이션 줄(z=0)과 책상 첫 줄(|z|=4) 사이 복도
export const RING_INSET = 1.0;          // 둘레 순환로: 바닥 경계에서 안쪽으로

// 둘레 순환로(시계방향 사각 루프). 진행도 t∈[0,1) → {x,z,yaw}
export function ringRect(hx, hz, inset = RING_INSET) {
  return { x0: -hx + inset, z0: -hz + inset, x1: hx - inset, z1: hz - inset };
}
export function ringPoint(hx, hz, t, inset = RING_INSET) {
  const { x0, z0, x1, z1 } = ringRect(hx, hz, inset);
  const w = x1 - x0; const d = z1 - z0; const peri = 2 * (w + d);
  let s = ((t % 1) + 1) % 1 * peri;
  if (s < w) return { x: x0 + s, z: z0, yaw: Math.PI / 2 };
  s -= w;
  if (s < d) return { x: x1, z: z0 + s, yaw: 0 };
  s -= d;
  if (s < w) return { x: x1 - s, z: z1, yaw: -Math.PI / 2 };
  s -= w;
  return { x: x0, z: z1 - s, yaw: Math.PI };
}
export function ringLength(hx, hz, inset = RING_INSET) {
  const { x0, z0, x1, z1 } = ringRect(hx, hz, inset);
  return 2 * ((x1 - x0) + (z1 - z0));
}

// 자리(책상 d={x,z}) → 스테이션 no 주행 폴리라인. 책상 틈(오른쪽 +DESK_DX/2)으로 나와 복도를 달린다.
export function ridePath(desk, stationNo, { hx, hz } = {}) {
  const sp = stationPos(stationNo);
  const sign = desk.z >= 0 ? 1 : -1;
  const gapX = desk.x + DESK_DX / 2;           // 책상 열 사이 틈(모든 줄 공통으로 비어 있음)
  const corridor = sign * CORRIDOR_Z;
  const seat = { x: desk.x - Math.sin(CAM_YAW) * SEAT_OFF, z: desk.z - Math.cos(CAM_YAW) * SEAT_OFF };
  const front = { x: sp.x, z: sign * 1.35 };   // 스테이션 받침(r0.8) 바깥 앞
  const pts = [
    { x: seat.x, z: seat.z },
    { x: gapX, z: seat.z },                    // 옆으로 틈까지
    { x: gapX, z: corridor },                  // 틈을 따라 복도로
    { x: sp.x, z: corridor },                  // 복도 주행
    front,
  ];
  // 중복점 제거
  const out = [pts[0]];
  for (const p of pts.slice(1)) { const q = out[out.length - 1]; if (Math.abs(q.x - p.x) > 1e-6 || Math.abs(q.z - p.z) > 1e-6) out.push(p); }
  return out;
}

export function pathLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  return L;
}
// 폴리라인 진행도 s(미터) → {x,z,yaw}
export function pathPoint(pts, s) {
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x; const dz = pts[i].z - pts[i - 1].z;
    const L = Math.hypot(dx, dz);
    if (s <= L || i === pts.length - 1) {
      const k = L ? Math.min(1, Math.max(0, s / L)) : 0;
      return { x: pts[i - 1].x + dx * k, z: pts[i - 1].z + dz * k, yaw: Math.atan2(dx, dz) };
    }
    s -= L;
  }
  const p = pts[pts.length - 1];
  return { x: p.x, z: p.z, yaw: 0 };
}

// 선분 ↔ 사각형(중심 cx,cz 반폭 hw,hd) 교차 — 주행 경로 충돌 테스트용
export function segIntersectsRect(a, b, { cx, cz, hw, hd }) {
  const minx = Math.min(a.x, b.x), maxx = Math.max(a.x, b.x);
  const minz = Math.min(a.z, b.z), maxz = Math.max(a.z, b.z);
  if (maxx < cx - hw || minx > cx + hw || maxz < cz - hd || minz > cz + hd) return false;
  // 축정렬 경로(수평/수직 선분만 씀)라 AABB 겹침이면 교차
  return true;
}
export function pathIntersects(pts, rects) {
  for (let i = 1; i < pts.length; i++) for (const r of rects) if (segIntersectsRect(pts[i - 1], pts[i], r)) return true;
  return false;
}

// 책상·스테이션 충돌 사각(여유 포함). 자기 자리 책상은 출발점이 닿아 있으니 호출부에서 뺀다.
export function deskRect(d, margin = 0.15) { return { cx: d.x, cz: d.z, hw: 0.87 + margin, hd: 0.51 + margin }; }
export function stationRect(no, margin = 0.1) { const p = stationPos(no); return { cx: p.x, cz: p.z, hw: 0.8 + margin, hd: 0.8 + margin }; }
