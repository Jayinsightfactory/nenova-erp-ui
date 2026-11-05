// lib/pm3dAssets.js — /pm 3D 해변 세계 블렌더 glb 애셋(34종) 목록·스케일 정합·배치 수식·파라솔 가림 검사(순수 함수, three 없음).
//   · 애셋은 "1칸 = 4.0" 단위로 제작됨(nenova-pm/pm3d/factory/work/ASSET_LIST.md) → 웹 격자 칸(pm3dGrid.CELL)에 균일 스케일.
//   · 자리 구도(사장님 확정): 카메라에서 가까운 순서 = 책상 → 캐릭터 → 파라솔. 파라솔 덮개는 어떤 자리에서도
//     카메라→캐릭터 시선을 가리면 안 된다 → 파라솔은 자리 방향과 무관하게 "캐릭터에서 카메라 반대쪽" 으로 둔다.
//   Scene3D(components/pm3d/assetKit.js)가 이 수식을 그대로 쓰고, __tests__/pm3dAssets.test.js 가 실제 배치로 검사한다.
import { CELL, SEAT_SIZE } from './pm3dGrid.js';

export const ASSET_BASE = '/pm3d/assets/';
export const ASSET_CELL = 4.0;                      // 애셋 제작 단위: 1칸 = 4.0
export const ASSET_SCALE = CELL / ASSET_CELL;       // 칸 타일·시설 바닥 균일 스케일(0.3)
export function seatUnitScale(size = SEAT_SIZE) { return (size * CELL) / ASSET_CELL; } // 자리 유닛(4.0)을 자리 칸(2×2=2.4m)에 맞춤
export const DECOR_SCALE = ASSET_SCALE * 1.5;      // 해변 끝단 장식(야자수·바위·덤불…) — 1칸 위에 살짝 넘치게
export const TILE_TOP = 0.22;                       // 타일 애셋 윗면 높이(애셋 단위) → 웹에서는 윗면이 y=0 이 되게 내림

export const ASSETS = Object.freeze({
  tiles: ['tile_sand', 'tile_coast_a', 'tile_coast_b', 'tile_boardwalk_straight', 'tile_boardwalk_corner', 'tile_boardwalk_cross', 'tile_bridge'],
  units: ['unit_parasol_pink', 'unit_parasol_mint', 'unit_parasol_coral', 'unit_parasol_lav', 'unit_parasol_butter'],
  chars: ['char_human', 'char_bear'],
  props: ['prop_palm', 'prop_rock', 'prop_sign', 'prop_bush', 'prop_crates', 'prop_surfboard', 'prop_starfish', 'prop_pebbles'],
  pool: ['pool_kit', 'pool_ladder', 'float_flamingo', 'float_duck', 'float_ring'],
  kart: ['track_straight', 'track_corner', 'track_arch', 'kart_coral', 'kart_mint'],
  airfield: ['runway_straight', 'runway_threshold', 'prop_plane', 'prop_windsock', 'prop_barrel'],
});
export const ALL_ASSETS = Object.freeze(Object.values(ASSETS).flat());
export const assetUrl = (name) => `${ASSET_BASE}${name}.glb`;
// 파라솔 색 5종 로테이션(부서 순서대로)
export function unitForIndex(i) { const u = ASSETS.units; return u[((i % u.length) + u.length) % u.length]; }

