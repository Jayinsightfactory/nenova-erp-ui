// lib/pm3dLayout.js — /pm 3D(베타) 장면의 배치·외형·저사양 판정(순수 함수, 테스트 대상)
// 단위 = 미터(three.js 월드). 스테이션은 가운데 복도(z=0)에 1~9 순서, 부서 책상은 복도 위/아래에 번갈아 놓는다.

export const STATION_GAP = 2.2;
export const DESK_DX = 2.0;   // 같은 줄 책상 간격(책상 1.45배=1.74m 폭·yaw 회전 대각 고려, 겹침 없음)
export const DESK_DZ = 2.3;   // 두 줄 간격
export const DEPT_GAP = 1.4;
// 카메라 방향(XZ 평면, 장면→카메라). Scene3D 는 카메라를 (30, 30, 30) 쪽에 둔다.
export const CAM_DIR = Object.freeze({ x: Math.SQRT1_2, z: Math.SQRT1_2 });
export const CAM_YAW = Math.atan2(CAM_DIR.x, CAM_DIR.z); // three.js rotation.y(정면 +Z 기준)
export const SEAT_TURN = 0; // 일자 라인 정렬(사장님 지시): 책상 열 맞춤 — 전원 카메라 정면
// 좌석 방향: 모든 직원이 카메라를 본다. 뒤통수 금지.
export function seatYaw() { return CAM_YAW; }
export function facingDot(yaw) { return Math.sin(yaw) * CAM_DIR.x + Math.cos(yaw) * CAM_DIR.z; }

export function stationPos(no) {
  return { x: (no - 5) * STATION_GAP, z: 0 };
}

// rooms: [{ dept, seats:[{name,status,...}|{empty:true,name}] }]  →  desks: [{ name, dept, x, z, yaw, person }]
//   yaw = 자리 그룹 회전. 그룹 안에서 캐릭터는 -Z(책상 뒤)에 앉아 +Z(=카메라 쪽)를 본다. 책상·낮은 노트북은 캐릭터 앞.
export function layoutDesks(rooms) {
  const list = Array.isArray(rooms) ? rooms : [];
  const sides = [[], []];
  list.forEach((r, i) => sides[i % 2].push(r));
  const desks = []; const plates = [];
  sides.forEach((rs, side) => {
    const sign = side === 0 ? -1 : 1;
    const widths = rs.map((r) => Math.max(1, Math.ceil(((r.seats || []).length || 1) / 2)) * DESK_DX);
    const total = widths.reduce((a, b) => a + b, 0) + DEPT_GAP * Math.max(0, rs.length - 1);
    let x0 = -total / 2;
    rs.forEach((r, k) => {
      const seats = r.seats || [];
      const cols = Math.max(1, Math.ceil((seats.length || 1) / 2));
      seats.forEach((p, j) => {
        const col = j % cols; const row = Math.floor(j / cols);
        const z = sign * (3.2 + row * DESK_DZ);
        desks.push({ name: p.name || '', dept: r.dept, x: x0 + DESK_DX / 2 + col * DESK_DX, z, yaw: seatYaw(desks.length), person: p.empty ? null : p });
      });
      plates.push({ dept: r.dept, x: x0 + widths[k] / 2, z: sign * (3.2 + DESK_DZ * 1.5 + 0.6) });
      x0 += widths[k] + DEPT_GAP;
    });
  });
  return { desks, plates };
}

// 바닥 범위(타일 2m 단위로 반올림)
export function floorBounds(desks) {
  let mx = STATION_GAP * 5, mz = 6;
  for (const d of desks) { mx = Math.max(mx, Math.abs(d.x) + 2); mz = Math.max(mz, Math.abs(d.z) + 2.5); }
  return { hx: Math.ceil(mx / 2) * 2, hz: Math.ceil(mz / 2) * 2 };
}

import { PM3D } from './pmThemes.js';
const { OUTFIT_COLORS, SKINS, HAIR_COLORS, PASTEL, DESK_SKINS } = PM3D;
export { OUTFIT_COLORS, SKINS, HAIR_COLORS };

