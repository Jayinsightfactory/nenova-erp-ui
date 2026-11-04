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
