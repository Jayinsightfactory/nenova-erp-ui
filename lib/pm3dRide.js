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
  const yaw = Number.isFinite(desk.yaw) ? desk.yaw : CAM_YAW; // 자리 facing(격자 배치) — 옛 데이터는 카메라 정면
  const seat = { x: desk.x - Math.sin(yaw) * SEAT_OFF, z: desk.z - Math.cos(yaw) * SEAT_OFF };
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

// ── 코스 주행(2026-11-06 '탈것이 실제로 코스를 돌게') ──────────────────────────
// 임의 사각 루프: rect={x0,z0,x1,z1}, 진행도 t∈[0,1) → {x,z,yaw}
export function rectPoint(rect, t) {
  const w = rect.x1 - rect.x0; const d = rect.z1 - rect.z0; const peri = 2 * (w + d);
  let s = ((t % 1) + 1) % 1 * peri;
  if (s < w) return { x: rect.x0 + s, z: rect.z0, yaw: Math.PI / 2 };
  s -= w;
  if (s < d) return { x: rect.x1, z: rect.z0 + s, yaw: 0 };
  s -= d;
  if (s < w) return { x: rect.x1 - s, z: rect.z1, yaw: -Math.PI / 2 };
  s -= w;
  return { x: rect.x0, z: rect.z1 - s, yaw: Math.PI };
}
export const rectLength = (rect) => 2 * ((rect.x1 - rect.x0) + (rect.z1 - rect.z0));
// 상공 선회(타원): 섬 중앙을 크게 돈다. elapsedSec 로 출렁임 위상.
export function skyPoint(hx, hz, t, elapsedSec = 0) {
  const a = ((t % 1) + 1) % 1 * Math.PI * 2;
  const rx = hx * 0.72; const rz = hz * 0.6;
  return { x: Math.cos(a) * rx, z: Math.sin(a) * rz, y: 5.2 + Math.sin(elapsedSec * 1.4) * 0.5, yaw: Math.atan2(-Math.sin(a) * rx, Math.cos(a) * rz) };
}
export const skyLength = (hx, hz) => Math.PI * (hx * 0.72 + hz * 0.6); // 타원 둘레 근사
// 물 위 출렁임 높이(수영장·바다)
export const bobY = (elapsedSec, base = 0.18) => base + Math.sin(elapsedSec * 2.2) * 0.05;
// 바다 일주 코스(2026-11-06 사장님 지시 '배 타는 것'): 섬 가장자리(±hx/±hz) 바깥 margin 만큼의 바다 위 사각 루프.
//   물높이는 bobY 로 출렁임(모래 0 보다 낮은 baseY에서 시작).
// [2026-11-06 사장님] '배 더 먼바다로' — 기본 여백 1.6m → 3.4m
export const seaRect = (hx, hz, margin = 3.4) => ({ x0: -hx - margin, z0: -hz - margin, x1: hx + margin, z1: hz + margin });
// 시설 rect(월드 좌표) 안쪽 코스: 가장자리에서 in 만큼 안쪽 루프
export function insetRect(r, inset) {
  const x0 = Math.min(r.x0, r.x1) + inset; const x1 = Math.max(r.x0, r.x1) - inset;
  const z0 = Math.min(r.z0, r.z1) + inset; const z1 = Math.max(r.z0, r.z1) - inset;
  return x1 > x0 && z1 > z0 ? { x0, z0, x1, z1 } : null;
}

// ── 비행 근접 컷(2026-11-06 위시리스트 '하늘 비행 라이브 근접 컷') ─────────────────
// 직교 카메라가 비행체를 따라가는 확대 배율·추적 계수·대상 선택. (순수 함수 — 테스트 대상)
export const FOLLOW_ZOOM = 2.6;       // 근접 컷 배율
export const FOLLOW_LERP = 4;         // 추적 속도(1/초). dt 와 곱해 부드럽게 따라감
export const CAM_ELEV_TAN = 30 / 42.4; // 카메라 고도각 tan (Scene3D placeCam 의 30 / 42.4)
// 후보 라이더 중 컷 대상: 하늘 코스(sky) 우선, 없으면 null(지상 탈것은 컷 대상 아님). 입력 순서 안정(첫 번째).
export function pickFollowTarget(riders) {
  for (const r of riders || []) if (r && r.riding && r.course === 'sky') return r;
  return null;
}
// 고도 y 인 점이 화면 중앙에 오도록 하는 지면 pan 좌표(카메라에서 먼 쪽으로 y/tan(고도각) 만큼 보정)
export function followPan(pos, camDir) {
  const k = (pos.y || 0) / CAM_ELEV_TAN;
  return { x: pos.x - camDir.x * k, z: pos.z - camDir.z * k };
}
// 부드러운 추적: cur → target 지수 보간
export function followStep(cur, target, dt, rate = FOLLOW_LERP) {
  const a = 1 - Math.exp(-rate * Math.max(0, dt));
  return { x: cur.x + (target.x - cur.x) * a, z: cur.z + (target.z - cur.z) * a };
}