// 파라솔 유닛 glb 는 한 덩어리 → 노드 이름으로 쪼개 따로 배치한다(유닛 원래 배치는 파라솔-책상-의자 순이라 구도와 반대).
export const UNIT_PARASOL_NODES = Object.freeze(['canopy', 'pole', 'pole_base', 'tip']);
export const UNIT_SEAT_NODES = Object.freeze(['stool_board', 'cushion', 'stoolleg0', 'stoolleg1', 'stoolleg2']); // 기존 의자(캐릭터 좌석 높이 보정 기준) 유지 → 숨김
export const UNIT_TILE_NODES = Object.freeze(['tile_base', 'tile_top']); // 자리 바닥은 격자 타일이 이미 깔림 → 숨김
export function unitPartOf(nodeName) {
  const n = String(nodeName || '');
  if (UNIT_PARASOL_NODES.includes(n)) return 'parasol';
  if (UNIT_SEAT_NODES.includes(n)) return 'hide';
  if (UNIT_TILE_NODES.includes(n)) return 'hide';
  return 'desk';
}
// 유닛 애셋 실측(애셋 단위, glTF Y-up): 덮개 중심(0.3,-0.35) 반경 1.6 · 높이 3.70~4.55 / 책상 중심(0.3, 0.2) 윗면 1.17, 화면은 +Z 를 봄
export const UNIT_GEOM = Object.freeze({ canopy: { x: 0.3, z: -0.35, r: 1.6, y0: 3.70, y1: 4.55 }, desk: { x: 0.3, z: 0.2, top: 1.17 } });

// 카메라 수평 방향(장면→카메라) · 시선 기울기: Scene3D placeCam = (42.4·CAM_DIR, 30) → 수평 1.413m 당 1m 상승
export const CAM_H = Object.freeze({ x: Math.SQRT1_2, z: Math.SQRT1_2 });
export const CAM_RISE = 30 / 42.4;
export const PARASOL_GAP = 0.15; // 덮개 앞끝과 캐릭터 축 사이 여유(뒤통수 반경 포함은 검사에서)

// 파라솔 덮개 월드 배치: 캐릭터(월드 x,z)에서 카메라 반대쪽으로 R+gap → 덮개 앞끝이 캐릭터 뒤에 머문다(자리 방향 무관)
export function parasolSpot(charX, charZ, size = SEAT_SIZE) {
  const s = seatUnitScale(size); const C = UNIT_GEOM.canopy;
  const r = C.r * s; const d = r + PARASOL_GAP + 0.35;
  return { x: charX - CAM_H.x * d, z: charZ - CAM_H.z * d, r, y0: C.y0 * s, y1: C.y1 * s, scale: s };
}
// 월드 오프셋 → 자리 그룹 로컬(rotation.y = yaw) 좌표
export function worldToLocal(dx, dz, yaw) { const c = Math.cos(yaw); const s = Math.sin(yaw); return { x: dx * c - dz * s, z: dx * s + dz * c }; }
export function localToWorld(lx, lz, yaw) { const c = Math.cos(yaw); const s = Math.sin(yaw); return { x: lx * c + lz * s, z: -lx * s + lz * c }; }

