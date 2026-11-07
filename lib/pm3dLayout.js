// lib/pm3dLayout.js — /pm 3D(베타) 장면의 배치·외형·저사양 판정(순수 함수, 테스트 대상)
// 단위 = 미터(three.js 월드). 스테이션은 가운데 복도(z=0)에 1~9 순서, 부서 책상은 복도 위/아래에 번갈아 놓는다.

export const STATION_GAP = 2.2;
export const DESK_DX = 2.4;   // 같은 줄 책상 간격(책상 1.45배=1.74m 폭·yaw 회전 대각 고려, 겹침 없음)
export const DESK_DZ = 2.6;   // 두 줄 간격
export const DEPT_GAP = 2.2;
// 카메라 방향(XZ 평면, 장면→카메라). Scene3D 는 카메라를 (30, 30, 30) 쪽에 둔다.
export const CAM_DIR = Object.freeze({ x: Math.SQRT1_2, z: Math.SQRT1_2 });
export const CAM_YAW = Math.atan2(CAM_DIR.x, CAM_DIR.z); // three.js rotation.y(정면 +Z 기준)
export const SEAT_TURN = 0; // 일자 라인 정렬(사장님 지시): 책상 열 맞춤 — 전원 카메라 정면
// 좌석 방향: 모든 직원이 카메라를 본다. 뒤통수 금지.
export function seatYaw() { return CAM_YAW; }
// 자리 방향을 카메라 쪽으로 최대 TURN_MAX 만큼 돌림(위·뒤 시점에서 얼굴이 3/4 정면으로 보이게, 2026-11-07)
export const TURN_MAX = 0.7;
export function turnToCam(yaw) {
  if (!Number.isFinite(yaw)) return yaw;
  let d = CAM_YAW - yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
  return yaw + Math.max(-TURN_MAX, Math.min(TURN_MAX, d));
}
export function facingDot(yaw) { return Math.sin(yaw) * CAM_DIR.x + Math.cos(yaw) * CAM_DIR.z; }

import { planWorld } from './pm3dGrid.js';
export function stationPos(no) {
  return { x: (no - 5) * STATION_GAP, z: 0 };
}

// rooms: [{ dept, seats:[{name,status,...}|{empty:true,name}] }]  →  { desks:[{ name, dept, x, z, yaw, facing, size, island, X, Z, person }], plates, world }
//   격자 섬 배치(lib/pm3dGrid): 자리 = 2×2칸(seatSize 3 이면 3×3), 1호 섬 광장(스테이션·허브) 남/북 줄부터 채우고 모자라면 섬 증설.
//   yaw = 자리 그룹 회전(facing 4방향). 그룹 안에서 캐릭터는 -Z(책상 뒤)에 앉아 +Z 를 본다 → 기본 facing 은 광장 쪽(뒤통수 금지 시 카메라 정면).
//   좌표는 자리 중심(격자→월드 변환). p.facing('S'|'E'|'N'|'W')·p.seatSize 가 있으면 그대로 따른다.
export function layoutDesks(rooms) {
  const list = Array.isArray(rooms) ? rooms : [];
  const reqs = []; const meta = [];
  list.forEach((r) => (r.seats || []).forEach((p) => {
    reqs.push({ id: `${reqs.length}:${p.name || ''}`, dept: r.dept, size: p.seatSize, facing: p.facing });
    meta.push({ p, dept: r.dept });
  }));
  const { world, seats } = planWorld(reqs);
  const desks = seats.map((s, i) => ({
    name: meta[i].p.name || '', dept: meta[i].dept, x: s.x, z: s.z, yaw: s.yaw, facing: s.facing, size: s.size, island: s.island, X: s.X, Z: s.Z, id: s.id,
    person: meta[i].p.empty ? null : meta[i].p,
  }));
  const plates = [];
  for (const r of list) {
    const ds = desks.filter((d) => d.dept === r.dept);
    if (!ds.length) continue;
    const x = ds.reduce((a, d) => a + d.x, 0) / ds.length;
    const north = ds[0].z < 0;
    plates.push({ dept: r.dept, x, z: north ? Math.min(...ds.map((d) => d.z)) - 1.6 : Math.max(...ds.map((d) => d.z)) + 1.6, island: ds[0].island });
  }
  return { desks, plates, world };
}