function hash(s) { let h = 0; for (const c of String(s || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }

// 모자 id → 리그 부착 메시(hat_cap / hat_straw / hat_party)
export function hatMesh(id) {
  if (!id) return '';
  if (/straw|sun|flower/.test(id)) return 'hat_straw';
  if (/crown|party|chef|gat/.test(id)) return 'hat_party';
  return 'hat_cap';
}

// cfg = 꾸미기 설정(normalize 전 원본도 허용) → 3D 외형
export function look3d(cfg, name) {
  const c = (cfg && cfg.view) || cfg || {};
  const items = c.items || {};
  const h = hash(name);
  const oc = OUTFIT_COLORS[items.outfit] || PASTEL[h % PASTEL.length];
  return {
    top: oc[0], bottom: oc[1],
    skin: SKINS[Number.isInteger(c.skin) ? c.skin % SKINS.length : 0],
    hair: HAIR_COLORS[Number.isInteger(c.hairColor) ? c.hairColor % HAIR_COLORS.length : (h >> 3) % HAIR_COLORS.length],
    hat: hatMesh(items.hat || ''),
    desk: items.desk ? DESK_SKINS[hash(items.desk) % DESK_SKINS.length] : '',
    props: ['deskL', 'deskM', 'deskR'].filter((k) => items[k]).map((k) => (hash(items[k]) % 2 ? 'mug' : 'plant')),
    pet: !!items.pet,
  };
}

// 부서별 책상 모델·색(구매 책상 스킨이 있으면 그 색 우선) — 책상 디자인 다양화
export const DESK_MODELS = ['desk', 'desk_b', 'desk_c'];
export function deskStyle(dept, ownColor, deskSkins) {
  const h = hash(dept || '');
  const palette = deskSkins || [];
  return { model: DESK_MODELS[h % DESK_MODELS.length], color: ownColor || palette[(h >> 2) % (palette.length || 1)] || '' };
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
export const FPS_CAP = 24;         // 렌더 상한
export const FPS_IDLE = 8;         // 변화 없을 때
export const IDLE_AFTER_MS = 10000;
export const MAX_DPR = 1.5;
// ── 비율(사장님 지시: 캐릭터·책상 1.4~1.6배, 꾸미기가 보이게) ──
export const CHAR_SCALE = 0.95;   // 캐릭터(기존 0.62의 1.53배)
export const SET_SCALE = 1.45;    // 책상·의자·노트북
export const PROP_SCALE = 2.0;    // 책상 위 소품(머그·화분) — 한눈에 식별
export const DEFAULT_ZOOM = 1.2;  // 기본 배율(카메라 한 단계 가까이) — '맞춤'=1
export const FIT_HX = 0.48;
export const FIT_HZ = 0.62;
export function sceneFit(hx, hz) { return Math.max(hx * FIT_HX, hz * FIT_HZ); }
// 화면상 앉은 캐릭터 픽셀 높이(직교 iso 35.264°: 세로 투영 cos≈0.8165). 목표 90~110px @1440 화면.
export function charPixelHeight(viewportH, fit, zoom = DEFAULT_ZOOM) {
  const visH = 1.95 * CHAR_SCALE * 0.85; // 서기 1.95m × 스케일 × 앉기 비율
  return visH * 0.8165 * zoom * viewportH / (2 * fit);
}
export function shouldFallback({ firstFrameMs, fps }) {
  if (firstFrameMs != null && firstFrameMs > FIRST_FRAME_MS) return 'slow-first-frame';
  if (fps != null && fps < MIN_FPS) return 'low-fps';
  return '';
}

// 라벨칩 겹침 회피: 화면 좌표 박스를 y 순으로 훑어 겹치면 아래로 민다
export function declutter(boxes, gap = 2) {
  const out = boxes.map((b) => ({ ...b })).sort((a, b) => a.y - b.y);
  for (let i = 0; i < out.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = out[j]; const b = out[i];
      if (Math.abs(a.x - b.x) < (a.w + b.w) / 2 && b.y < a.y + a.h + gap && b.y + b.h > a.y - gap) b.y = a.y + a.h + gap;
    }
  }
  return out;
}