// 가림 검사: 점 p(x,y,z) 에서 카메라 쪽으로 쏜 광선이 덮개 원기둥(중심, 반경, y0~y1)을 지나는가
export function rayHitsCanopy(p, cn, steps = 24) {
  if (p.y >= cn.y1) return false;
  const tA = Math.max(0, (cn.y0 - p.y) / CAM_RISE); const tB = (cn.y1 - p.y) / CAM_RISE; // 수평 이동 거리 구간
  for (let i = 0; i <= steps; i++) {
    const t = tA + ((tB - tA) * i) / steps;
    const x = p.x + CAM_H.x * t; const z = p.z + CAM_H.z * t;
    if (Math.hypot(x - cn.x, z - cn.z) < cn.r) return true;
  }
  return false;
}
// 캐릭터 표본점(머리끝·얼굴·가슴, 좌우·앞뒤 ±반경) — 이름표는 HTML 오버레이라 가림 대상 아님
export function charSamples(x, z, headTop, r = 0.35) {
  const out = [];
  for (const y of [headTop, headTop - 0.35, headTop - 0.75]) for (const [ox, oz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) out.push({ x: x + ox, y, z: z + oz });
  return out;
}
// 전 자리 검사: chars = [{x,z,headTop}], canopies = parasolSpot 결과 배열 → 가림 쌍 목록(빈 배열 = 통과)
export function occlusions(chars, canopies) {
  const bad = [];
  chars.forEach((c, i) => canopies.forEach((cn, j) => {
    for (const p of charSamples(c.x, c.z, c.headTop)) if (rayHitsCanopy(p, cn)) { bad.push({ char: i, canopy: j }); break; }
  }));
  return bad;
}
// 카메라 깊이(값이 클수록 카메라에 가까움) — 구도 순서 검사용
export const camDepth = (x, z) => x * CAM_H.x + z * CAM_H.z;

// 해변 끝단(beach) 칸의 바다 방향 → 해안 타일 종류/회전(애셋 coast_a 는 +X 가 바다, coast_b 는 +X·-Z 사분면이 바다)
// seaDirs = [[dx,dz], ...] 이웃 칸 중 땅이 아닌 방향
export function coastPick(seaDirs) {
  const has = (dx, dz) => seaDirs.some(([a, b]) => a === dx && b === dz);
  const yawTo = (dx, dz) => Math.atan2(-dz, dx); // 로컬 +X → 월드 (dx,dz)
  const ortho = [[1, 0], [0, 1], [-1, 0], [0, -1]].filter(([a, b]) => has(a, b));
  if (ortho.length >= 2) {
    const [a, b] = ortho; // 모서리: +X·-Z 사분면 → (a)+(b) 대각 방향으로 돌림
    const dx = a[0] + b[0]; const dz = a[1] + b[1];
    if (dx && dz) return { asset: 'tile_coast_b', yaw: Math.atan2(-dz, dx) - Math.PI / 4 };
  }
  if (ortho.length >= 1) return { asset: 'tile_coast_a', yaw: yawTo(ortho[0][0], ortho[0][1]) };
  return { asset: 'tile_sand', yaw: 0 };
}
// 보드워크 칸: 이웃 보드워크 연결 → 직선/코너/교차 + 회전(직선 애셋 판자 길이 = Z 축)
export function boardwalkPick(conn) {
  const n = conn.n, s = conn.s, e = conn.e, w = conn.w; const k = [n, s, e, w].filter(Boolean).length;
  if (k >= 3) return { asset: 'tile_boardwalk_cross', yaw: 0 };
  if ((n || s) && (e || w) && k === 2) {
    const yaw = n && e ? 0 : e && s ? -Math.PI / 2 : s && w ? Math.PI : Math.PI / 2;
    return { asset: 'tile_boardwalk_corner', yaw };
  }
  return { asset: 'tile_boardwalk_straight', yaw: e || w ? Math.PI / 2 : 0 };
}
// 시설 존 안에 애셋(애셋 단위 폭 aw×깊이 ad)을 여유 비율 m 으로 맞추는 균일 스케일
export function fitScale(zoneW, zoneD, aw, ad, m = 0.9) { return Math.min(zoneW / aw, zoneD / ad) * m; }
// 전 자리 파라솔 배치(탐욕): 기본 = 캐릭터 정뒤(카메라 반대). 다른 캐릭터를 가리면 ±30°·더 멀리 후보를 시도,
//   그래도 가리면 그 자리는 파라솔 생략(null) — "가리지 않는다"가 우선. chars = [{x,z,headTop,size}]
export function planParasols(chars) {
  const rot = (a) => ({ x: -(CAM_H.x * Math.cos(a) - CAM_H.z * Math.sin(a)), z: -(CAM_H.x * Math.sin(a) + CAM_H.z * Math.cos(a)) });
  const dirs = [0, 1, -1, 2, -2, 3, -3].map((k) => rot((k * Math.PI) / 12)); // 정뒤 → ±15°·30°·45°
  return chars.map((c) => {
    const base = parasolSpot(c.x, c.z, c.size);
    for (const extra of [0, 0.3, 0.6, 0.9]) for (const dv of dirs) {
      const d = base.r + PARASOL_GAP + 0.35 + extra;
      const cn = { ...base, x: c.x + dv.x * d, z: c.z + dv.z * d };
      if (camDepth(cn.x, cn.z) > camDepth(c.x, c.z) - cn.r - 0.3) continue; // 덮개 앞끝은 캐릭터 축보다 0.3m 이상 뒤
      if (!chars.some((o) => charSamples(o.x, o.z, o.headTop).some((p) => rayHitsCanopy(p, cn)))) return cn;
    }
    return null;
  });
}