// 바닥 범위(타일 2m 단위로 반올림)
export function floorBounds(desks, mapScale = 1) {
  let mx = STATION_GAP * 5, mz = 7;
  for (const d of desks) { mx = Math.max(mx, Math.abs(d.x) + 3); mz = Math.max(mz, Math.abs(d.z) + 3); }
  return { hx: Math.ceil(mx * mapScale / 2) * 2, hz: Math.ceil(mz * mapScale / 2) * 2 };
}

import { PM3D } from './pmThemes.js';
const { OUTFIT_COLORS, SKINS, HAIR_COLORS, PASTEL, DESK_SKINS, RACES } = PM3D;
export { RACES };
export { OUTFIT_COLORS, SKINS, HAIR_COLORS };

function hash(s) { let h = 0; for (const c of String(s || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }

// 착용 소품 id → char.glb 부착 메시(종별 전용 모델, scripts/pm3d/build_wearables.py 가 같은 이름으로 만든다)
//   'hat.beret' → 'hat_beret', 'glasses.round' → 'gls_round', 'hand.mug' → 'hnd_mug', 'badge.star' → 'bdg_star'
const WEAR_PREFIX = { hat: 'hat_', glasses: 'gls_', hand: 'hnd_', badge: 'bdg_' };
export function wearMesh(slot, id) {
  const p = WEAR_PREFIX[slot];
  if (!p || !id) return '';
  const suffix = String(id).split('.')[1] || '';
  return suffix ? p + suffix : '';
}
export function hatMesh(id) { return wearMesh('hat', id); }
// 책장·큰 소품 id → kit.glb 모듈(scripts/pm3d/build_shelves.py)
export function shelfModel(id) {
  const suffix = String(id || '').split('.')[1] || '';
  return suffix ? 'shelf_' + suffix : '';
}

// cfg = 꾸미기 설정(normalize 전 원본도 허용) → 3D 외형
export function look3d(cfg, name) {
  const c = (cfg && cfg.view) || cfg || {};
  const items = c.items || {};
  const h = hash(name);
  const oc = OUTFIT_COLORS[items.outfit] || PASTEL[h % PASTEL.length];
  // 종족(상점 '캐릭터' 탭) — PM3D.RACES 한 표를 상점 렌더와 3D 장면이 같이 쓴다(PR 1520 KayKit 교체 때 유실된 종족 외형 복원).
  const race = RACES[c.char] || RACES.human;
  return {
    char: RACES[c.char] ? c.char : 'human',
    raceMesh: race.mesh || '',
    hideHair: !!race.hideHair,
    raceTemp: !!race.temp,
    top: oc[0], bottom: oc[1],
    skin: race.skin || SKINS[Number.isInteger(c.skin) ? c.skin % SKINS.length : 0],
    hair: race.hair || HAIR_COLORS[Number.isInteger(c.hairColor) ? c.hairColor % HAIR_COLORS.length : (h >>> 3) % HAIR_COLORS.length], // >>>: 부호 쉬프트면 음수 인덱스 → undefined(머리색 누락) 버그
    hat: hatMesh(items.hat || ''),
    glasses: wearMesh('glasses', items.glasses || ''),
    hand: wearMesh('hand', items.hand || ''),
    badge: wearMesh('badge', items.badge || ''),
    shelf: shelfModel(items.shelf || ''),
    desk: items.desk ? DESK_SKINS[hash(items.desk) % DESK_SKINS.length] : '',
    props: ['deskL', 'deskM', 'deskR'].filter((k) => items[k]).map((k) => (hash(items[k]) % 2 ? 'mug' : 'plant_k2')),
    pet: !!items.pet,
    bodyType: bodyTypeOf(c.bodyType),
    face: typeof c.face === 'string' ? c.face : '',
    mount: typeof items.mount === 'string' ? items.mount : '',
    // 직원별 개성(2026-11-07 디테일): 머리 모양·머리 소품은 이름으로 고정 배정(꾸미기 값이 있으면 그것). 모자를 쓰면 앞머리만, 모자·안경이면 소품 없음
    hairStyle: items.hat ? 'bangs' : (HAIR_STYLES.includes(c.hairStyle) ? c.hairStyle : HAIR_STYLES[(h >>> 5) % HAIR_STYLES.length]),
    acc: items.hat || items.glasses || race.mesh ? '' : bandSafe(items.hat ? 'bangs' : (HAIR_STYLES.includes(c.hairStyle) ? c.hairStyle : HAIR_STYLES[(h >>> 5) % HAIR_STYLES.length]), HAIR_ACCS.includes(c.acc) ? c.acc : HAIR_ACCS[(h >>> 9) % HAIR_ACCS.length]),
  };
}
// 머리 모양·머리 소품(char.glb hs_<id>·acc_<id> — scripts/pm3d/detail_char.py). acc '' = 없음
export const HAIR_STYLES = Object.freeze(['bangs', 'bob', 'bun', 'pony', 'spiky', 'curly']);
// 삐죽머리+머리띠는 위에서 보면 귀처럼 보임 → 머리띠 빼기
function bandSafe(style, acc) { return style === 'spiky' && acc === 'band' ? '' : acc; }
export const HAIR_ACCS = Object.freeze(['', 'ribbon', 'flower', 'heart', 'band']);

// 부서별 책상 모델·색(구매 책상 스킨이 있으면 그 색 우선) — 책상 디자인 다양화
export const DESK_MODELS = ['desk_k1']; // Kenney desk(CC0). 다양화는 부서색 틴트+의자 2종 — table/자작 변형은 이 각도에서 막힌 상자로 보여 제외
export const CHAIR_MODELS = ['chair_k1', 'chair_k2'];
export function deskStyle(dept, ownColor, deskSkins) {
  const h = hash(dept || '');
  const palette = deskSkins || [];
  return { model: DESK_MODELS[h % DESK_MODELS.length], chair: CHAIR_MODELS[(h >> 1) % CHAIR_MODELS.length], color: ownColor || palette[(h >> 2) % (palette.length || 1)] || '' };
}

// 상태 → 애니메이션 클립·이모트
export function animOf(person) {
  const st = person?.status || 'off';
  if (st === 'working') return { clip: 'sit_type', speed: 1, emote: '' };
  if (st === 'off') return { clip: 'doze', speed: 1, emote: '💤' };
  return { clip: 'sit_type', speed: 0.25, emote: '☕' };
}

// 저사양 판정: 첫 프레임 3초 초과 또는 (로드 후 3초 제외) 5초 평균 FPS 10 미만이면 2D 로 폴백
export const FIRST_FRAME_MS = 3000;
export const MIN_FPS = 10;        // 사장님 완화(20→10)
export const FPS_WARMUP_MS = 3000; // 첫 로드 직후 측정 제외
export const FPS_WINDOW_MS = 5000; // 5초 평균
export const FPS_CAP = 15;         // 렌더 상한(사장님 지시 11/05: 24→15, 품질에 양보)
export const FPS_IDLE = 8;         // 변화 없을 때
export const IDLE_AFTER_MS = 10000;
export const MAX_DPR = 1.25;        // 2026-11-07 1.5→1.25: 고해상도 화면에서 칠할 픽셀 약 30% 감소(안티앨리어싱 유지라 계단 안 보임). FPS_CAP 은 그대로
// ── 비율(사장님 지시: 캐릭터·책상 1.4~1.6배, 꾸미기가 보이게) ──
// 2026-11-05 비율 교정: char.glb 머리 축소(1:2.2→1:3.4, build_char_kaykit.py HEAD_K)로 전신이 1.94→1.64m 가 됨 →
//   화면상 크기(90~110px 테스트) 유지를 위해 캐릭터 배율만 1.05 로 상향. 좌석 공식(SEAT_Y)은 힙 높이 기준이라 그대로 맞는다.
export const CHAR_SCALE = 1.1;    // 캐릭터
export const SET_SCALE = 1.45;    // 책상·의자·노트북
export const PROP_SCALE = 2.0;    // 책상 위 소품(머그·화분) — 한눈에 식별
export const DEFAULT_ZOOM = 1.2;  // 기본 배율(카메라 한 단계 가까이) — '맞춤'=1
export const FIT_HX = 0.41;
export const FIT_HZ = 0.55;
export function sceneFit(hx, hz) { return Math.max(hx * FIT_HX, hz * FIT_HZ); }
// 화면상 앉은 캐릭터 픽셀 높이(직교 iso 35.264°: 세로 투영 cos≈0.8165). 목표 90~110px @1440 화면.
export const CHAR_STAND_H = 1.78; // char.glb 서기 머리끝(비율 교정 후: 머리 축소+몸 스트레치, build_char_kaykit.py)

// ── 선택형 체형(사장님 지시): char.glb(늘씬 1:4 베이크) 위 "런타임 본 스케일" — glb 1개로 3체형, 클립·장착 호환 유지 ──
//   head 본 스케일(head)로 머리 크기, 캐릭터 전체 스케일(s)로 키를 조절한다.
//   모자·안경·손소품·종족 부속은 전부 본 스키닝(head/chest/hand)이라 소켓이 자동으로 따라가고,
//   엉덩이(hips)는 head 스케일의 영향을 받지 않아 좌석 공식이 s 만으로 닫힌다. 블롭 그림자도 s 를 따른다.
export const BODY_BAKE = Object.freeze({ standTop: 1.758, headPivot: 1.467, chin: 1.322, sitHip: 0.52 }); // build_char_kaykit.py 산출 실측
export const BODY_TYPES = Object.freeze({
  // 2026-11-07 사장님 지시: 소프트 클레이 치비 — 기본(밸런스) 머리:몸통(턱 아래) = 1:1.2. 귀염은 더 크게, 늘씬은 조금 작게.
  cute: { label: '귀염', head: 2.5, s: 0.8 },       // 머리:몸통 ≈ 1:1.0 · 머리:전신 ≈ 1:2.0
  balance: { label: '밸런스', head: 2.2, s: 0.84 }, // 머리:몸통 ≈ 1:1.2 · 머리:전신 ≈ 1:2.2 (기본)
  slim: { label: '늘씬', head: 1.9, s: 0.88 },       // 머리:몸통 ≈ 1:1.5 · 머리:전신 ≈ 1:2.5
});
export const DEFAULT_BODY_TYPE = 'balance';
export function bodyTypeOf(v) { return BODY_TYPES[v] ? v : DEFAULT_BODY_TYPE; }
export function bodyMetrics(id, charScale = CHAR_SCALE) {
  const b = BODY_TYPES[bodyTypeOf(id)]; const K = BODY_BAKE;
  const headTop = (K.headPivot + (K.standTop - K.headPivot) * b.head) * b.s; // 서기 머리끝(스케일 전 로컬 ×s)
  const headH = (K.standTop - K.chin) * b.head * b.s;                        // 머리 높이(턱~정수리)
  return {
    ...b, id: bodyTypeOf(id), headTop, headH, ratio: headTop / headH, bodyRatio: (headTop - headH) / headH, // bodyRatio = 몸통(턱 아래):머리
    sitHip: K.sitHip * b.s,                                                  // 앉은 힙 높이(charScale 곱하기 전)
    seatY: 0.46 * SET_SCALE - K.sitHip * charScale * b.s + 0.02,             // 좌판 0.46×SET 에 힙을 맞추는 캐릭터 원점 y
  };
}
export function charPixelHeight(viewportH, fit, zoom = DEFAULT_ZOOM) {
  const visH = CHAR_STAND_H * CHAR_SCALE * 0.85; // 서기 높이 × 스케일 × 앉기 비율
  return visH * 0.8165 * zoom * viewportH / (2 * fit);
}
// 첫 화면 기본 배율: 최초 기획(캐릭터 ≈100px @720 화면)을 인원·맵 크기와 무관하게 유지.
// 상한 = 9 스테이션이 전부 보이는 배율, 하한 = DEFAULT_ZOOM(소규모 구성에선 기존과 동일).
export function defaultZoom(fit, viewportH = 720) {
  const zWant = 100 / charPixelHeight(viewportH, fit, 1);
  const zMax = (2 * fit) / (stationPos(9).x + 0.4);
  return Math.max(DEFAULT_ZOOM, Math.min(zWant, zMax));
}
export function shouldFallback({ firstFrameMs, fps }) {
  if (firstFrameMs != null && firstFrameMs > FIRST_FRAME_MS) return 'slow-first-frame';
  if (fps != null && fps < MIN_FPS) return 'low-fps';
  return '';
}

// 연결선 아치: 캐릭터 머리(앉은 정수리 ≈2.12m) 위로 넘어간다. 스테이션 앞에서만 내려옴.
export const CHAR_TOP = 2.2;
export const ARC_Y = Object.freeze({ start: 2.4, mid: 3.6, end: 1.6 });
export function arcY(t) { const { start, mid, end } = ARC_Y; const u = 1 - t; return u * u * start + 2 * u * t * mid + t * t * end; }
// 좌석 월드 위치(책상 기준 자리 facing 반대쪽으로 0.9m). yaw 없는 옛 데이터는 CAM_YAW.
export const SEAT_OFF = 0.62 * 1.45;
export function seatWorld(d) { const y = Number.isFinite(d.yaw) ? d.yaw : CAM_YAW; return { x: d.x - Math.sin(y) * SEAT_OFF, z: d.z - Math.cos(y) * SEAT_OFF }; }

// 라벨칩 겹침 회피: 화면 좌표 박스를 y 순으로 훑어, 겹치면 원래 자리에서 가까운 칸부터(아래1→위1→아래2→위2…) 빈 곳을 찾는다.
//   [2026-11-07 사장님 스크린샷] 옛 방식(겹치면 계속 아래로 밀기)은 한 줄로 늘어선 로봇 이름표 8개가 계단식으로 쌓여 화면 밑으로 잘렸다.
//   위·아래 번갈아 찾으면 이웃끼리 두 줄 지그재그로 자연스럽게 갈린다. 빈 칸을 못 찾으면 옛 방식(맨 아래로 밀기).
export function declutter(boxes, gap = 3) {
  const out = boxes.map((b) => ({ ...b })).sort((a, b) => a.y - b.y);
  const hit = (b, y, n) => { for (let j = 0; j < n; j++) { const a = out[j]; if (Math.abs(a.x - b.x) < (a.w + b.w) / 2 + gap && y < a.y + a.h + gap && y + b.h > a.y - gap) return true; } return false; };
  for (let i = 0; i < out.length; i++) {
    const b = out[i]; const y0 = b.y; const step = b.h + gap;
    if (!hit(b, y0, i)) continue;
    let placed = false;
    for (let k = 1; k <= 6 && !placed; k++) for (const y of [y0 + k * step, y0 - k * step]) if (!hit(b, y, i)) { b.y = y; placed = true; break; }
    if (!placed) for (let j = 0; j < i; j++) { const a = out[j]; if (Math.abs(a.x - b.x) < (a.w + b.w) / 2 && b.y < a.y + a.h + gap && b.y + b.h > a.y - gap) b.y = a.y + a.h + gap; }
  }
  return out;
}
