// lib/pmDeskSlots.js — /pm 자리(책상) 단위 배치 좌표계. 장면(lib/pmSceneMaps, 배경 좌표 지도)과의 연결 인터페이스.
//   장면 쪽은 직원 자리마다 "책상 앵커" 1점(화면 px, 책상 앞면 가운데 바닥)과 배율만 주면 된다.
//   자리 세트 캔버스 = 384×384(scale 1). 앵커는 캔버스 안 (192, 294.6). 아래 at = 앵커 기준 상대 px(scale 1).
//   z = 그리는 순서(작을수록 뒤). 같은 z 안에서는 slot 순서대로. 아이소 장면에서 자리끼리는 앵커 y 가 큰(앞쪽) 자리를 나중에 그린다.
//   캐릭터는 앉은 포즈 256 캔버스(엉덩이 hip=(128,195.7))를 seat 에 엉덩이가 오게 놓는다. 상판 소품은 같은 가운데 렌더를 dx 만큼 평행이동(직교 카메라라 정확).
//   값의 원본 = public/pm-char/layers.json desk(블렌더 카메라에서 계산, scripts/pm-char/post.py). 바꾸면 둘 다 재생성.
export const PM_DESK_CANVAS = 384;
export const PM_DESK_ANCHOR = Object.freeze([192, 294.6]);
export const PM_CHAR_CANVAS = 256;
export const PM_CHAR_FEET = Object.freeze([128, 238]);
export const PM_CHAR_HIP = Object.freeze([128, 195.7]); // sit 포즈 엉덩이
export const PM_DESK_SLOTS = Object.freeze({
  rug: { z: 0, at: [0, -13.8], label: '러그(바닥 깔개)' },
  shelf: { z: 1, at: [-147, -31.5], label: '책장·큰 화분(뒤 왼쪽 바닥)' },
  chair: { z: 2, at: [0, -30.6], label: '의자(캐릭터 뒤)' },
  seat: { z: 3, at: [0, -68.3], label: '앉은 캐릭터 엉덩이(sit 캔버스 hip 기준점)' },
  desk: { z: 4, at: [0, 0], label: '책상' },
  deskL: { z: 5, at: [-61.6, -76.5], dx: -61.6, label: '상판 왼쪽' },
  deskM: { z: 5, at: [0, -76.5], dx: 0, label: '상판 가운데' },
  deskR: { z: 5, at: [61.6, -76.5], dx: 61.6, label: '상판 오른쪽' },
  pet: { z: 6, at: [128, 4.9], label: '펫(책상 옆 앞 바닥)' },
});

// 장면 앵커(화면 px) + 배율 → 슬롯 화면 좌표. 캔버스 이미지를 놓을 왼쪽 위 = canvasOrigin.
export function deskPlacement(anchor, scale = 1) {
  const [ax, ay] = anchor;
  const canvasOrigin = [ax - PM_DESK_ANCHOR[0] * scale, ay - PM_DESK_ANCHOR[1] * scale];
  const slots = {};
  for (const [k, s] of Object.entries(PM_DESK_SLOTS)) slots[k] = { z: s.z, x: ax + s.at[0] * scale, y: ay + s.at[1] * scale };
  const charOrigin = [slots.seat.x - PM_CHAR_HIP[0] * scale, slots.seat.y - PM_CHAR_HIP[1] * scale];
  return { canvasOrigin, size: PM_DESK_CANVAS * scale, charOrigin, charSize: PM_CHAR_CANVAS * scale, slots };
}

// 자리끼리 깊이 정렬: 앵커 y 오름차순(뒤→앞), 같으면 x.
export function sortDesks(desks) {
  return [...desks].sort((a, b) => a.anchor[1] - b.anchor[1] || a.anchor[0] - b.anchor[0]);
}

// ── 장면용 아이소메트릭 세트(public/pm-char/iso/, 배경 클레이 일러스트와 같은 시점: 고도 30°·방위 45°) ──
//   캔버스 384×384. top = 책상 상판 중심, floor = 책상 앞면(사람 쪽) 가운데 바닥, deskL/M/R = 상판 소품 바닥점, pet = 펫 바닥점.
//   상판 소품은 deskM 에 렌더 — 다른 칸은 (칸 - deskM) 만큼 평행이동. 배경 책상 방향이 반대(dir='right')면 앵커 x 기준 좌우 반전.
//   값의 원본 = layers.json iso.anchors(scripts/pm-char/post_iso.py, 블렌더 카메라 투영).
export const PM_DESK_ISO = Object.freeze({
  canvas: 384,
  camera: { elev: 30, az: 45 },
  anchors: { floor: [171.9, 247.2], top: [202.1, 170.5], deskL: [151.8, 152.1], deskM: [195.4, 173.9], deskR: [238.9, 195.7], pet: [245.6, 307.6] },
  z: { desk: 2, deskTop: 3, pet: 4 },
});

// 장면 px 의 책상 상판점(deskAnchor().desk 를 px 로 바꾼 값) + 배율 → 아이소 캔버스 왼쪽 위·크기
export function isoPlacement(anchor, scale = 1, { kind = 'top', dir = 'left' } = {}) {
  const a = PM_DESK_ISO.anchors[kind];
  const ax = dir === 'right' ? PM_DESK_ISO.canvas - a[0] : a[0];
  return { left: anchor[0] - ax * scale, top: anchor[1] - a[1] * scale, size: PM_DESK_ISO.canvas * scale, flip: dir === 'right' };
}

// 장면 배경별 아이소 책상 스킨 보정(스크린샷 대조로 맞춤, 2026-11-04). 상판 중심 = 장면 frontMasks[부서][i] 사각형 중심(%).
//   scale = 배경 폭 1600px 기준 배율(실제 = scale × 장면폭/1600). 책상이 작게 그려진 배경(G·I·J)은 0.6.
export const PM_DESK_ISO_SCALE = Object.freeze({ A: 0.8, B: 0.8, C: 0.8, D: 0.8, E: 0.8, F: 0.8, G: 0.6, H: 0.8, I: 0.6, J: 0.6 });
export function isoDeskTop(maskRect) {
  if (!Array.isArray(maskRect) || maskRect.length < 4) return null;
  return [(maskRect[0] + maskRect[2]) / 2, (maskRect[1] + maskRect[3]) / 2];
}
