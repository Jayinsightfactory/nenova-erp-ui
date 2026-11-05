// lib/pmMounts.js — /pm 탈것(순수 데이터 + 순수 함수, import 없음). 설계: docs/pm-skills-mounts.md
//   3D: 자리→스테이션 이동 시 걷기 대신 탑승 / 대기 중엔 옆에 세워둠. 2D: 캐릭터 옆 작은 아이콘(에셋 오기 전 이모지).
//   상점 id = 'mount.<id>', 장착 슬롯 1개 = mount. 등급·가격은 lib/pmSkills FX_RARITY 와 같은 표(아래 복제, import 없음 유지).

export const MOUNT_RARITY = Object.freeze({
  common: { label: '일반', price: 40, unlockStage: 1 },
  rare: { label: '희귀', price: 100, unlockStage: 2 },
  epic: { label: '영웅', price: 220, unlockStage: 3 },
  legend: { label: '전설', price: 450, unlockStage: 4 },
});
// theme = 테마 전용(그 테마 id 에서만 상점 노출·연출 강화, 장착은 어디서나 가능). ride = 3D 탑승 자세 클립, speed = 이동 배율
const M = (id, name, rarity, ride, speed, emoji, theme = '', course = 'ring') => Object.freeze({ id, name, rarity, ride, speed, emoji, theme, course, model: `mount_${id.replace(/-/g, '_')}.glb` });
// course: 크루징 코스(2026-11-06 사장님 지시 '탈것이 서킷·수영장·하늘·레일을 실제로 돌게') — circuit=카트트랙, water=수영장, sky=상공 선회, ring=둘레 보드워크(레일 겸용, 전용 레일은 후속)

export const MOUNTS = Object.freeze([
  M('kickboard', '킥보드', 'common', 'stand', 1.4, '🛴', '', 'circuit'),
  M('flower-cart', '꽃 수레', 'common', 'sit', 1.1, '🛒', '', 'ring'),
  M('roller', '롤러스케이트', 'common', 'stand', 1.5, '🛼', '', 'circuit'),
  M('bike', '세발자전거', 'common', 'sit', 1.3, '🚲', '', 'circuit'),
  M('forklift', '미니 지게차', 'rare', 'sit', 1.2, '🚜', '', 'ring'),
  M('balloon', '풍선', 'rare', 'hang', 1.0, '🎈', '', 'sky'),
  M('cloud', '구름', 'rare', 'sit', 1.3, '☁️', '', 'sky'),
  M('duck', '오리 튜브', 'rare', 'sit', 1.1, '🦆', '', 'water'),
  M('turtle', '거북이', 'epic', 'sit', 0.9, '🐢', '', 'water'),
  M('magic-carpet', '마법 양탄자', 'epic', 'sit', 1.6, '🧞', '', 'sky'),
  M('unicorn', '유니콘', 'legend', 'ride', 1.8, '🦄', '', 'sky'),
  // 테마 전용
  M('gama', '가마', 'epic', 'sit', 1.0, '🏯', 'hanok'),
  M('surfboard', '서핑보드', 'rare', 'stand', 1.6, '🏄', 'beach', 'water'),
  M('hoverboard', '호버보드', 'epic', 'stand', 1.9, '🛸', 'space', 'sky'),
  M('sled', '썰매', 'rare', 'sit', 1.5, '🛷', 'winter', 'circuit'),
]);
const BY_ID = new Map(MOUNTS.map((m) => [m.id, m]));
export const mountById = (id) => BY_ID.get(String(id || '').replace(/^mount\./, '')) || null;

export function mountShopItems() {
  // src = 3D 장면에 실제로 쓰는 mounts.glb 모델의 블렌더 렌더 썸네일(scripts/pm3d/build_mounts.py) — 상점에서 본 모습 = 사무실 속 모습
  return MOUNTS.map((m) => ({ id: `mount.${m.id}`, name: m.name, price: MOUNT_RARITY[m.rarity].price, rarity: m.rarity, unlockStage: MOUNT_RARITY[m.rarity].unlockStage, theme: m.theme, emoji: m.emoji, src: `/pm/mounts/thumb/${m.id}.webp` }));
}

// 탈것 상태(엔진 독립): 이동 중 = ride(탑승), 작업·대기 = park(옆에 세움), PC 꺼짐 = hidden
export function mountPose(status, moving = false) {
  if (status === 'off') return 'hidden';
  return moving ? 'ride' : 'park';
}
